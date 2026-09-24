import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { requireScope, assertProjectAccess, HttpError } from '../auth/rbac.js';
import { audit } from '../auth/audit.js';
import { requireAuth } from '../auth/context.js';

const CHANNEL_KINDS = ['project', 'department', 'private', 'group', 'company'] as const;

type Row = Record<string, unknown>;

/**
 * Channel access (spec §35): kind 'company' → all staff of the company;
 * kind 'project' → users whose record scope includes the project;
 * other kinds → declared members only. Creator is always a member.
 * Customers never get chat access — requireScope excludes them because
 * customer has 'none' on communications.
 */
async function canAccessChannel(
  channelId: string,
  companyId: string,
  userId: string,
  projectScope: 'all' | Set<string>,
): Promise<Row | null> {
  const res = await pool.query<Row>(
    `SELECT * FROM chat_channel WHERE id = $1 AND company_id = $2`, [channelId, companyId],
  );
  const ch = res.rows[0];
  if (!ch) return null;
  if (ch.kind === 'company') return ch;
  if (ch.kind === 'project' && ch.project_id) {
    if (projectScope === 'all' || projectScope.has(String(ch.project_id))) return ch;
    return null;
  }
  const member = await pool.query(
    `SELECT 1 FROM chat_channel_member WHERE channel_id = $1 AND user_id = $2`, [channelId, userId],
  );
  return member.rowCount && member.rowCount > 0 ? ch : null;
}

export function chatRoutes(app: FastifyInstance): void {
  app.get('/chat/channels', async (req) => {
    requireScope(req, 'communications', 'read');
    const auth = requireAuth(req);
    const projectIds = auth.projectScope === 'all' ? null : [...auth.projectScope];
    const res = await pool.query(
      `SELECT c.*, u.full_name AS creator_name,
              (SELECT count(*)::int FROM chat_message m WHERE m.channel_id = c.id) AS message_count,
              (SELECT max(m.created_at) FROM chat_message m WHERE m.channel_id = c.id) AS last_message_at
         FROM chat_channel c
         LEFT JOIN "user" u ON u.id = c.created_by
        WHERE c.company_id = $1
          AND ( c.kind = 'company'
             OR c.created_by = $2
             OR (c.kind = 'project' AND ($3::uuid[] IS NULL OR c.project_id = ANY($3::uuid[])))
             OR EXISTS (SELECT 1 FROM chat_channel_member cm
                         WHERE cm.channel_id = c.id AND cm.user_id = $2) )
        ORDER BY c.kind, c.name`,
      [auth.companyId, auth.userId, projectIds],
    );
    return { channels: res.rows };
  });

  app.post('/chat/channels', async (req, reply) => {
    requireScope(req, 'communications', 'write');
    const auth = requireAuth(req);
    const b = (req.body ?? {}) as { name?: string; kind?: string; project_id?: string; member_user_ids?: string[] };
    if (!b.name) throw new HttpError(400, 'name is required');
    if (!b.kind || !(CHANNEL_KINDS as readonly string[]).includes(b.kind)) {
      throw new HttpError(400, `kind must be one of ${CHANNEL_KINDS.join('|')}`);
    }
    if (b.kind === 'project' && !b.project_id) throw new HttpError(400, 'project_id is required for project channels');
    if (b.project_id) assertProjectAccess(req, b.project_id);

    const ins = await pool.query<{ id: string }>(
      `INSERT INTO chat_channel (company_id, kind, name, project_id, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [auth.companyId, b.kind, b.name, b.project_id ?? null, auth.userId],
    );
    const id = ins.rows[0]!.id;
    const members = new Set<string>([auth.userId, ...(b.member_user_ids ?? []).map(String)]);
    for (const m of members) {
      await pool.query(
        `INSERT INTO chat_channel_member (channel_id, user_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`, [id, m],
      );
    }
    await audit(req, 'create', 'chat_channel', id, { name: b.name, kind: b.kind });
    return reply.code(201).send({ id });
  });

  app.post('/chat/channels/:id/members', async (req, reply) => {
    requireScope(req, 'communications', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const ch = await canAccessChannel(id, auth.companyId, auth.userId, auth.projectScope);
    if (!ch) throw new HttpError(404, 'Channel not found');
    const b = (req.body ?? {}) as { user_id?: string };
    if (!b.user_id) throw new HttpError(400, 'user_id is required');
    const u = await pool.query(`SELECT 1 FROM "user" WHERE id = $1 AND company_id = $2`, [b.user_id, auth.companyId]);
    if (u.rowCount === 0) throw new HttpError(404, 'User not found in this company');
    await pool.query(
      `INSERT INTO chat_channel_member (channel_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, b.user_id],
    );
    await audit(req, 'update', 'chat_channel', id, { added_member: b.user_id });
    return reply.code(201).send({ ok: true });
  });

  app.get('/chat/channels/:id/messages', async (req) => {
    requireScope(req, 'communications', 'read');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const ch = await canAccessChannel(id, auth.companyId, auth.userId, auth.projectScope);
    if (!ch) throw new HttpError(404, 'Channel not found');
    const { before, limit } = req.query as { before?: string; limit?: string };
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const params: unknown[] = [id, lim];
    let where = '';
    if (before) {
      params.push(before);
      where = ` AND m.created_at < (SELECT created_at FROM chat_message WHERE id = $${params.length})`;
    }
    const res = await pool.query(
      `SELECT m.*, u.full_name AS sender_name, d.file_name AS document_name
         FROM chat_message m
         JOIN "user" u ON u.id = m.sender_id
         LEFT JOIN document d ON d.id = m.document_id
        WHERE m.channel_id = $1${where}
        ORDER BY m.created_at DESC LIMIT $2`, params,
    );
    return { messages: res.rows.reverse() };
  });

  app.post('/chat/channels/:id/messages', async (req, reply) => {
    requireScope(req, 'communications', 'write');
    const auth = requireAuth(req);
    const { id } = req.params as { id: string };
    const ch = await canAccessChannel(id, auth.companyId, auth.userId, auth.projectScope);
    if (!ch) throw new HttpError(404, 'Channel not found');
    const b = (req.body ?? {}) as { body?: string; document_id?: string; metadata?: Record<string, unknown> };
    if (!b.body || !b.body.trim()) throw new HttpError(400, 'body is required');
    if (b.document_id) {
      const d = await pool.query(`SELECT 1 FROM document WHERE id = $1 AND company_id = $2`, [b.document_id, auth.companyId]);
      if (d.rowCount === 0) throw new HttpError(404, 'Document not found');
    }
    const res = await pool.query<{ id: string; created_at: Date }>(
      `INSERT INTO chat_message (company_id, channel_id, sender_id, body, metadata, document_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
      [auth.companyId, id, auth.userId, b.body.trim(), b.metadata ? JSON.stringify(b.metadata) : null, b.document_id ?? null],
    );
    // Audit as create on chat_message — structured business records remain the truth (spec §33)
    await audit(req, 'create', 'chat_message', res.rows[0]!.id, { channel_id: id, length: b.body.trim().length });
    return reply.code(201).send({ id: res.rows[0]!.id, created_at: res.rows[0]!.created_at });
  });
}
