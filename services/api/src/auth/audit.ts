import type { FastifyRequest } from 'fastify';
import { pool } from '../db.js';
import type { AuthContext } from './context.js';

/**
 * Explicit actor for audit events that occur before an authenticated request
 * context exists (login, failed login). The caller must pass values it has
 * already verified against the database — this never widens access, it only
 * records who the event belongs to.
 */
export interface AuditActor {
  companyId?: string | null;
  userId?: string | null;
  role?: string | null;
}

/**
 * Audit service — spec §41. Important actions append an immutable record with
 * actor, role, action, object, previous/new state and request correlation.
 *
 * The actor is taken from the server-verified request context when present;
 * pre-authentication events (e.g. login) supply an explicit `actor` instead.
 */
export async function audit(
  req: FastifyRequest,
  action: string,
  entityType: string | null,
  entityId: string | null,
  newState: unknown = null,
  previousState: unknown = null,
  actor?: AuditActor,
): Promise<void> {
  const auth = (req as FastifyRequest & { auth?: AuthContext }).auth;
  const companyId = actor?.companyId ?? auth?.companyId ?? null;
  const userId = actor?.userId ?? auth?.userId ?? null;
  const role = actor?.role ?? auth?.roles?.[0] ?? null;
  await pool.query(
    `INSERT INTO audit_log (company_id, user_id, user_role, action, entity_type, entity_id,
                            previous_state, new_state, request_id, ip, user_agent)
     VALUES ($1,$2,$3,$4::audit_action,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)`,
    [
      companyId,
      userId,
      role,
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
