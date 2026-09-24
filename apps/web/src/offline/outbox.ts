/**
 * V3 offline outbox — IndexedDB-backed mutation queue with versioning and conflict awareness.
 * Replaces the emergency-only queue as the general offline-first path for field mutations.
 * Server remains authoritative; never silently overwrite newer server state.
 */

const DB_NAME = 'ideail-outbox-v1';
const STORE = 'mutations';
const META = 'meta';

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'conflict' | 'rejected' | 'failed';

export interface OutboxMutation {
  id: string;
  deviceId: string;
  entityType: string;
  operation: 'create' | 'update' | 'delete' | 'action';
  payload: Record<string, unknown>;
  clientEntityId?: string;
  entityId?: string;
  baseVersion?: number;
  status: SyncStatus;
  retryCount: number;
  lastError?: string;
  conflictId?: string;
  serverEntityId?: string;
  createdAt: string;
  updatedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  });
}

export function getOrCreateDeviceId(): string {
  const key = 'ideail.deviceId';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export async function enqueueMutation(
  input: Omit<OutboxMutation, 'id' | 'deviceId' | 'status' | 'retryCount' | 'createdAt' | 'updatedAt'> & {
    id?: string;
  },
): Promise<OutboxMutation> {
  const now = new Date().toISOString();
  const item: OutboxMutation = {
    id: input.id ?? crypto.randomUUID(),
    deviceId: getOrCreateDeviceId(),
    entityType: input.entityType,
    operation: input.operation,
    payload: input.payload,
    clientEntityId: input.clientEntityId,
    entityId: input.entityId,
    baseVersion: input.baseVersion,
    status: 'pending',
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  const db = await openDb();
  const t = db.transaction(STORE, 'readwrite');
  t.objectStore(STORE).put(item);
  await txDone(t);
  return item;
}

export async function listMutations(status?: SyncStatus): Promise<OutboxMutation[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly');
    const store = t.objectStore(STORE);
    const req = status ? store.index('status').getAll(status) : store.getAll();
    req.onsuccess = () => resolve((req.result as OutboxMutation[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    req.onerror = () => reject(req.error);
  });
}

export async function updateMutation(id: string, patch: Partial<OutboxMutation>): Promise<void> {
  const db = await openDb();
  const t = db.transaction(STORE, 'readwrite');
  const store = t.objectStore(STORE);
  const getReq = store.get(id);
  await new Promise<void>((resolve, reject) => {
    getReq.onsuccess = () => {
      const cur = getReq.result as OutboxMutation | undefined;
      if (!cur) {
        resolve();
        return;
      }
      const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
      store.put(next);
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
  });
  await txDone(t);
}

export async function removeMutation(id: string): Promise<void> {
  const db = await openDb();
  const t = db.transaction(STORE, 'readwrite');
  t.objectStore(STORE).delete(id);
  await txDone(t);
}

export async function pendingCount(): Promise<number> {
  const items = await listMutations('pending');
  const failed = await listMutations('failed');
  return items.length + failed.length;
}

type ApiFn = <T>(path: string, init?: RequestInit) => Promise<T>;

export async function flushOutbox(api: ApiFn): Promise<{
  synced: number;
  conflicts: number;
  rejected: number;
  failed: number;
}> {
  const deviceId = getOrCreateDeviceId();
  const pending = [...(await listMutations('pending')), ...(await listMutations('failed'))];
  if (pending.length === 0) return { synced: 0, conflicts: 0, rejected: 0, failed: 0 };

  for (const m of pending) {
    await updateMutation(m.id, { status: 'syncing' });
  }

  try {
    const res = await api<{
      results: Array<{
        clientMutationId: string;
        status: string;
        serverEntityId?: string;
        conflictId?: string;
        reason?: string;
      }>;
    }>('/sync/push', {
      method: 'POST',
      body: JSON.stringify({
        deviceId,
        mutations: pending.map((m) => ({
          clientMutationId: m.id,
          entityType: m.entityType,
          operation: m.operation,
          payload: m.payload,
          clientEntityId: m.clientEntityId,
          entityId: m.entityId,
          baseVersion: m.baseVersion,
        })),
      }),
    });

    let synced = 0;
    let conflicts = 0;
    let rejected = 0;
    let failed = 0;

    for (const r of res.results) {
      if (r.status === 'applied' || r.status === 'duplicate' || r.status === 'accepted') {
        await updateMutation(r.clientMutationId, {
          status: 'synced',
          serverEntityId: r.serverEntityId,
          lastError: undefined,
        });
        synced++;
      } else if (r.status === 'conflict') {
        await updateMutation(r.clientMutationId, {
          status: 'conflict',
          conflictId: r.conflictId,
          lastError: r.reason,
        });
        conflicts++;
      } else if (r.status === 'rejected') {
        await updateMutation(r.clientMutationId, {
          status: 'rejected',
          lastError: r.reason,
        });
        rejected++;
      } else {
        const cur = pending.find((p) => p.id === r.clientMutationId);
        await updateMutation(r.clientMutationId, {
          status: 'failed',
          retryCount: (cur?.retryCount ?? 0) + 1,
          lastError: r.reason ?? r.status,
        });
        failed++;
      }
    }
    return { synced, conflicts, rejected, failed };
  } catch (err) {
    for (const m of pending) {
      await updateMutation(m.id, {
        status: 'failed',
        retryCount: m.retryCount + 1,
        lastError: err instanceof Error ? err.message : 'Network error',
      });
    }
    return { synced: 0, conflicts: 0, rejected: 0, failed: pending.length };
  }
}

export async function ensureDeviceRegistered(api: ApiFn): Promise<void> {
  const deviceId = getOrCreateDeviceId();
  const key = `ideail.deviceRegistered.${deviceId}`;
  if (localStorage.getItem(key) === '1') return;
  try {
    await api('/sync/devices', {
      method: 'POST',
      body: JSON.stringify({
        deviceId,
        platform: detectPlatform(),
        label: navigator.userAgent.slice(0, 120),
        appVersion: '0.1.0',
      }),
    });
    localStorage.setItem(key, '1');
  } catch {
    // Will retry on next flush
  }
}

function detectPlatform(): 'web' | 'android' | 'ios' | 'desktop' {
  const ua = navigator.userAgent.toLowerCase();
  if (/android/.test(ua)) return 'android';
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  return 'web';
}

export function startOutboxAutoSync(api: ApiFn, intervalMs = 30_000): () => void {
  let stopped = false;

  const tick = async () => {
    if (stopped || !navigator.onLine) return;
    await ensureDeviceRegistered(api);
    await flushOutbox(api);
  };

  const onOnline = () => { void tick(); };
  window.addEventListener('online', onOnline);
  const timer = window.setInterval(() => { void tick(); }, intervalMs);
  void tick();

  return () => {
    stopped = true;
    window.removeEventListener('online', onOnline);
    window.clearInterval(timer);
  };
}
