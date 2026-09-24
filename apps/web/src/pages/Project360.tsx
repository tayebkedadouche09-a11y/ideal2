import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert, Box, Card, CardContent, Chip, Grid, Tab, Tabs, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography, Paper, Button, Dialog, DialogActions,
  DialogContent, DialogTitle, TextField, MenuItem,
} from '@mui/material';
import { fetchProject, fetchProfitability, fetchTimeline, api, list } from '../api';
import { translate, formatMoney, type Locale } from '@company-os/i18n';

type Row = Record<string, unknown>;

export default function Project360() {
  const locale: Locale = (localStorage.getItem('cos.locale') as Locale) ?? 'fr';
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState(0);
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchProject>> | null>(null);
  const [profit, setProfit] = useState<Record<string, unknown> | null>(null);
  const [timeline, setTimeline] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dlg, setDlg] = useState<null | 'measurement' | 'task' | 'report' | 'consumption'>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [materials, setMaterials] = useState<{ value: string; label: string }[]>([]);
  const [workspace, setWorkspace] = useState<{ captures: Row[]; zones: Row[]; boq: Row[]; lessons: Row[] }>({ captures: [], zones: [], boq: [], lessons: [] });

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [d, p, t, captures, engineering, lessons] = await Promise.all([
        fetchProject(id), fetchProfitability(id), fetchTimeline(id),
        api<{ captures: Row[] }>(`/projects/${id}/captures`),
        api<{ zones: Row[]; boq: Row[] }>(`/projects/${id}/zones`),
        api<{ lessons: Row[] }>(`/projects/${id}/lessons`),
      ]);
      setData(d);
      setProfit(p.profitability);
      setTimeline(t);
      setWorkspace({ captures: captures.captures, zones: engineering.zones, boq: engineering.boq, lessons: lessons.lessons });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (dlg === 'consumption' && materials.length === 0) {
      list<Row>('/materials').then((m) => {
        const arr = (Object.values(m).find((v) => Array.isArray(v)) as Row[]) ?? [];
        setMaterials(arr.map((x) => ({ value: String(x.id), label: String(x.name) })));
      }).catch(() => undefined);
    }
  }, [dlg, materials.length]);

  if (!data) return <Typography>{error ?? translate(locale, 'common.loading')}</Typography>;
  const p = data.project;

  async function submit(kind: 'measurement' | 'task' | 'report' | 'consumption') {
    if (!id) return;
    try {
      if (kind === 'measurement') {
        await api(`/projects/${id}/measurements`, {
          method: 'POST',
          body: JSON.stringify({
            zone: form.zone, kind: form.kind ?? 'area',
            area_sqm_input: form.area_sqm_input ? Number(form.area_sqm_input) : undefined,
            length_m: form.length_m ? Number(form.length_m) : undefined,
            width_m: form.width_m ? Number(form.width_m) : undefined,
            thickness_mm: form.thickness_mm ? Number(form.thickness_mm) : undefined,
            product_type: form.product_type || undefined,
          }),
        });
      } else if (kind === 'task') {
        await api(`/projects/${id}/tasks`, { method: 'POST', body: JSON.stringify({ title: form.title, description: form.description || undefined }) });
      } else if (kind === 'report') {
        await api(`/projects/${id}/daily-reports`, { method: 'POST', body: JSON.stringify({ report_date: form.report_date, work_performed: form.work_performed || undefined, manpower_count: form.manpower_count ? Number(form.manpower_count) : undefined }) });
      } else {
        await api(`/projects/${id}/material-consumption`, {
          method: 'POST',
          body: JSON.stringify({ material_id: form.material_id, actual_quantity: Number(form.actual_quantity), reason_code: form.reason_code || undefined, reason_note: form.reason_note || undefined }),
        });
      }
      setDlg(null);
      setForm({});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }

  const num = (v: unknown): string => formatMoney(Number(v ?? 0), locale);

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {String(p.code)} — {String(p.name)} <Chip size="small" label={String(p.status)} />
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} md={6}>
          <Card><CardContent>
            <Typography color="text.secondary">Rentabilité</Typography>
            {profit ? (
              <>
                <Typography>Revenu: {num(profit.revenue)}</Typography>
                <Typography>Coût réel: {num(profit.actualCost)}</Typography>
                <Typography color={Number(profit.operationalMargin) >= 0 ? 'success.main' : 'error'}>
                  Marge: {num(profit.operationalMargin)} ({String(profit.marginPercent)}%)
                </Typography>
                {profit.atRisk ? <Alert severity="warning" sx={{ mt: 1 }}>Projet à risque</Alert> : null}
              </>
            ) : '—'}
          </CardContent></Card>
        </Grid>
        <Grid item xs={12} md={6}>
          <Card><CardContent>
            <Typography color="text.secondary">Planning</Typography>
            <Typography>Prévu: {String(p.planned_start ?? '—')} → {String(p.planned_end ?? '—')}</Typography>
            <Typography>Réel: {String(p.actual_start ?? '—')} → {String(p.actual_end ?? '—')}</Typography>
          </CardContent></Card>
        </Grid>
      </Grid>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Mesures" /><Tab label="Matériaux" /><Tab label="Équipe" /><Tab label="Tâches" />
        <Tab label="Rapports" /><Tab label="Incidents" /><Tab label="Documents" /><Tab label="Chronologie" /><Tab label="Workspace" />
      </Tabs>

      {tab === 0 && (
        <>
          <Button variant="contained" size="small" sx={{ mb: 1 }} onClick={() => setDlg('measurement')}>+ Mesure</Button>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead><TableRow><TableCell>Zone</TableCell><TableCell>Type</TableCell><TableCell>m²</TableCell><TableCell>Épaisseur</TableCell></TableRow></TableHead>
              <TableBody>
                {data.measurements.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell>{String(m.zone)}</TableCell>
                    <TableCell>{String(m.kind)}</TableCell>
                    <TableCell>{String(m.area_sqm ?? '—')}</TableCell>
                    <TableCell>{String(m.thickness_mm ?? '—')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {tab === 1 && (
        <>
          <Button variant="contained" size="small" sx={{ mb: 1 }} onClick={() => setDlg('consumption')}>+ Consommation</Button>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead><TableRow><TableCell>Matériau</TableCell><TableCell>Prévu</TableCell><TableCell>Réel</TableCell><TableCell>Écart</TableCell><TableCell>Motif</TableCell></TableRow></TableHead>
              <TableBody>
                {data.consumption.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell>{String(c.material_name)}</TableCell>
                    <TableCell>{String(c.planned_quantity ?? '—')}</TableCell>
                    <TableCell>{String(c.actual_quantity)}</TableCell>
                    <TableCell>{c.variance != null ? String(c.variance) : '—'}</TableCell>
                    <TableCell>{String(c.reason_code ?? '—')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {tab === 2 && (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead><TableRow><TableCell>Nom</TableCell><TableCell>Rôle</TableCell></TableRow></TableHead>
            <TableBody>
              {data.team.map((m, i) => (
                <TableRow key={i}><TableCell>{String(m.first_name)} {String(m.last_name)}</TableCell><TableCell>{String(m.role_on_project)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {tab === 3 && (
        <>
          <Button variant="contained" size="small" sx={{ mb: 1 }} onClick={() => setDlg('task')}>+ Tâche</Button>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead><TableRow><TableCell>Titre</TableCell><TableCell>Statut</TableCell><TableCell>Début</TableCell><TableCell>Fin</TableCell></TableRow></TableHead>
              <TableBody>
                {data.tasks.map((t, i) => (
                  <TableRow key={i}>
                    <TableCell>{String(t.title)}</TableCell>
                    <TableCell>{String(t.status)}</TableCell>
                    <TableCell>{String(t.planned_start ?? '—')}</TableCell>
                    <TableCell>{String(t.planned_end ?? '—')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {tab === 4 && (
        <>
          <Button variant="contained" size="small" sx={{ mb: 1 }} onClick={() => setDlg('report')}>+ Rapport quotidien</Button>
          {data.dailyReports.length === 0 ? <Typography color="text.secondary">{translate(locale, 'common.none')}</Typography> : (
            data.dailyReports.map((r, i) => (
              <Card key={i} sx={{ mb: 1 }}><CardContent>
                <Typography variant="subtitle2">{String(r.report_date)} — {String(r.manpower_count ?? '')} ouvriers</Typography>
                <Typography>{String(r.work_performed ?? '')}</Typography>
                {r.problems ? <Typography color="warning.main">Problèmes: {String(r.problems)}</Typography> : null}
              </CardContent></Card>
            ))
          )}
        </>
      )}

      {tab === 5 && (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead><TableRow><TableCell>Titre</TableCell><TableCell>Gravité</TableCell><TableCell>Statut</TableCell></TableRow></TableHead>
            <TableBody>
              {data.incidents.map((inc, i) => (
                <TableRow key={i}>
                  <TableCell>{String(inc.title)}</TableCell>
                  <TableCell><Chip size="small" label={String(inc.severity)} /></TableCell>
                  <TableCell>{String(inc.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {tab === 6 && (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead><TableRow><TableCell>Fichier</TableCell><TableCell>Statut</TableCell></TableRow></TableHead>
            <TableBody>
              {data.documents.map((d, i) => (
                <TableRow key={i}><TableCell>{String(d.file_name)}</TableCell><TableCell>{String(d.status)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {tab === 8 && (
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}><Card><CardContent>
            <Typography variant="h6">Captures terrain</Typography>
            {workspace.captures.length ? workspace.captures.map((x,i)=><Typography key={i}>• {String(x.title ?? x.capture_type)} — {String(x.created_at)}</Typography>) : <Typography color="text.secondary">Aucune capture.</Typography>}
          </CardContent></Card></Grid>
          <Grid item xs={12} md={6}><Card><CardContent>
            <Typography variant="h6">Zones chantier</Typography>
            {workspace.zones.length ? workspace.zones.map((x,i)=><Typography key={i}>• {String(x.name)} — {String(x.status)} — {String(x.area_sqm ?? '—')} m²</Typography>) : <Typography color="text.secondary">Aucune zone.</Typography>}
          </CardContent></Card></Grid>
          <Grid item xs={12} md={6}><Card><CardContent>
            <Typography variant="h6">BOQ / Métré chiffré</Typography>
            {workspace.boq.length ? workspace.boq.map((x,i)=><Typography key={i}>• {String(x.description)} — {String(x.quantity)} {String(x.unit ?? '')} × {String(x.unit_price)}</Typography>) : <Typography color="text.secondary">Aucune ligne BOQ.</Typography>}
          </CardContent></Card></Grid>
          <Grid item xs={12} md={6}><Card><CardContent>
            <Typography variant="h6">Mémoire du projet</Typography>
            {workspace.lessons.length ? workspace.lessons.map((x,i)=><Typography key={i}>• {String(x.category)} — {String(x.note)}</Typography>) : <Typography color="text.secondary">Aucune leçon enregistrée.</Typography>}
          </CardContent></Card></Grid>
        </Grid>
      )}

      {tab === 7 && timeline ? (
        <>
          <Typography variant="subtitle2">Tâches</Typography>
          {(timeline.tasks as Row[]).map((t, i) => (
            <Typography key={i}>• {String(t.title)} [{String(t.status)}]</Typography>
          ))}
          <Typography variant="subtitle2" sx={{ mt: 1 }}>Rapports récents</Typography>
          {(timeline.dailyReports as Row[]).slice(0, 10).map((r, i) => (
            <Typography key={i}>• {String(r.report_date)}</Typography>
          ))}
        </>
      ) : null}

      {/* Dialogs */}
      <Dialog open={dlg === 'measurement'} onClose={() => setDlg(null)}>
        <DialogTitle>Nouvelle mesure</DialogTitle>
        <DialogContent>
          <TextField label="Zone" fullWidth margin="dense" value={form.zone ?? ''} onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))} />
          <TextField label="Type" select fullWidth margin="dense" value={form.kind ?? 'area'} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
            {['area', 'rect', 'volume'].map((k) => <MenuItem key={k} value={k}>{k}</MenuItem>)}
          </TextField>
          {form.kind === 'rect' ? (
            <>
              <TextField label="Longueur (m)" type="number" fullWidth margin="dense" value={form.length_m ?? ''} onChange={(e) => setForm((f) => ({ ...f, length_m: e.target.value }))} />
              <TextField label="Largeur (m)" type="number" fullWidth margin="dense" value={form.width_m ?? ''} onChange={(e) => setForm((f) => ({ ...f, width_m: e.target.value }))} />
            </>
          ) : (
            <TextField label="Surface (m²)" type="number" fullWidth margin="dense" value={form.area_sqm_input ?? ''} onChange={(e) => setForm((f) => ({ ...f, area_sqm_input: e.target.value }))} />
          )}
          {form.kind === 'volume' && (
            <TextField label="Épaisseur (mm)" type="number" fullWidth margin="dense" value={form.thickness_mm ?? ''} onChange={(e) => setForm((f) => ({ ...f, thickness_mm: e.target.value }))} />
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setDlg(null)}>Annuler</Button><Button variant="contained" onClick={() => submit('measurement')}>Créer</Button></DialogActions>
      </Dialog>

      <Dialog open={dlg === 'task'} onClose={() => setDlg(null)}>
        <DialogTitle>Nouvelle tâche</DialogTitle>
        <DialogContent>
          <TextField label="Titre" fullWidth margin="dense" value={form.title ?? ''} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          <TextField label="Description" fullWidth margin="dense" value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </DialogContent>
        <DialogActions><Button onClick={() => setDlg(null)}>Annuler</Button><Button variant="contained" onClick={() => submit('task')}>Créer</Button></DialogActions>
      </Dialog>

      <Dialog open={dlg === 'report'} onClose={() => setDlg(null)}>
        <DialogTitle>Rapport quotidien</DialogTitle>
        <DialogContent>
          <TextField label="Date" type="date" fullWidth margin="dense" InputLabelProps={{ shrink: true }} value={form.report_date ?? ''} onChange={(e) => setForm((f) => ({ ...f, report_date: e.target.value }))} />
          <TextField label="Travaux réalisés" fullWidth margin="dense" multiline value={form.work_performed ?? ''} onChange={(e) => setForm((f) => ({ ...f, work_performed: e.target.value }))} />
          <TextField label="Effectif" type="number" fullWidth margin="dense" value={form.manpower_count ?? ''} onChange={(e) => setForm((f) => ({ ...f, manpower_count: e.target.value }))} />
        </DialogContent>
        <DialogActions><Button onClick={() => setDlg(null)}>Annuler</Button><Button variant="contained" onClick={() => submit('report')}>Créer</Button></DialogActions>
      </Dialog>

      <Dialog open={dlg === 'consumption'} onClose={() => setDlg(null)}>
        <DialogTitle>Consommation matériau</DialogTitle>
        <DialogContent>
          <TextField label="Matériau" select fullWidth margin="dense" value={form.material_id ?? ''} onChange={(e) => setForm((f) => ({ ...f, material_id: e.target.value }))}>
            {materials.map((m) => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
          </TextField>
          <TextField label="Quantité réelle" type="number" fullWidth margin="dense" value={form.actual_quantity ?? ''} onChange={(e) => setForm((f) => ({ ...f, actual_quantity: e.target.value }))} />
          <TextField label="Motif (si écart)" select fullWidth margin="dense" value={form.reason_code ?? ''} onChange={(e) => setForm((f) => ({ ...f, reason_code: e.target.value }))}>
            {['', 'rework', 'surface_condition', 'loss', 'measurement_error', 'thickness', 'other'].map((k) => <MenuItem key={k} value={k}>{k || '—'}</MenuItem>)}
          </TextField>
          <TextField label="Note" fullWidth margin="dense" value={form.reason_note ?? ''} onChange={(e) => setForm((f) => ({ ...f, reason_note: e.target.value }))} />
        </DialogContent>
        <DialogActions><Button onClick={() => setDlg(null)}>Annuler</Button><Button variant="contained" disabled={!form.material_id || !form.actual_quantity} onClick={() => submit('consumption')}>Enregistrer</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
