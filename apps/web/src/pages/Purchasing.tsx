import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography, Paper, Chip,
} from '@mui/material';
import { api, list, createOne, transition } from '../api';
import { translate, type Locale } from '@company-os/i18n';

type Row = Record<string, unknown>;

interface PoLine { material_id: string; quantity: number; unit_price: number }

const NEXT_ACTIONS: Record<string, string[]> = {
  draft: ['requested'],
  requested: ['approved', 'cancelled'],
  approved: ['ordered', 'cancelled'],
  ordered: [],
  partially_received: [],
  received: [],
  cancelled: [],
};

export default function Purchasing() {
  const locale: Locale = (localStorage.getItem('cos.locale') as Locale) ?? 'fr';
  const [rows, setRows] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<{ value: string; label: string }[]>([]);
  const [materials, setMaterials] = useState<Row[]>([]);
  const [projects, setProjects] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [receive, setReceive] = useState<{ id: string; number: string; lines: Row[] } | null>(null);
  const [receiptQty, setReceiptQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ supplier_id: string; project_id: string; expected_delivery: string; lines: PoLine[] }>({
    supplier_id: '', project_id: '', expected_delivery: '', lines: [{ material_id: '', quantity: 1, unit_price: 0 }],
  });

  const load = useCallback(async () => {
    try {
      const po = await list<Row>('/purchase-orders');
      setRows((Object.values(po).find((v) => Array.isArray(v)) as Row[]) ?? []);
      const s = await list<Row>('/suppliers');
      const sArr = (Object.values(s).find((v) => Array.isArray(v)) as Row[]) ?? [];
      setSuppliers(sArr.map((x) => ({ value: String(x.id), label: String(x.name) })));
      const m = await list<Row>('/materials');
      setMaterials((Object.values(m).find((v) => Array.isArray(v)) as Row[]) ?? []);
      const p = await list<Row>('/projects');
      setProjects((Object.values(p).find((v) => Array.isArray(v)) as Row[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function act(id: string, to: string) {
    setBusy(true);
    setError(null);
    try {
      await transition(`/purchase-orders/${id}/transition`, to);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  async function openReceive(id: string) {
    setBusy(true);
    setError(null);
    try {
      const d = await api<{ purchaseOrder: Row; lines: Row[] }>(`/purchase-orders/${id}`);
      setReceive({ id, number: String(d.purchaseOrder.number), lines: d.lines });
      setReceiptQty({});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  async function submitReceipt() {
    if (!receive) return;
    setBusy(true);
    setError(null);
    try {
      const lines = receive.lines
        .map((l) => ({ purchase_line_id: String(l.id), quantity: Number(receiptQty[String(l.id)] ?? 0) }))
        .filter((l) => l.quantity > 0);
      if (lines.length === 0) {
        setError('Aucune quantité saisie');
        return;
      }
      await api(`/purchase-orders/${receive.id}/goods-receipt`, { method: 'POST', body: JSON.stringify({ lines }) });
      setReceive(null);
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
      await createOne('/purchase-orders', {
        supplier_id: form.supplier_id,
        project_id: form.project_id || undefined,
        expected_delivery: form.expected_delivery || undefined,
        lines: form.lines.map((l) => ({ material_id: l.material_id, quantity: Number(l.quantity), unit_price: Number(l.unit_price) })),
      });
      setOpen(false);
      setForm({ supplier_id: '', project_id: '', expected_delivery: '', lines: [{ material_id: '', quantity: 1, unit_price: 0 }] });
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
        <Typography variant="h6" gutterBottom>{translate(locale, 'nav.purchasing')}</Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Button variant="contained" onClick={() => setOpen(true)} sx={{ mb: 2 }}>{translate(locale, 'nav.new')}</Button>
        {rows.length === 0 ? (
          <Typography color="text.secondary">{translate(locale, 'common.none')}</Typography>
        ) : (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>N°</TableCell><TableCell>Fournisseur</TableCell><TableCell>Statut</TableCell><TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => {
                  const status = String(r.status);
                  return (
                    <TableRow key={String(r.id)}>
                      <TableCell>{String(r.number)}</TableCell>
                      <TableCell>{String(r.supplier_name ?? '—')}</TableCell>
                      <TableCell><Chip size="small" label={status} color={status === 'received' ? 'success' : status === 'cancelled' ? 'error' : 'default'} /></TableCell>
                      <TableCell>
                        {(NEXT_ACTIONS[status] ?? []).map((to) => (
                          <Button key={to} size="small" disabled={busy} onClick={() => act(String(r.id), to)}>
                            {to === 'approved' ? 'Approuver' : to}
                          </Button>
                        ))}
                        {(status === 'ordered' || status === 'partially_received') && (
                          <Button size="small" color="success" disabled={busy} onClick={() => void openReceive(String(r.id))}>Réceptionner</Button>
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

      {/* Create PO */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Nouveau bon de commande</DialogTitle>
        <DialogContent>
          <TextField
            label="Fournisseur" select fullWidth margin="dense" value={form.supplier_id}
            onChange={(e) => setForm((p) => ({ ...p, supplier_id: e.target.value }))}
          >
            {suppliers.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
          </TextField>
          <TextField
            label="Chantier (optionnel)" select fullWidth margin="dense" value={form.project_id}
            onChange={(e) => setForm((p) => ({ ...p, project_id: e.target.value }))}
          >
            <MenuItem value="">—</MenuItem>
            {projects.map((p) => <MenuItem key={String(p.id)} value={String(p.id)}>{String(p.code)} — {String(p.name)}</MenuItem>)}
          </TextField>
          <TextField
            label="Livraison prévue" type="date" fullWidth margin="dense" value={form.expected_delivery}
            onChange={(e) => setForm((p) => ({ ...p, expected_delivery: e.target.value }))} InputLabelProps={{ shrink: true }}
          />
          <Typography variant="subtitle2" sx={{ mt: 2 }}>Lignes</Typography>
          {form.lines.map((l, i) => (
            <TableRow key={i}>
              <TableCell>
                <TextField
                  select value={l.material_id} sx={{ minWidth: 160 }}
                  onChange={(e) => setForm((p) => ({ ...p, lines: p.lines.map((x, j) => (j === i ? { ...x, material_id: e.target.value } : x)) }))}
                >
                  {materials.map((m) => <MenuItem key={String(m.id)} value={String(m.id)}>{String(m.name)}</MenuItem>)}
                </TextField>
              </TableCell>
              <TableCell>
                <TextField type="number" value={l.quantity} sx={{ width: 90 }}
                  onChange={(e) => setForm((p) => ({ ...p, lines: p.lines.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)) }))} />
              </TableCell>
              <TableCell>
                <TextField type="number" value={l.unit_price} sx={{ width: 130 }}
                  onChange={(e) => setForm((p) => ({ ...p, lines: p.lines.map((x, j) => (j === i ? { ...x, unit_price: Number(e.target.value) } : x)) }))} />
              </TableCell>
            </TableRow>
          ))}
          <Button size="small" onClick={() => setForm((p) => ({ ...p, lines: [...p.lines, { material_id: '', quantity: 1, unit_price: 0 }] }))}>
            + Ligne
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{translate(locale, 'common.cancel')}</Button>
          <Button onClick={submit} variant="contained" disabled={busy || !form.supplier_id || form.lines.some((l) => !l.material_id)}>
            {translate(locale, 'common.create')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Goods receipt */}
      <Dialog open={receive !== null} onClose={() => setReceive(null)}>
        <DialogTitle>Réception — {receive?.number}</DialogTitle>
        <DialogContent>
          {receive?.lines.map((l) => {
            const remaining = Number(l.quantity) - Number(l.received_quantity ?? 0);
            return (
              <TableRow key={String(l.id)}>
                <TableCell>{String(l.material_name)} ({String(l.unit)})</TableCell>
                <TableCell>
                  <TextField
                    label={`à recevoir (max ${remaining})`} type="number" size="small" sx={{ width: 160 }}
                    value={receiptQty[String(l.id)] ?? ''}
                    onChange={(e) => setReceiptQty((p) => ({ ...p, [String(l.id)]: e.target.value }))}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReceive(null)}>{translate(locale, 'common.cancel')}</Button>
          <Button onClick={submitReceipt} variant="contained" disabled={busy}>{translate(locale, 'common.confirm')}</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
