import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, MenuItem,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography, Paper,
} from '@mui/material';
import { api, fetchPortalHome, type PortalData } from '../api';
import { formatMoney, translate, type Locale } from '@company-os/i18n';

type Row = Record<string, unknown>;

type TabKey = 'projects' | 'invoices' | 'documents' | 'messages';

export default function Portal() {
  const locale: Locale = (localStorage.getItem('cos.locale') as Locale) ?? 'fr';
  const [data, setData] = useState<Partial<PortalData> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('projects');
  const [msgOpen, setMsgOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchPortalHome());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function sendMessage() {
    setBusy(true);
    setError(null);
    try {
      await api('/portal/messages', {
        method: 'POST',
        body: JSON.stringify({ client_id: clientId, subject: subject || null, body }),
      });
      setMsgOpen(false);
      setSubject('');
      setBody('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  const clients = data?.clients ?? [];

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'projects', label: 'Chantiers' },
    { key: 'invoices', label: 'Factures' },
    { key: 'documents', label: 'Documents' },
    { key: 'messages', label: 'Messages' },
  ];

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>Espace client</Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {!data && !error && <Typography color="text.secondary">{translate(locale, 'common.loading')}</Typography>}

        {data && (
          <>
            {clients.length > 0 && (
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {clients.map((c) => String(c.name)).join(' · ')}
              </Typography>
            )}
            {TABS.map((t) => (
              <Button
                key={t.key} variant={tab === t.key ? 'contained' : 'outlined'}
                sx={{ mr: 1, mb: 2 }} onClick={() => setTab(t.key)}
              >
                {t.label}
              </Button>
            ))}

            {tab === 'projects' && (
              <Grid container spacing={2}>
                {(data.projects ?? []).map((p) => (
                  <Grid item xs={12} md={6} key={String(p.id)}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="subtitle1">
                          {String(p.code)} — {String(p.name)}{' '}
                          <Chip size="small" label={String(p.status)} sx={{ ml: 1 }} />
                        </Typography>
                        <Typography variant="body2">{String(p.site_address ?? '')}</Typography>
                        <Typography variant="body2">
                          Prévu : {String(p.planned_start ?? '—').slice(0, 10)} → {String(p.planned_end ?? '—').slice(0, 10)}
                        </Typography>
                        {p.contract_value != null && (
                          <Typography variant="body2">Montant : {formatMoney(Number(p.contract_value), locale)}</Typography>
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
                {(data.projects ?? []).length === 0 && <Typography>{translate(locale, 'common.none')}</Typography>}
              </Grid>
            )}

            {tab === 'invoices' && (
              <TableContainer component={Paper}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>N°</TableCell><TableCell>Statut</TableCell><TableCell>Date</TableCell>
                      <TableCell>Échéance</TableCell><TableCell>Total</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(data.invoices ?? []).map((i) => (
                      <TableRow key={String(i.id)}>
                        <TableCell>{String(i.number)}</TableCell>
                        <TableCell>
                          <Chip
                            size="small" label={String(i.status)}
                            color={i.status === 'paid' ? 'success' : i.status === 'overdue' ? 'error' : 'default'}
                          />
                        </TableCell>
                        <TableCell>{String(i.issue_date).slice(0, 10)}</TableCell>
                        <TableCell>{String(i.due_date ?? '—').slice(0, 10)}</TableCell>
                        <TableCell>{formatMoney(Number(i.total), locale)}</TableCell>
                      </TableRow>
                    ))}
                    {(data.invoices ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={5}>{translate(locale, 'common.none')}</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {tab === 'documents' && (
              <TableContainer component={Paper}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Fichier</TableCell><TableCell>Date</TableCell><TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(data.documents ?? []).map((d) => (
                      <TableRow key={String(d.id)}>
                        <TableCell>{String(d.file_name)}</TableCell>
                        <TableCell>{String(d.created_at).slice(0, 10)}</TableCell>
                        <TableCell>
                          <Button size="small" onClick={() => window.open(`/api/v1/portal/documents/${String(d.id)}/download`, '_blank')}>
                            Télécharger
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(data.documents ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={3}>{translate(locale, 'common.none')}</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {tab === 'messages' && (
              <>
                <Button variant="contained" sx={{ mb: 2 }} onClick={() => { setClientId(String(clients[0]?.id ?? '')); setMsgOpen(true); }}>
                  Nouveau message
                </Button>
                {(data.communications ?? []).map((m) => (
                  <Card key={String(m.id)} variant="outlined" sx={{ mb: 1 }}>
                    <CardContent>
                      <Typography variant="subtitle2">{String(m.subject ?? '(sans objet)')}</Typography>
                      <Typography variant="body2">{String(m.body)}</Typography>
                      <Typography variant="caption" color="text.secondary">{String(m.occurred_at).slice(0, 16).replace('T', ' ')}</Typography>
                    </CardContent>
                  </Card>
                ))}
                {(data.communications ?? []).length === 0 && <Typography>{translate(locale, 'common.none')}</Typography>}
              </>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={msgOpen} onClose={() => setMsgOpen(false)}>
        <DialogTitle>Message au prestataire</DialogTitle>
        <DialogContent>
          {clients.length > 1 && (
            <TextField
              label="Société" select fullWidth margin="dense" value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              {clients.map((c) => <MenuItem key={String(c.id)} value={String(c.id)}>{String(c.name)}</MenuItem>)}
            </TextField>
          )}
          <TextField label="Objet" fullWidth margin="dense" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <TextField label="Message" fullWidth margin="dense" multiline minRows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMsgOpen(false)}>{translate(locale, 'common.cancel')}</Button>
          <Button onClick={sendMessage} variant="contained" disabled={busy || !body || !clientId}>{translate(locale, 'common.save')}</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
