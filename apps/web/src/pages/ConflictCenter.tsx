import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography, Divider } from '@mui/material';
import { api } from '../api';

interface SyncConflict {
  id: string; mutation_id: string; entity_type: string; entity_id: string | null;
  client_payload: Record<string, unknown>; server_payload: Record<string, unknown>; created_at: string;
  client_mutation_id?: string; device_id?: string; user_id?: string; user_email?: string;
  base_version?: number | string | null; conflict_reason?: string; operation?: string;
}

export default function ConflictCenter() {
  const [rows, setRows] = useState<SyncConflict[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SyncConflict | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setError(null); setRows((await api<{ conflicts: SyncConflict[] }>('/sync/conflicts')).conflicts); }
    catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function resolve(id: string, resolution: 'client_wins' | 'server_wins' | 'cancelled') {
    setBusy(true);
    try {
      await api(`/sync/conflicts/${id}/resolve`, { method: 'POST', body: JSON.stringify({ resolution }) });
      setSelected(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur résolution'); }
    finally { setBusy(false); }
  }
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Centre de conflits offline</Typography>
        <Button onClick={() => void load()}>Actualiser</Button>
      </Stack>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Typography color="text.secondary" sx={{ mb: 2 }}>Résolution serveur uniquement — jamais d’écrasement silencieux.</Typography>
      {!rows.length && <Alert severity="success">Aucun conflit ouvert pour votre entreprise.</Alert>}
      <Stack spacing={2}>
        {rows.map((c) => (
          <Card key={c.id} variant="outlined"><CardContent>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
              <Box>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                  <Chip size="small" label={c.entity_type} color="warning" />
                  <Chip size="small" label={c.operation ?? '—'} variant="outlined" />
                  <Typography variant="caption">{new Date(c.created_at).toLocaleString()}</Typography>
                </Stack>
                <Typography variant="body2">Raison : <strong>{c.conflict_reason ?? '—'}</strong></Typography>
                <Typography variant="body2" color="text.secondary">Device : {c.device_id ?? '—'} · User : {c.user_email ?? c.user_id ?? '—'}</Typography>
                <Typography variant="body2" color="text.secondary">
                  Entité : {c.entity_id ?? 'nouvelle'} · baseVersion : {String(c.base_version ?? '—')} · serverVersion : {String((c.server_payload as { row_version?: number })?.row_version ?? '—')}
                </Typography>
              </Box>
              <Button variant="contained" onClick={() => setSelected(c)}>Détail / résoudre</Button>
            </Stack>
          </CardContent></Card>
        ))}
      </Stack>
      <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} maxWidth="md" fullWidth>
        {selected && (<>
          <DialogTitle>Conflit {selected.entity_type}</DialogTitle>
          <DialogContent dividers>
            <Typography variant="subtitle2">Payload client</Typography>
            <Box component="pre" sx={{ bgcolor: 'action.hover', p: 1, fontSize: 12, overflow: 'auto' }}>{JSON.stringify(selected.client_payload, null, 2)}</Box>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2">État serveur</Typography>
            <Box component="pre" sx={{ bgcolor: 'action.hover', p: 1, fontSize: 12, overflow: 'auto' }}>{JSON.stringify(selected.server_payload, null, 2)}</Box>
          </DialogContent>
          <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Button disabled={busy} variant="contained" onClick={() => void resolve(selected.id, 'server_wins')}>Conserver serveur</Button>
            <Button disabled={busy} variant="outlined" onClick={() => void resolve(selected.id, 'client_wins')}>Appliquer local</Button>
            <Button disabled={busy} onClick={() => void resolve(selected.id, 'cancelled')}>Annuler mutation</Button>
            <Button onClick={() => setSelected(null)}>Fermer</Button>
          </DialogActions>
        </>)}
      </Dialog>
    </Box>
  );
}
