import type { FastifyRequest } from 'fastify';
import { pool } from '../db.js';
import { requireAuth } from './context.js';

/**
 * Audit service — spec §41. Important actions append an immutable record with
 * actor, role, action, object, previous/new state and request correlation.
 */
export async function audit(
  req: FastifyRequest,
  action: string,
  entityType: string | null,
  entityId: string | null,
  newState: unknown = null,
  previousState: unknown = null,
): Promise<void> {
  const auth = requireAuth(req);
  await pool.query(
    `INSERT INTO audit_log (company_id, user_id, user_role, action, entity_type, entity_id,
                            previous_state, new_state, request_id, ip, user_agent)
     VALUES ($1,$2,$3,$4::audit_action,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)`,
    [
      auth.companyId,
      auth.userId,
      auth.roles[0] ?? null,
      action,
      entityType,
      entityId,
      previousState === null ? null : JSON.stringify(previousState),
      newState === null ? null : JSON.stringify(newState),
      req.id,
      req.ip,
      req.headers['user-agent'] ?? null,
    ],
  );
}
