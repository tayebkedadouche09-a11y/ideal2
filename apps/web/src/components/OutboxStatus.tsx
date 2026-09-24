import { useCallback, useEffect, useState } from 'react';
import { Badge, Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton, List, ListItem, ListItemText, Stack, Tooltip, Typography } from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import { listMutations, pendingCount, flushOutbox, ensureDeviceRegistered, type OutboxMutation, type SyncStatus } from '../offline/outbox';
import { api } from '../api';

const STATUS_COLOR: Record<SyncStatus, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  synced: 'success', pending: 'warning', syncing: 'info', conflict: 'error', failed: 'error', rejected: 'error',
};

export default function OutboxStatus() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OutboxMutation[]>([]);
  const [flushing, setFlushing] = useState(false);
  const [lastMsg, setLastMsg] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setCount(await pendingCount()); if (open) setItems(await listMutations()); } catch { /* */ }
  }, [open]);
  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => { void refresh(); }, 10_000);
    const onOnline = () => { void refresh(); };
    window.addEventListener('online', onOnline);
    return () => { window.clearInterval(t); window.removeEventListener('online', onOnline); };
  }, [refresh]);
  async function openDetail() { setOpen(true); setItems(await listMutations()); }
  async function doFlush() {
    setFlushing(true);
    try {
      await ensureDeviceRegistered(api);
      const r = await flushOutbox(api);
      setLastMsg(`Sync: ${r.synced} ok, ${r.conflicts} conflits, ${r.rejected} rejetés, ${r.failed} échecs`);
      await refresh(); setItems(await listMutations());
    } catch (e) { setLastMsg(e instanceof Error ? e.message : 'Erreur sync'); }
    finally { setFlushing(false); }
  }
  return (
    <>
      <Tooltip title={count > 0 ? `${count} mutations offline` : 'Outbox sync OK'}>
        <IconButton color="inherit" onClick={() => void openDetail()} size="small" aria-label="État synchronisation offline">
          <Badge badgeContent={count || undefined} color={count ? 'warning' : 'default'}><SyncIcon fontSize="small" /></Badge>
        </IconButton>
      </Tooltip>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Outbox offline</DialogTitle>
        <DialogContent>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }} alignItems="center">
            <Button variant="contained" size="small" disabled={flushing || !navigator.onLine} onClick={() => void doFlush()}>
              {flushing ? 'Sync…' : 'Synchroniser maintenant'}
            </Button>
            <Chip size="small" label={navigator.onLine ? 'En ligne' : 'Hors ligne'} color={navigator.onLine ? 'success' : 'default'} />
          </Stack>
          {lastMsg && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{lastMsg}</Typography>}
          {!items.length && <Typography color="text.secondary">Aucune mutation dans l’outbox local.</Typography>}
          <List dense>
            {items.map((m) => (
              <ListItem key={m.id} alignItems="flex-start" divider>
                <ListItemText
                  primary={<Stack direction="row" spacing={1} alignItems="center"><Chip size="small" label={m.status} color={STATUS_COLOR[m.status]} /><Typography variant="body2">{m.entityType} · {m.operation}</Typography></Stack>}
                  secondary={<Box component="span"><Typography variant="caption" component="span" display="block">{new Date(m.createdAt).toLocaleString()} · retries {m.retryCount}{m.serverEntityId ? ` · server ${m.serverEntityId.slice(0, 8)}…` : ''}</Typography>{m.lastError && <Typography variant="caption" color="error" component="span" display="block">{m.lastError}</Typography></Box>}
                />
              </ListItem>
            ))}
          </List>
        </DialogContent>
      </Dialog>
    </>
  );
}
