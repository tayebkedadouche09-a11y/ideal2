import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography, Paper,
} from '@mui/material';
import { api, list, createOne } from '../api';
import { translate, type Locale } from '@company-os/i18n';

type Row = Record<string, unknown>;
interface VehicleDetail { vehicle: Row; fuel: Row[]; maintenance: Row[]; tires: Row[]; assignments: Row[]; totalFuelCost: number }

export default function Fleet() {
  const locale: Locale = (localStorage.getItem('cos.locale') as Locale) ?? 'fr';
  const [tab, setTab] = useState<'vehicles' | 'equipment'>('vehicles');
  const [rows, setRows] = useState<Row[]>([]);
  const [employees, setEmployees] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<VehicleDetail | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const path = tab === 'vehicles' ? '/vehicles' : '/equipment';
      const d = await list<Row>(path);
      setRows((Object.values(d).find((v) => Array.isArray(v)) as Row[]) ?? []);
      const e = await list<Row>('/employees');
      setEmployees((Object.values(e).find((v) => Array.isArray(v)) as Row[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }, [tab]);

  useEffect(() => { void load(); }, [load]);

  async function openDetail(id: string) {
    setBusy(true);
    setError(null);
    try {
      setDetail(await api<VehicleDetail>(`/vehicles/${id}`));
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
      if (tab === 'vehicles') {
        await createOne('/vehicles', {
          registration: form.registration,
          model: form.model || undefined,
          type: form.type || undefined,
          insurance_expiry: form.insurance_expiry || undefined,
          inspection_expiry: form.inspection_expiry || undefined,
        });
      } else {
        await createOne('/equipment', {
          name: form.name,
          serial_number: form.serial_number || undefined,
          kind: form.kind || undefined,
        });
      }
      setOpen(false);
      setForm({});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  async function post(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      if (detail && detail.vehicle) await openDetail(String(detail.vehicle.id));
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
        <Typography variant="h6" gutterBottom>{translate(locale, tab === 'vehicles' ? 'nav.vehicles' : 'nav.equipment')}</Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Button
          variant={tab === 'vehicles' ? 'contained' : 'outlined'} sx={{ mr: 1, mb: 2 }}
          onClick={() => setTab('vehicles')}
        >
          Véhicules ({rows.length})
        </Button>
        <Button
          variant={tab === 'equipment' ? 'contained' : 'outlined'} sx={{ mb: 2 }}
          onClick={() => setTab('equipment')}
        >
          Équipements
        </Button>
        <Button variant="contained" color="primary" sx={{ mb: 2, ml: 2 }} onClick={() => setOpen(true)}>
          {translate(locale, 'nav.new')}
        </Button>

        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {(tab === 'vehicles'
                  ? ['Immat.', 'Modèle', 'Statut', 'Km', '']
                  : ['Nom', 'N° série', 'Heures', '']
                ).map((h) => <TableCell key={h}>{h}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={String(r.id)}>
                  {tab === 'vehicles' ? (
                    <>
                      <TableCell>{String(r.registration)}</TableCell>
                      <TableCell>{String(r.model ?? '—')}</TableCell>
                      <TableCell><Chip size="small" label={String(r.status ?? 'available')} /></TableCell>
                      <TableCell>{Number(r.current_mileage ?? 0).toLocaleString('fr-DZ')}</TableCell>
                      <TableCell><Button size="small" onClick={() => void openDetail(String(r.id))}>Détail</Button></TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell>{String(r.name)}</TableCell>
                      <TableCell>{String(r.serial_number ?? '—')}</TableCell>
                      <TableCell>{Number(r.usage_hours ?? 0)}</TableCell>
                      <TableCell>
                        <Button size="small" disabled={busy} onClick={() => post(`/equipment/${String(r.id)}/usage`, { date: new Date().toISOString().slice(0, 10), hours: 1 })}>
                          +1h
                        </Button>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
              {rows.length === 0 && <TableRow><TableCell colSpan={5}>{translate(locale, 'common.none')}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>

      {/* Create vehicle/equipment */}
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>{tab === 'vehicles' ? 'Nouveau véhicule' : 'Nouvel équipement'}</DialogTitle>
        <DialogContent>
          {tab === 'vehicles' ? (
            <>
              <TextField label="Immatriculation" fullWidth margin="dense" value={form.registration ?? ''} onChange={(e) => setForm((p) => ({ ...p, registration: e.target.value }))} />
              <TextField label="Modèle" fullWidth margin="dense" value={form.model ?? ''} onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))} />
              <TextField label="Type" fullWidth margin="dense" value={form.type ?? ''} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))} />
              <TextField label="Assurance jusqu'au" type="date" fullWidth margin="dense" InputLabelProps={{ shrink: true }} value={form.insurance_expiry ?? ''} onChange={(e) => setForm((p) => ({ ...p, insurance_expiry: e.target.value }))} />
              <TextField label="Contrôle technique jusqu'au" type="date" fullWidth margin="dense" InputLabelProps={{ shrink: true }} value={form.inspection_expiry ?? ''} onChange={(e) => setForm((p) => ({ ...p, inspection_expiry: e.target.value }))} />
            </>
          ) : (
            <>
              <TextField label="Nom" fullWidth margin="dense" value={form.name ?? ''} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              <TextField label="N° de série" fullWidth margin="dense" value={form.serial_number ?? ''} onChange={(e) => setForm((p) => ({ ...p, serial_number: e.target.value }))} />
              <TextField label="Type" fullWidth margin="dense" value={form.kind ?? ''} onChange={(e) => setForm((p) => ({ ...p, kind: e.target.value }))} />
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{translate(locale, 'common.cancel')}</Button>
          <Button onClick={submit} variant="contained" disabled={busy || !(tab === 'vehicles' ? form.registration : form.name)}>
            {translate(locale, 'common.create')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Vehicle detail: fuel / maintenance / tires / assignment */}
      <Dialog open={detail !== null} onClose={() => setDetail(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{detail ? String(detail.vehicle.registration) : ''}</DialogTitle>
        <DialogContent>
          {detail && (
            <>
              <Typography variant="subtitle2" sx={{ mt: 1 }}>Ravitaillement (coût total {detail.totalFuelCost.toLocaleString('fr-DZ')} DA)</Typography>
              {detail.fuel.slice(0, 5).map((f) => (
                <Typography key={String(f.id)} variant="body2">
                  {String(f.date).slice(0, 10)} — {Number(f.quantity_l)} L @ {Number(f.price_per_l)} DA
                </Typography>
              ))}
              <Button size="small" sx={{ mt: 1 }} disabled={busy} onClick={() => {
                const date = prompt('Date (YYYY-MM-DD)'); const mileage = prompt('Kilométrage');
                const quantity = prompt('Litres'); const price = prompt('Prix / litre (DA)');
                if (date && mileage && quantity && price) {
                  void post(`/vehicles/${String(detail.vehicle.id)}/fuel`, { date, mileage: Number(mileage), quantity_l: Number(quantity), price_per_l: Number(price) });
                }
              }}>
                + Carburant
              </Button>

              <Typography variant="subtitle2" sx={{ mt: 2 }}>Maintenance</Typography>
              {detail.maintenance.slice(0, 5).map((m) => (
                <Typography key={String(m.id)} variant="body2">
                  {String(m.date).slice(0, 10)} — {String(m.kind)} ({Number(m.total_cost ?? 0)} DA)
                </Typography>
              ))}
              <Button size="small" sx={{ mt: 1 }} disabled={busy} onClick={() => {
                const kind = prompt('Type (preventive/curative/inspection/tires)');
                const date = prompt('Date (YYYY-MM-DD)');
                if (kind && date) {
                  void post(`/vehicles/${String(detail.vehicle.id)}/maintenance`, { kind, date, parts_cost: Number(prompt('Coût pièces (DA)') ?? 0), labor_cost: Number(prompt('Coût main d\'œuvre (DA)') ?? 0), next_due_date: prompt('Prochaine échéance (YYYY-MM-DD)') ?? undefined });
                }
              }}>
                + Maintenance
              </Button>

              <Typography variant="subtitle2" sx={{ mt: 2 }}>Pneus</Typography>
              {detail.tires.map((t) => <Typography key={String(t.id)} variant="body2">{String(t.reference)} — {String(t.position ?? '')} ({String(t.condition)})</Typography>)}
              <Button size="small" sx={{ mt: 1 }} disabled={busy} onClick={() => {
                const reference = prompt('Référence pneu');
                if (reference) void post(`/vehicles/${String(detail.vehicle.id)}/tires`, { reference, cost: Number(prompt('Coût (DA)') ?? 0) });
              }}>
                + Pneu
              </Button>

              <Typography variant="subtitle2" sx={{ mt: 2 }}>Affectation</Typography>
              {detail.assignments.length > 0
                ? detail.assignments.map((a) => <Typography key={String(a.id)} variant="body2">Affecté (depuis {String(a.assigned_from ?? '—').slice(0, 10)})</Typography>)
                : <Typography variant="body2">Non affecté</Typography>}
              <TextField
                select fullWidth margin="dense" label="Affecter à un employé (conducteur)"
                value="" onChange={(e) => e.target.value && post(`/vehicles/${String(detail.vehicle.id)}/assign`, { driver_employee_id: e.target.value })}
              >
                {employees.map((emp) => (
                  <MenuItem key={String(emp.id)} value={String(emp.id)}>{String(emp.first_name)} {String(emp.last_name)}</MenuItem>
                ))}
              </TextField>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetail(null)}>{translate(locale, 'common.close')}</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
