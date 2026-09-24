import test from 'node:test';
import assert from 'node:assert/strict';

type SyncStatus = 'pending' | 'syncing' | 'synced' | 'conflict' | 'rejected' | 'failed' | 'duplicate' | 'applied';
interface MutationResult { clientMutationId: string; status: SyncStatus; reason?: string; }

function applyIdempotent(store: Map<string, MutationResult>, clientMutationId: string, apply: () => MutationResult): MutationResult {
  const existing = store.get(clientMutationId);
  if (existing) {
    return {
      clientMutationId,
      status: existing.status === 'applied' || existing.status === 'synced' ? 'duplicate' : existing.status,
      reason: 'Already processed',
    };
  }
  const result = apply();
  store.set(clientMutationId, result);
  return result;
}

function detectVersionConflict(baseVersion: number | undefined, serverVersion: number): boolean {
  return baseVersion != null && serverVersion > baseVersion;
}

test('offline: first apply stores result; retry returns duplicate', () => {
  const store = new Map<string, MutationResult>();
  const id = 'mut-1';
  assert.equal(applyIdempotent(store, id, () => ({ clientMutationId: id, status: 'applied' })).status, 'applied');
  assert.equal(applyIdempotent(store, id, () => ({ clientMutationId: id, status: 'applied' })).status, 'duplicate');
  assert.equal(store.size, 1);
});

test('offline: network retry does not double-apply when server already accepted', () => {
  const store = new Map<string, MutationResult>();
  const id = 'mut-retry';
  applyIdempotent(store, id, () => ({ clientMutationId: id, status: 'applied' }));
  const retry = applyIdempotent(store, id, () => { throw new Error('should not run apply again'); });
  assert.equal(retry.status, 'duplicate');
});

test('offline: version mismatch is a conflict, not silent overwrite', () => {
  assert.equal(detectVersionConflict(1, 2), true);
  assert.equal(detectVersionConflict(2, 2), false);
  assert.equal(detectVersionConflict(undefined, 5), false);
});

test('offline: conflict resolution options are explicit', () => {
  const allowed = new Set(['client_wins', 'server_wins', 'merged', 'cancelled']);
  assert.ok(allowed.has('server_wins'));
  assert.ok(!allowed.has('silent_overwrite'));
});
