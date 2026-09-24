import type { FastifyRequest } from 'fastify';
import type { Role, Module, PermissionScope } from '@company-os/domain';
import { PERMISSION_MATRIX } from '@company-os/domain';
import { pool } from '../db.js';

/** Authenticated caller context — spec §38: user → company → role → record. */
export interface AuthContext {
  userId: string;
  companyId: string;
  roles: Role[];
  /** Union of scopes granted by any role per module. */
  scopes: Partial<Record<Module, PermissionScope>>;
  /** Project IDs the user is explicitly assigned to (record-scope layer 4). */
  projectScope: 'all' | Set<string>;
  /** Client IDs a portal customer may see (record-scope layer 4). */
  clientScope: 'all' | Set<string>;
}

const GLOBAL_ROLES: Role[] = ['owner', 'accountant', 'storekeeper', 'driver'];
const ALL_ROLES = new Set<string>([
  'owner','accountant','engineer','team_leader','worker','storekeeper','driver','customer',
]);

export async function loadAuthContext(userId: string): Promise<AuthContext | null> {
  const rolesRes = await pool.query<{ role_key: string; company_id: string }>(
    `SELECT r.key AS role_key, r.company_id
       FROM user_role ur JOIN role r ON r.id = ur.role_id
      WHERE ur.user_id = $1`,
    [userId],
  );
  if (rolesRes.rowCount === 0) return null;

  const companyId = rolesRes.rows[0]!.company_id;
  const roles = rolesRes.rows.map((r) => r.role_key).filter((k): k is Role => ALL_ROLES.has(k));
  if (roles.length === 0) return null;

  // Union of module scopes across roles
  const scopes: Partial<Record<Module, PermissionScope>> = {};
  const order: Record<PermissionScope, number> = { none: 0, read: 1, write: 2, approve: 3 };
  for (const role of roles) {
    for (const [mod, s] of Object.entries(PERMISSION_MATRIX[role])) {
      const m = mod as Module;
      if (order[s] > order[scopes[m] ?? 'none']) scopes[m] = s;
    }
  }

  let projectScope: 'all' | Set<string> = 'all';
  let clientScope: 'all' | Set<string> = 'all';

  if (!roles.some((r) => GLOBAL_ROLES.includes(r)) || roles.includes('customer')) {
    // Customers are never global; non-global roles get assigned-project scope only.
    if (roles.includes('customer')) projectScope = new Set();
    // Record-scope narrowing: engineer/team_leader/worker → assigned projects only
    const projRes = await pool.query<{ project_id: string }>(
      `SELECT DISTINCT pm.project_id
         FROM project_member pm JOIN employee e ON e.id = pm.employee_id
        WHERE e.user_id = $1 AND pm.role_on_project = ANY($2)
        UNION
       SELECT DISTINCT ta.project_id
         FROM team_assignment ta
         JOIN team_member tm ON tm.team_id = ta.team_id
         JOIN employee e ON e.id = tm.employee_id
        WHERE e.user_id = $1`,
      [userId, ['engineer', 'team_leader', 'worker', 'driver', 'storekeeper']],
    );
    projectScope = new Set(projRes.rows.map((r) => r.project_id));

    // Customer portal: only linked clients
    const custRes = await pool.query<{ client_id: string }>(
      `SELECT client_id FROM client_portal_user WHERE user_id = $1`,
      [userId],
    );
    if (custRes.rows.length > 0) clientScope = new Set(custRes.rows.map((r) => r.client_id));
  }

  return { userId, companyId, roles, scopes, projectScope, clientScope };
}

export function requireAuth(req: FastifyRequest): AuthContext {
  const auth = (req as FastifyRequest & { auth?: AuthContext }).auth;
  if (!auth) {
    const err = new Error('Authentication required') as Error & { statusCode: number };
    err.statusCode = 401;
    throw err;
  }
  return auth;
}
