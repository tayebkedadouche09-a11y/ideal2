import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography, Paper,
} from '@mui/material';
import { api, list, uploadDocument } from '../api';
import { translate, type Locale } from '@company-os/i18n';

type Row = Record<string, unknown>;

const ENTITY_TYPES = ['client', 'project', 'quote', 'invoice', 'contract', 'vehicle', 'employee', 'equipment', 'supplier'];

export default function Documents() {
  const locale: Locale = (localStorage.getItem('cos.locale') as Locale) ?? 'fr';
  const [rows, setRows] = useState<Row[]>([]);
  const [projects, setProjects] = useState<Row[]>([]);
  const [clients, setClients] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [entityType, setEntityType] = useState('project');
  const [entityId, setEntityId] = useState('');
  const [customerVisible, setCustomerVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await list<Row>('/documents');
      setRows((Object.values(d).find((v) => Array.isArray(v)) as Row[]) ?? []);
      const p = await list<Row>('/projects');
      setProjects((Object.values(p).find((v) => Array.isArray(v)) as Row[]) ?? []);
      const c = await list<Row>('/clients');
      setClients((Object.values(c).find((v) => Array.isArray(v)) as Row[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submit() {
    if (!file || !entityId) return;
    setBusy(true);
    setError(null);
    try {
      await uploadDocument(file, [{ entity_type: entityType, entity_id: entityId }], customerVisible);
      setOpen(false);
      setFile(null);
      setEntityId('');
      setCustomerVisible(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  const entityOptions = entityType === 'project' ? projects : clients;

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>{translate(locale, 'nav.documents')}</Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Button variant="contained" onClick={() => setOpen(true)} sx={{ mb: 2 }}>{translate(locale, 'nav.new')}</Button>
        {rows.length === 0 ? (
          <Typography color="text.secondary">{translate(locale, 'common.none')}</Typography>
        ) : (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Fichier</TableCell><TableCell>Type</TableCell><TableCell>Taille</TableCell>
                  <TableCell>Client</TableCell><TableCell>Date</TableCell><TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={String(r.id)}>
                    <TableCell>{String(r.file_name)}</TableCell>
                    <TableCell>{String(r.mime_type)}</TableCell>
                    <TableCell>{(Number(r.size_bytes ?? 0) / 1024).toFixed(0)} Ko</TableCell>
                    <TableCell>{r.customer_visible ? <Chip size="small" color="success" label="portail" /> : <Chip size="small" label="interne" />}</TableCell>
                    <TableCell>{String(r.created_at).slice(0, 10)}</TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        onClick={() => window.open(`/api/v1/documents/${String(r.id)}/download`, '_blank')}
                      >
                        Télécharger
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>

      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>Téléverser un document</DialogTitle>
        <DialogContent>
          <input
            type="file" style={{ marginTop: 16, marginBottom: 8 }}
            accept=".pdf,image/*,.docx,.xlsx,.csv,.txt"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <TextField
            label="Lier à" select fullWidth margin="dense" value={entityType}
            onChange={(e) => { setEntityType(e.target.value); setEntityId(''); }}
          >
            {ENTITY_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </TextField>
          {entityType === 'client' ? (
            <TextField
              label="Client" select fullWidth margin="dense" value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            >
              {clients.map((c) => <MenuItem key={String(c.id)} value={String(c.id)}>{String(c.name)}</MenuItem>)}
            </TextField>
          ) : (
            <TextField
              label={entityType === 'project' ? 'Chantier' : `ID ${entityType} (uuid)`} select={entityType === 'project'}
              fullWidth margin="dense" value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            >
              {entityType === 'project' && projects.map((p) => <MenuItem key={String(p.id)} value={String(p.id)}>{String(p.code)} — {String(p.name)}</MenuItem>)}
            </TextField>
          )}
          <TextField
            label="Visible sur le portail client" select fullWidth margin="dense" value={customerVisible ? 'yes' : 'no'}
            onChange={(e) => setCustomerVisible(e.target.value === 'yes')}
          >
            <MenuItem value="no">Non — interne</MenuItem>
            <MenuItem value="yes">Oui — visible par le client</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{translate(locale, 'common.cancel')}</Button>
          <Button onClick={submit} variant="contained" disabled={busy || !file || !entityId}>
            {translate(locale, 'common.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
