import type { FastifyInstance, FastifyRequest } from 'fastify';
import { loadAuthContext } from './context.js';

const PUBLIC_PATHS = new Set(['/auth/login', '/auth/refresh', '/health']);

/**
 * Authentication guard — spec §38 layer 1. Attaches req.auth from a valid
 * access token. Route-level `requireScope` (layer 2), record-scope narrowing
 * (layer 4), action policy and audit complete the seven-layer model.
 */
export function authGuard(app: FastifyInstance): void {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    // Prefer registered route path; fall back to request URL (inject / proxies).
    const raw = (req.routeOptions?.url ?? req.url ?? '').split('?')[0] ?? '';
    const path = raw.replace(/\/+$/, '') || '/';
    if (
      PUBLIC_PATHS.has(path) ||
      path.endsWith('/auth/login') ||
      path.endsWith('/auth/refresh') ||
      path.endsWith('/health')
    ) {
      return;
    }

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      const err = new Error('Missing bearer token') as Error & { statusCode: number };
      err.statusCode = 401;
      throw err;
    }
    try {
      const payload = await req.jwtVerify<{ sub: string; typ: string }>();
      if (payload.typ !== 'access') throw new Error('wrong token type');
      const auth = await loadAuthContext(payload.sub);
      if (!auth) throw new Error('no roles');
      (req as FastifyRequest & { auth?: unknown }).auth = auth;
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 401) throw e;
      const err = new Error('Invalid or expired token') as Error & { statusCode: number };
      err.statusCode = 401;
      throw err;
    }
  });
}
