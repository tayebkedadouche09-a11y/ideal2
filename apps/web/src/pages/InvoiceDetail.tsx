import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography, Paper,
} from '@mui/material';
import { fetchInvoice, addPayment, transition } from '../api';
import { translate, formatMoney, type Locale } from '@company-os/i18n';

export default function InvoiceDetail() {
  const locale: Locale = (localStorage.getItem('cos.locale') as Locale) ?? 'fr';
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchInvoice>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ amount: '', method: 'bank_transfer', reference: '' });

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setData(await fetchInvoice(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function submitPayment() {
    if (!id) return;
    try {
      await addPayment(id, { amount: Number(pay.amount), method: pay.method, reference: pay.reference || undefined });
      setPayOpen(false);
      setPay({ amount: '', method: 'bank_transfer', reference: '' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }

  if (!data) return <Typography>{error ?? translate(locale, 'common.loading')}</Typography>;
  const inv = data.invoice;
  const status = String(inv.status);

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {String(inv.number)} <Chip size="small" label={status} color={status === 'paid' ? 'success' : status === 'overdue' ? 'error' : 'default'} />
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <Typography>Total: {formatMoney(Number(inv.total), locale)}</Typography>
        <Typography>Payé: {formatMoney(data.paid, locale)}</Typography>
        <Typography>Reste: {formatMoney(data.due, locale)}</Typography>

        {['approved', 'issued', 'partially_paid', 'overdue'].includes(status) && (
          <Button variant="contained" sx={{ mt: 2 }} onClick={() => setPayOpen(true)}>Enregistrer un paiement</Button>
        )}
        {status === 'draft' && (
          <Button variant="outlined" sx={{ mt: 2 }} onClick={() => transition(`/invoices/${id}/transition`, 'approved').then(load)}>Approuver</Button>
        )}
        {status === 'approved' && (
          <Button variant="outlined" sx={{ mt: 2 }} onClick={() => transition(`/invoices/${id}/transition`, 'issued').then(load)}>Émettre</Button>
        )}

        <Typography variant="subtitle1" sx={{ mt: 3 }}>Lignes</Typography>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow><TableCell>Description</TableCell><TableCell>Qté</TableCell><TableCell>PU</TableCell><TableCell>Total</TableCell></TableRow>
            </TableHead>
            <TableBody>
              {data.lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell>{String(l.description)}</TableCell>
                  <TableCell>{String(l.quantity)}</TableCell>
                  <TableCell>{formatMoney(Number(l.unit_price), locale)}</TableCell>
                  <TableCell>{formatMoney(Number(l.line_total), locale)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <Typography variant="subtitle1" sx={{ mt: 3 }}>Paiements</Typography>
        {data.payments.length === 0 ? (
          <Typography color="text.secondary">{translate(locale, 'common.none')}</Typography>
        ) : (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow><TableCell>Date</TableCell><TableCell>Montant</TableCell><TableCell>Méthode</TableCell><TableCell>Réf.</TableCell><TableCell>Annulé</TableCell></TableRow>
              </TableHead>
              <TableBody>
                {data.payments.map((p) => (
                  <TableRow key={String(p.id)}>
                    <TableCell>{String(p.paid_at).slice(0, 10)}</TableCell>
                    <TableCell>{formatMoney(Number(p.amount), locale)}</TableCell>
                    <TableCell>{String(p.method)}</TableCell>
                    <TableCell>{String(p.reference ?? '—')}</TableCell>
                    <TableCell>{p.reversal_id ? 'OUI' : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>

      <Dialog open={payOpen} onClose={() => setPayOpen(false)}>
        <DialogTitle>Paiement</DialogTitle>
        <DialogContent>
          <TextField label="Montant (DZD)" type="number" fullWidth margin="dense" value={pay.amount} onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value }))} />
          <TextField
            label="Méthode" select fullWidth margin="dense" value={pay.method}
            onChange={(e) => setPay((p) => ({ ...p, method: e.target.value }))}
          >
            {['cash', 'bank_transfer', 'cheque', 'other'].map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
          </TextField>
          <TextField label="Référence" fullWidth margin="dense" value={pay.reference} onChange={(e) => setPay((p) => ({ ...p, reference: e.target.value }))} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPayOpen(false)}>{translate(locale, 'common.cancel')}</Button>
          <Button variant="contained" onClick={submitPayment}>{translate(locale, 'common.confirm')}</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
