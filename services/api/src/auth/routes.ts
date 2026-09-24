import type { FastifyInstance } from 'fastify';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from '../db.js';
import { loadAuthContext } from './context.js';
import { audit } from './audit.js';
import { HttpError } from './rbac.js';
import { requireAuth } from './context.js';

const scryptAsync = promisify(scrypt);

/** scrypt password hashing (spec §38: secure authentication, no plaintext). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hashHex) return false;
  const candidate = await scryptAsync(password, salt, 64) as Buffer;
  const expected = Buffer.from(hashHex, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Brute-force protection: lock account after repeated failures (spec §38). */
const MAX_FAILED = 5;

export function authRoutes(app: FastifyInstance): void {
  app.post('/auth/login', async (req, reply) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    if (!email || !password) {
      return reply.code(400).send({ error: 'email and password required' });
    }

    const res = await pool.query<{
      id: string; email: string; password_hash: string; status: string; company_id: string | null;
      failed_login_count: number; locked_until: Date | null;
    }>(
      `SELECT id, email, password_hash, status, company_id, failed_login_count, locked_until
         FROM "user" WHERE email = $1`,
      [email.toLowerCase().trim()],
    );
    const user = res.rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      if (user) {
        await pool.query(
          `UPDATE "user" SET failed_login_count = failed_login_count + 1,
                  locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + interval '15 minutes' ELSE locked_until END
             WHERE id = $1`,
          [user.id, MAX_FAILED],
        );
        await audit(req, 'login_failed', 'user', user.id);
      }
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    if (user.status !== 'active') return reply.code(403).send({ error: 'Account disabled' });
    if (user.locked_until && user.locked_until > new Date()) {
      return reply.code(423).send({ error: 'Account temporarily locked' });
    }

    const auth = await loadAuthContext(user.id);
    if (!auth) return reply.code(403).send({ error: 'User has no role' });

    const accessToken = app.jwt.sign(
      { sub: user.id, typ: 'access' },
      { expiresIn: `${app.config.accessTtlSeconds}s` },
    );
    const refreshToken = randomBytes(48).toString('base64url');
    await pool.query(
      `INSERT INTO refresh_token (user_id, token_hash, expires_at) VALUES ($1,$2, now() + ($3 || ' seconds')::interval)`,
      [user.id, sha256(refreshToken), String(app.config.refreshTokenTtlSeconds)],
    );
    await pool.query(
      `UPDATE "user" SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`,
      [user.id],
    );
    await audit(req, 'login', 'user', user.id);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        companyId: auth.companyId,
        roles: auth.roles,
        scopes: auth.scopes,
        projectScope: auth.projectScope === 'all' ? 'all' : [...auth.projectScope],
        clientScope: auth.clientScope === 'all' ? 'all' : [...auth.clientScope],
      },
    };
  });

  app.post('/auth/refresh', async (req, reply) => {
    const { refreshToken } = (req.body ?? {}) as { refreshToken?: string };
    if (!refreshToken) return reply.code(400).send({ error: 'refreshToken required' });

    const res = await pool.query<{ user_id: string; expires_at: Date; revoked_at: Date | null }>(
      `SELECT user_id, expires_at, revoked_at FROM refresh_token WHERE token_hash = $1`,
      [sha256(refreshToken)],
    );
    const row = res.rows[0];
    if (!row || row.revoked_at || row.expires_at < new Date()) {
      return reply.code(401).send({ error: 'Invalid refresh token' });
    }
    // Rotation: refresh tokens are single-use
    await pool.query(`UPDATE refresh_token SET revoked_at = now() WHERE token_hash = $1`, [sha256(refreshToken)]);

    const auth = await loadAuthContext(row.user_id);
    if (!auth) return reply.code(403).send({ error: 'User has no role' });

    const accessToken = app.jwt.sign(
      { sub: row.user_id, typ: 'access' },
      { expiresIn: `${app.config.accessTtlSeconds}s` },
    );
    const newRefresh = randomBytes(48).toString('base64url');
    await pool.query(
      `INSERT INTO refresh_token (user_id, token_hash, expires_at) VALUES ($1,$2, now() + ($3 || ' seconds')::interval)`,
      [row.user_id, sha256(newRefresh), String(app.config.refreshTokenTtlSeconds)],
    );
    return { accessToken, refreshToken: newRefresh };
  });

  app.post('/auth/logout', async (req) => {
    const { refreshToken } = (req.body ?? {}) as { refreshToken?: string };
    if (refreshToken) {
      await pool.query(`UPDATE refresh_token SET revoked_at = now() WHERE token_hash = $1`, [sha256(refreshToken)]);
    }
    let userId: string | null = null;
    try {
      userId = requireAuth(req).userId;
    } catch {
      userId = null;
    }
    await audit(req, 'logout', 'user', userId);
    return { ok: true };
  });

  app.get('/auth/me', async (req) => {
    const auth = requireAuth(req);
    const res = await pool.query<{ id: string; email: string; full_name: string; locale: string; mfa_enabled: boolean }>(
      `SELECT id, email, full_name, locale, mfa_enabled FROM "user" WHERE id = $1`,
      [auth.userId],
    );
    const user = res.rows[0];
    if (!user) throw new HttpError(404, 'User not found');
    return {
      user: { ...user, roles: auth.roles, scopes: auth.scopes },
      projectScope: auth.projectScope === 'all' ? 'all' : [...auth.projectScope],
    };
  });
}
