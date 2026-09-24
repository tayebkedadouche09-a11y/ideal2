import { useCallback, useEffect, useState } from 'react';
import {
  Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography, Paper, Alert,
} from '@mui/material';
import { api, list, createQuote, updateQuote, convertQuote, transition } from '../api';
import { translate, type Locale } from '@company-os/i18n';

type Row = Record<string, unknown>;

interface Line { kind: string; description: string; quantity: number; unit_price: number; discount_percent: number }

const NEXT_ACTIONS: Record<string, { to: string; label: string }[]> = {
  draft: [{ to: 'review', label: 'Soumettre en revue' }],
  review: [{ to: 'approved', label: 'Approuver' }, { to: 'draft', label: 'Retour brouillon' }],
  approved: [{ to: 'sent', label: 'Envoyer au client' }],
  sent: [{ to: 'accepted', label: 'Accepté' }, { to: 'rejected', label: 'Rejeté' }],
  accepted: [],
  rejected: [{ to: 'draft', label: 'Réviser' }],
  converted: [],
};

export default function Quotes() {
  const locale: Locale = (localStorage.getItem('cos.locale') as Locale) ?? 'fr';
  const [rows, setRows] = useState<Row[]>([]);
  const [clients, setClients] = useState<{ value: string; label: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ title: string; client_id: string; tax_rate: string }>({ title: '', client_id: '', tax_rate: '19' });
  const [lines, setLines] = useState<Line[]>([{ kind: 'measurement', description: '', quantity: 1, unit_price: 0, discount_percent: 0 }]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = await list<Row>('/quotes');
      setRows((Object.values(q).find((v) => Array.isArray(v)) as Row[]) ?? []);
      const c = await list<Row>('/clients');
      const arr = (Object.values(c).find((v) => Array.isArray(v)) as Row[]) ?? [];
      setClients(arr.map((x) => ({ value: String(x.id), label: String(x.name) })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function act(id: string, to: string) {
    setBusy(true);
    setError(null);
    try {
      await transition(`/quotes/${id}/transition`, to);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  async function doConvert(id: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await convertQuote(id);
      setError(null);
      alert(`Chantier créé: ${r.code}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await createQuote({
        title: form.title,
        client_id: form.client_id,
        tax_rate: Number(form.tax_rate) || 0,
        lines: lines.map((l) => ({ ...l, quantity: Number(l.quantity), unit_price: Number(l.unit_price), discount_percent: Number(l.discount_percent) })),
      });
      setOpen(false);
      setForm({ title: '', client_id: '', tax_rate: '19' });
      setLines([{ kind: 'measurement', description: '', quantity: 1, unit_price: 0, discount_percent: 0 }]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>{translate(locale, 'nav.quotes')}</Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Button variant="contained" onClick={() => setOpen(true)} sx={{ mb: 2 }}>{translate(locale, 'nav.new')}</Button>
        {rows.length === 0 ? (
          <Typography color="text.secondary">{translate(locale, 'common.none')}</Typography>
        ) : (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Devis</TableCell><TableCell>Client</TableCell><TableCell>Statut</TableCell><TableCell>Total (DZD)</TableCell><TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => {
                  const status = String(r.status);
                  const actions = NEXT_ACTIONS[status] ?? [];
                  return (
                    <TableRow key={String(r.id)}>
                      <TableCell>{String(r.number)} — {String(r.title ?? '')}</TableCell>
                      <TableCell>{String(r.client_name ?? '—')}</TableCell>
                      <TableCell><Chip size="small" label={status} color={status === 'accepted' || status === 'converted' ? 'success' : status === 'rejected' ? 'error' : 'default'} /></TableCell>
                      <TableCell>{Number(r.total).toLocaleString('fr-DZ')}</TableCell>
                      <TableCell>
                        {actions.map((a) => (
                          <Button key={a.to} size="small" disabled={busy} onClick={() => act(String(r.id), a.to)}>{a.label}</Button>
                        ))}
                        {status === 'accepted' && (
                          <Button size="small" color="success" disabled={busy} onClick={() => doConvert(String(r.id))}>Convertir en chantier</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Nouveau devis</DialogTitle>
        <DialogContent>
          <TextField label="Titre" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} fullWidth margin="dense" />
          <TextField
            label="Client"
            select
            value={form.client_id}
            onChange={(e) => setForm((p) => ({ ...p, client_id: e.target.value }))}
            fullWidth margin="dense"
          >
            {clients.map((c) => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
          </TextField>
          <TextField label="TVA (%)" type="number" value={form.tax_rate} onChange={(e) => setForm((p) => ({ ...p, tax_rate: e.target.value }))} fullWidth margin="dense" />
          <Typography variant="subtitle2" sx={{ mt: 2 }}>Lignes</Typography>
          {lines.map((l, i) => (
            <Table key={i} size="small">
              <TableBody>
                <TableRow>
                  <TableCell>
                    <TextField
                      select value={l.kind}
                      onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}
                      sx={{ minWidth: 120 }}
                    >
                      {['measurement', 'material', 'labor', 'equipment', 'transport', 'other'].map((k) => (
                        <MenuItem key={k} value={k}>{k}</MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                  <TableCell>
                    <TextField placeholder="Description" value={l.description}
                      onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                  </TableCell>
                  <TableCell>
                    <TextField type="number" value={l.quantity} sx={{ width: 90 }}
                      onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} />
                  </TableCell>
                  <TableCell>
                    <TextField type="number" value={l.unit_price} sx={{ width: 120 }}
                      onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, unit_price: Number(e.target.value) } : x)))} />
                  </TableCell>
                  <TableCell>
                    <TextField type="number" value={l.discount_percent} sx={{ width: 90 }}
                      onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, discount_percent: Number(e.target.value) } : x)))} />
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          ))}
          <Button size="small" onClick={() => setLines((p) => [...p, { kind: 'measurement', description: '', quantity: 1, unit_price: 0, discount_percent: 0 }])}>
            + Ligne
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{translate(locale, 'common.cancel')}</Button>
          <Button onClick={submit} variant="contained" disabled={busy || !form.title || !form.client_id}>{translate(locale, 'common.create')}</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
