import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Module } from '@company-os/domain';
import { loadAuthContext } from './context.js';

const PUBLIC_ROUTES = new Set(['POST /auth/login', 'POST /auth/refresh', 'GET /health']);

/**
 * Authentication guard — spec §38 layer 1. Attaches req.auth from a valid
 * access token. Route-level `requireScope` (layer 2), record-scope narrowing
 * (layer 4), action policy and audit complete the seven-layer model.
 */
export function authGuard(app: FastifyInstance): void {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    const route = `${req.method} ${req.routeOptions?.url ?? ''}`;
    if (PUBLIC_ROUTES.has(route)) return;

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
    } catch {
      const err = new Error('Invalid or expired token') as Error & { statusCode: number };
      err.statusCode = 401;
      throw err;
    }
  });
}
