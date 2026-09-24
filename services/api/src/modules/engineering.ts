import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { requireScope, assertProjectAccess, HttpError } from '../auth/rbac.js';
import { audit } from '../auth/audit.js';
import { requireAuth } from '../auth/context.js';

export function engineeringRoutes(app: FastifyInstance): void {
  app.get('/projects/:id/zones', async (req) => {
    requireScope(req, 'projects', 'read');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    assertProjectAccess(req, id);
    const zones = await pool.query(
      'SELECT * FROM project_zone WHERE company_id=$1 AND project_id=$2 ORDER BY created_at',
      [auth.companyId, id],
    );
    const boq = await pool.query(
      'SELECT b.*, m.name AS material_name FROM zone_boq_line b LEFT JOIN material m ON m.id=b.material_id JOIN project_zone z ON z.id=b.zone_id WHERE z.company_id=$1 AND z.project_id=$2 ORDER BY b.position,b.created_at',
      [auth.companyId, id],
    );
    return { zones: zones.rows, boq: boq.rows };
  });

  app.post('/projects/:id/zones', async (req, reply) => {
    requireScope(req, 'projects', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    assertProjectAccess(req, id);
    const b = (req.body ?? {}) as { name?: string; description?: string; area_sqm?: number; status?: string };
    if (!b.name?.trim()) throw new HttpError(400, 'name is required');
    if (b.status && !['planned','in_progress','completed','blocked'].includes(b.status)) throw new HttpError(400, 'Invalid zone status');
    const r = await pool.query<{id:string}>(
      'INSERT INTO project_zone(company_id,project_id,name,description,area_sqm,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
      [auth.companyId,id,b.name.trim(),b.description ?? null,b.area_sqm ?? null,b.status ?? 'planned'],
    );
    await audit(req,'create','project_zone',r.rows[0]!.id,{project_id:id,name:b.name});
    return reply.code(201).send({id:r.rows[0]!.id});
  });

  app.patch('/zones/:id', async (req) => {
    requireScope(req, 'projects', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { name?: string; description?: string; area_sqm?: number|null; status?: string };
    const z = await pool.query<{project_id:string}>('SELECT project_id FROM project_zone WHERE id=$1 AND company_id=$2',[id,auth.companyId]);
    if (!z.rowCount) throw new HttpError(404,'Zone not found');
    assertProjectAccess(req,z.rows[0]!.project_id);
    const fields:string[]=[]; const values:unknown[]=[];
    if (b.name !== undefined) { fields.push(`name=$${values.length+1}`); values.push(b.name.trim()); }
    if (b.description !== undefined) { fields.push(`description=$${values.length+1}`); values.push(b.description); }
    if (b.area_sqm !== undefined) { fields.push(`area_sqm=$${values.length+1}`); values.push(b.area_sqm); }
    if (b.status !== undefined) {
      if (!['planned','in_progress','completed','blocked'].includes(b.status)) throw new HttpError(400,'Invalid zone status');
      fields.push(`status=$${values.length+1}`); values.push(b.status);
    }
    if (!fields.length) throw new HttpError(400,'Nothing to update');
    values.push(id,auth.companyId);
    await pool.query(`UPDATE project_zone SET ${fields.join(',')},updated_at=now() WHERE id=$${values.length-1} AND company_id=$${values.length}`,values);
    await audit(req,'update','project_zone',id,b);
    return {ok:true};
  });

  app.post('/zones/:id/boq', async (req, reply) => {
    requireScope(req, 'projects', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const z = await pool.query<{project_id:string}>('SELECT project_id FROM project_zone WHERE id=$1 AND company_id=$2',[id,auth.companyId]);
    if (!z.rowCount) throw new HttpError(404,'Zone not found');
    assertProjectAccess(req,z.rows[0]!.project_id);
    const b = (req.body ?? {}) as { kind?:string; description?:string; quantity?:number; unit?:string; unit_price?:number; waste_factor_percent?:number; discount_percent?:number; material_id?:string; measurement_id?:string; position?:number };
    if (!b.description?.trim()) throw new HttpError(400,'description is required');
    if (!b.kind || !['measurement','material','labor','equipment','transport','other'].includes(b.kind)) throw new HttpError(400,'Invalid BOQ kind');
    const r=await pool.query<{id:string}>(
      'INSERT INTO zone_boq_line(company_id,zone_id,kind,description,quantity,unit,unit_price,waste_factor_percent,discount_percent,material_id,measurement_id,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',
      [auth.companyId,id,b.kind,b.description.trim(),b.quantity ?? 0,b.unit ?? null,b.unit_price ?? 0,b.waste_factor_percent ?? 0,b.discount_percent ?? 0,b.material_id ?? null,b.measurement_id ?? null,b.position ?? 0],
    );
    await audit(req,'create','zone_boq_line',r.rows[0]!.id,{zone_id:id});
    return reply.code(201).send({id:r.rows[0]!.id});
  });

  app.delete('/zones/:zoneId/boq/:lineId', async (req) => {
    requireScope(req,'projects','write');
    const auth=requireAuth(req);
    const {zoneId,lineId}=req.params as {zoneId:string;lineId:string};
    const z=await pool.query<{project_id:string}>('SELECT project_id FROM project_zone WHERE id=$1 AND company_id=$2',[zoneId,auth.companyId]);
    if(!z.rowCount) throw new HttpError(404,'Zone not found');
    assertProjectAccess(req,z.rows[0]!.project_id);
    const r=await pool.query('DELETE FROM zone_boq_line WHERE id=$1 AND zone_id=$2 RETURNING id',[lineId,zoneId]);
    if(!r.rowCount) throw new HttpError(404,'BOQ line not found');
    await audit(req,'delete','zone_boq_line',lineId,{zone_id:zoneId});
    return {ok:true};
  });
}
