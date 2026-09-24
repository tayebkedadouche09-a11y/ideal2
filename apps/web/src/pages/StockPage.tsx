import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography, Paper, Chip,
} from '@mui/material';
import { api, fetchStock, list, createOne, type StockRow } from '../api';
import { translate, type Locale } from '@company-os/i18n';

type Row = Record<string, unknown>;

export default function StockPage() {
  const locale: Locale = (localStorage.getItem('cos.locale') as Locale) ?? 'fr';
  const [levels, setLevels] = useState<StockRow[]>([]);
  const [alerts, setAlerts] = useState<Row[]>([]);
  const [materials, setMaterials] = useState<Row[]>([]);
  const [locations, setLocations] = useState<{ value: string; label: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ kind: 'entry' });

  const load = useCallback(async () => {
    try {
      const s = await fetchStock();
      setLevels(s.levels);
      setAlerts(s.alerts as Row[]);
      const m = await list<Row>('/materials');
      setMaterials((Object.values(m).find((v) => Array.isArray(v)) as Row[]) ?? []);
      const l = await list<Row>('/stock-locations');
      const arr = (Object.values(l).find((v) => Array.isArray(v)) as Row[]) ?? [];
      setLocations(arr.map((x) => ({ value: String(x.id), label: String(x.name) })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submitMovement() {
    try {
      const body: Record<string, unknown> = {
        material_id: form.material_id,
        kind: form.kind,
        quantity: Number(form.quantity),
      };
      if (form.location_id) body.location_id = form.location_id;
      if (form.batch_number) body.batch_number = form.batch_number;
      if (form.reason) body.reason = form.reason;
      if (form.unit_cost) body.unit_cost = Number(form.unit_cost);
      await createOne('/stock/movements', body);
      setOpen(false);
      setForm({ kind: 'entry' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }

  const alertNames = new Set(alerts.map((a) => String(a.name)));

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>{translate(locale, 'nav.stock')}</Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Button variant="contained" onClick={() => setOpen(true)} sx={{ mb: 2 }}>Mouvement de stock</Button>

        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Article</TableCell><TableCell>SKU</TableCell><TableCell>Emplacement</TableCell>
                <TableCell>Physique</TableCell><TableCell>Réservé</TableCell><TableCell>Disponible</TableCell><TableCell>Min</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {levels.map((l) => (
                <TableRow key={`${l.material_id}-${l.location_name ?? ''}`}>
                  <TableCell>{l.name} {alertNames.has(l.name) && <Chip size="small" color="warning" label="bas" sx={{ ml: 1 }} />}</TableCell>
                  <TableCell>{l.sku}</TableCell>
                  <TableCell>{l.location_name ?? '—'}</TableCell>
                  <TableCell>{Number(l.physical)}</TableCell>
                  <TableCell>{Number(l.reserved)}</TableCell>
                  <TableCell>{Number(l.available)}</TableCell>
                  <TableCell>{Number(l.min_stock)}</TableCell>
                </TableRow>
              ))}
              {levels.length === 0 && (
                <TableRow><TableCell colSpan={7}>{translate(locale, 'common.none')}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <Dialog open={open} onClose={() => setOpen(false)}>
          <DialogTitle>Mouvement de stock</DialogTitle>
          <DialogContent>
            <TextField
              label="Type" select fullWidth margin="dense" value={form.kind}
              onChange={(e) => setForm((p) => ({ ...p, kind: e.target.value }))}
            >
              {['entry', 'exit', 'transfer', 'adjustment'].map((k) => <MenuItem key={k} value={k}>{k}</MenuItem>)}
            </TextField>
            <TextField
              label="Article" select fullWidth margin="dense" value={form.material_id ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, material_id: e.target.value }))}
            >
              {materials.map((m) => <MenuItem key={String(m.id)} value={String(m.id)}>{String(m.name)}</MenuItem>)}
            </TextField>
            <TextField
              label={`Emplacement ${form.kind === 'entry' ? '(requis)' : ''}`} select fullWidth margin="dense"
              value={form.location_id ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, location_id: e.target.value }))}
            >
              {locations.map((l) => <MenuItem key={l.value} value={l.value}>{l.label}</MenuItem>)}
            </TextField>
            <TextField
              label="Quantité" type="number" fullWidth margin="dense" value={form.quantity ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))}
            />
            <TextField
              label="N° de lot" fullWidth margin="dense" value={form.batch_number ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, batch_number: e.target.value }))}
            />
            <TextField
              label="Motif" fullWidth margin="dense" value={form.reason ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
            />
            <TextField
              label="Coût unitaire (DA)" type="number" fullWidth margin="dense" value={form.unit_cost ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, unit_cost: e.target.value }))}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>{translate(locale, 'common.cancel')}</Button>
            <Button
              onClick={submitMovement} variant="contained"
              disabled={!form.material_id || !form.quantity || (form.kind === 'entry' && !form.location_id)}
            >
              {translate(locale, 'common.confirm')}
            </Button>
          </DialogActions>
        </Dialog>
      </CardContent>
    </Card>
  );
}
