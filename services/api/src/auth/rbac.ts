import type { FastifyRequest } from 'fastify';
import type { Module } from '@company-os/domain';
import { can } from '@company-os/domain';
import { requireAuth } from './context.js';

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

/** Layer 2: role permission on a module — granted if ANY role grants it. */
export function requireScope(req: FastifyRequest, module: Module, needed: 'read' | 'write' | 'approve'): void {
  const auth = requireAuth(req);
  if (!auth.roles.some((r) => can(r, module, needed))) {
    throw new HttpError(403, `Forbidden: ${needed} on ${module}`);
  }
}

/** Layer 4: record scope — project-level narrowing. */
export function assertProjectAccess(req: FastifyRequest, projectId: string): void {
  const auth = requireAuth(req);
  if (auth.projectScope === 'all') return;
  if (!auth.projectScope.has(projectId)) {
    throw new HttpError(403, 'Forbidden: project not assigned to you');
  }
}

/** Layer 4: record scope — customer portal client narrowing. */
export function assertClientAccess(req: FastifyRequest, clientId: string): void {
  const auth = requireAuth(req);
  if (auth.clientScope === 'all') return;
  if (!auth.clientScope.has(clientId)) {
    throw new HttpError(403, 'Forbidden: client not accessible');
  }
}
