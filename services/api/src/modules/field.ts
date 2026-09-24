import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, createReadStream } from 'node:fs';
import { mkdir as mkdirAsync } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pool, tx } from '../db.js';
import { config } from '../config.js';
import { requireScope, assertProjectAccess, HttpError } from '../auth/rbac.js';
import { audit } from '../auth/audit.js';
import { requireAuth } from '../auth/context.js';

const MIME = new Set(['image/jpeg','image/png','image/webp','video/mp4','video/webm','audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav','application/pdf','text/plain']);
async function event(companyId:string,type:string,entityType:string,entityId:string,payload:unknown,actorId:string) {
  await pool.query('SELECT emit_company_event($1,$2,$3,$4,$5::jsonb,$6)',[companyId,type,entityType,entityId,JSON.stringify(payload ?? {}),actorId]);
}

export function fieldRoutes(app:FastifyInstance):void {
  app.post('/captures/upload',async(req,reply)=>{
    requireScope(req,'documents','write'); const auth=requireAuth(req); const parts=req.parts();
    let buffer:Buffer|null=null,fileName='capture',mime='application/octet-stream',type='document';
    let projectId:string|null=null,title:string|null=null,note:string|null=null,lat:number|null=null,lng:number|null=null;
    for await(const p of parts){
      if(p.type==='file'){ if(!MIME.has(p.mimetype)) throw new HttpError(415,'Unsupported capture MIME'); buffer=await p.toBuffer(); if(buffer.length>25*1024*1024) throw new HttpError(413,'Capture too large'); fileName=p.filename; mime=p.mimetype; }
      else { const v=String(p.value??''); if(p.fieldname==='capture_type') type=v||'document'; if(p.fieldname==='project_id') projectId=v||null; if(p.fieldname==='title') title=v||null; if(p.fieldname==='note') note=v||null; if(p.fieldname==='latitude') lat=v?Number(v):null; if(p.fieldname==='longitude') lng=v?Number(v):null; }
    }
    if(!buffer) throw new HttpError(400,'File is required');
    if(projectId) assertProjectAccess(req,projectId);
    if(!['photo','video','document','voice','work_log','material','incident','task','invoice'].includes(type)) throw new HttpError(400,'Invalid capture type');
    const hash=createHash('sha256').update(buffer).digest('hex');
    const out=await tx(async c=>{
      const dir=join(config.storageDir,auth.companyId); await mkdirAsync(dir,{recursive:true});
      const key=`capture-${Date.now()}-${hash.slice(0,12)}${extname(fileName)}`;
      await new Promise<void>((resolve,reject)=>writeFile(join(dir,key),buffer!,e=>e?reject(e):resolve()));
      const d=await c.query<{id:string}>(`INSERT INTO document(company_id,uploaded_by,file_name,mime_type,size_bytes,storage_key,sha256,status,classification) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',$8) RETURNING id`,[auth.companyId,auth.userId,fileName,mime,buffer!.length,key,hash,type]);
      if(projectId) await c.query(`INSERT INTO document_link(document_id,entity_type,entity_id) VALUES($1,'project',$2) ON CONFLICT DO NOTHING`,[d.rows[0]!.id,projectId]);
      const cap=await c.query<{id:string}>(`INSERT INTO capture_item(company_id,capture_type,project_id,document_id,title,note,latitude,longitude,captured_via,metadata,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING id`,[auth.companyId,type,projectId,d.rows[0]!.id,title,note,lat,lng,type==='voice'?'voice':'upload',JSON.stringify({mimeType:mime,sizeBytes:buffer!.length,sha256:hash}),auth.userId]);
      return {id:cap.rows[0]!.id,documentId:d.rows[0]!.id};
    });
    await event(auth.companyId,'capture.created','capture_item',out.id,{type,projectId},auth.userId);
    await audit(req,'create','capture_item',out.id,{capture_type:type,project_id:projectId});
    return reply.code(201).send(out);
  });

  app.get('/projects/:id/captures',async(req)=>{
    requireScope(req,'projects','read'); const auth=requireAuth(req); const {id}=req.params as {id:string}; assertProjectAccess(req,id);
    const r=await pool.query(`SELECT c.*,d.file_name,d.mime_type,d.size_bytes FROM capture_item c LEFT JOIN document d ON d.id=c.document_id WHERE c.company_id=$1 AND c.project_id=$2 ORDER BY c.created_at DESC LIMIT 200`,[auth.companyId,id]);
    return {captures:r.rows};
  });

  app.get('/captures/:id/content',async(req,reply)=>{
    requireScope(req,'documents','read'); const auth=requireAuth(req); const {id}=req.params as {id:string};
    const r=await pool.query(`SELECT d.* FROM capture_item c JOIN document d ON d.id=c.document_id WHERE c.id=$1 AND c.company_id=$2`,[id,auth.companyId]);
    const d=r.rows[0]; if(!d) throw new HttpError(404,'Capture not found');
    reply.header('content-type',d.mime_type??'application/octet-stream'); reply.header('content-disposition',`inline; filename="${encodeURIComponent(d.file_name)}"`);
    return createReadStream(join(config.storageDir,auth.companyId,d.storage_key));
  });

  app.get('/knowledge',async(req)=>{
    requireScope(req,'reports','read'); const auth=requireAuth(req); const q=req.query as {q?:string;kind?:string;project_id?:string};
    const params:unknown[]=[auth.companyId],where=['k.company_id=$1'];
    if(q.q){params.push(`%${q.q}%`);where.push(`(k.title ILIKE $${params.length} OR k.content ILIKE $${params.length})`);}
    if(q.kind){params.push(q.kind);where.push(`k.kind=$${params.length}`);} if(q.project_id){params.push(q.project_id);where.push(`k.project_id=$${params.length}`);}
    const r=await pool.query(`SELECT k.*,u.full_name AS created_by_name FROM knowledge_item k LEFT JOIN "user" u ON u.id=k.created_by WHERE ${where.join(' AND ')} ORDER BY k.created_at DESC LIMIT 200`,params); return {items:r.rows};
  });

  app.post('/knowledge',async(req,reply)=>{
    requireScope(req,'reports','read'); const auth=requireAuth(req); const b=(req.body??{}) as {title?:string;content?:string;kind?:string;project_id?:string;tags?:string[];confidence?:number};
    if(!b.title?.trim()||!b.content?.trim()) throw new HttpError(400,'title and content are required'); if(b.project_id) assertProjectAccess(req,b.project_id);
    const r=await pool.query<{id:string}>(`INSERT INTO knowledge_item(company_id,title,content,kind,project_id,tags,confidence,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[auth.companyId,b.title.trim(),b.content.trim(),b.kind??'general',b.project_id??null,b.tags??[],b.confidence??null,auth.userId]);
    await event(auth.companyId,'knowledge.created','knowledge_item',r.rows[0]!.id,{projectId:b.project_id??null},auth.userId); return reply.code(201).send({id:r.rows[0]!.id});
  });

  app.delete('/knowledge/:id',async(req)=>{
    requireScope(req,'reports','read'); const auth=requireAuth(req); const {id}=req.params as {id:string};
    const r=await pool.query('DELETE FROM knowledge_item WHERE id=$1 AND company_id=$2 RETURNING id',[id,auth.companyId]); if(!r.rowCount) throw new HttpError(404,'Knowledge item not found'); return {ok:true};
  });

  app.get('/approvals',async(req)=>{
    requireScope(req,'purchasing','read'); const auth=requireAuth(req); const q=req.query as {status?:string}; const p:unknown[]=[auth.companyId]; const w=['a.company_id=$1'];
    if(q.status){p.push(q.status);w.push(`a.status=$${p.length}`);}
    const r=await pool.query(`SELECT a.*,rq.full_name AS requested_by_name,d.full_name AS decided_by_name FROM approval_request a LEFT JOIN "user" rq ON rq.id=a.requested_by LEFT JOIN "user" d ON d.id=a.decided_by WHERE ${w.join(' AND ')} ORDER BY a.created_at DESC LIMIT 200`,p); return {approvals:r.rows};
  });

  app.post('/approvals',async(req,reply)=>{
    requireScope(req,'purchasing','write'); const auth=requireAuth(req); const b=(req.body??{}) as {action?:string;entity_type?:string;entity_id?:string;amount?:number;risk?:string;reason?:string};
    if(!b.action||!b.reason) throw new HttpError(400,'action and reason are required');
    const r=await pool.query<{id:string}>(`INSERT INTO approval_request(company_id,requested_by,action,entity_type,entity_id,amount,risk,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[auth.companyId,auth.userId,b.action,b.entity_type??null,b.entity_id??null,b.amount??null,b.risk??'medium',b.reason]);
    await event(auth.companyId,'approval.created','approval_request',r.rows[0]!.id,{action:b.action,amount:b.amount??null},auth.userId); return reply.code(201).send({id:r.rows[0]!.id});
  });

  app.post('/approvals/:id/decision',async(req)=>{
    requireScope(req,'purchasing','approve'); const auth=requireAuth(req); const {id}=req.params as {id:string}; const b=(req.body??{}) as {decision?:string;note?:string};
    if(b.decision!=='approved'&&b.decision!=='rejected') throw new HttpError(400,'Invalid decision');
    const r=await pool.query(`UPDATE approval_request SET status=$1,decided_by=$2,decided_at=now(),decision_note=$3 WHERE id=$4 AND company_id=$5 AND status='pending' RETURNING id`,[b.decision,auth.userId,b.note??null,id,auth.companyId]);
    if(!r.rowCount) throw new HttpError(404,'Pending approval not found'); await event(auth.companyId,`approval.${b.decision}`,'approval_request',id,{note:b.note??null},auth.userId); return {ok:true,status:b.decision};
  });
}
