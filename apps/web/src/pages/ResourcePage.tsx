import { useCallback, useEffect, useState } from 'react';
import {
  Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography, Paper,
} from '@mui/material';
import { list, createOne } from '../api';
import { translate, type Locale } from '@company-os/i18n';

interface Props {
  resource: string;
  titleKey: string;
  columns: string[];
  createFields?: string[];
  linkRow?: (row: Record<string, unknown>) => string | undefined;
}

type Row = Record<string, unknown>;

export default function ResourcePage({ resource, titleKey, columns, createFields, linkRow }: Props) {
  const locale: Locale = (localStorage.getItem('cos.locale') as Locale) ?? 'fr';
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [fieldOptions, setFieldOptions] = useState<Record<string, { value: string; label: string }[]>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await list<Row>(resource);
      const firstArray = Object.values(data).find((v) => Array.isArray(v)) as Row[] | undefined;
      setRows(firstArray ?? []);
      // Load clients for *_id selection fields
      if (createFields?.some((f) => f === 'client_id')) {
        const clients = await list<Row>('/clients');
        const c = Object.values(clients).find((v) => Array.isArray(v)) as Row[] | undefined;
        setFieldOptions((prev) => ({
          ...prev,
          client_id: (c ?? []).map((x) => ({ value: String(x.id), label: String(x.name) })),
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }, [resource, createFields]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    try {
      const payload: Record<string, unknown> = {};
      for (const f of createFields ?? []) {
        const v = form[f];
        if (v !== undefined && v !== '') {
          payload[f] = ['daily_cost', 'hourly_cost', 'lead_time_days', 'value', 'tax_rate'].includes(f) ? Number(v) : v;
        }
      }
      await createOne(resource, payload);
      setOpen(false);
      setForm({});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {translate(locale, titleKey)}
        </Typography>
        {error && <Typography color="error">{error}</Typography>}
        {createFields && createFields.length > 0 && (
          <Button variant="contained" onClick={() => setOpen(true)} sx={{ mb: 2 }}>
            {translate(locale, 'nav.new')}
          </Button>
        )}
        {rows.length === 0 ? (
          <Typography color="text.secondary">{translate(locale, 'common.none')}</Typography>
        ) : (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {columns.map((c) => (
                    <TableCell key={c}>{c}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow
                    key={String(r.id ?? i)}
                    hover
                    onClick={() => {
                      const href = linkRow?.(r);
                      if (href) location.assign(href);
                    }}
                    sx={{ cursor: linkRow ? 'pointer' : 'default' }}
                  >
                    {columns.map((c) => (
                      <TableCell key={c}>{r[c] == null ? '—' : String(r[c])}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>

      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>{translate(locale, 'common.create')}</DialogTitle>
        <DialogContent>
          {(createFields ?? []).map((f) => (
            <TextField
              key={f}
              label={f}
              value={form[f] ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, [f]: e.target.value }))}
              select={fieldOptions[f] !== undefined}
              fullWidth
              margin="dense"
              type={['value', 'tax_rate', 'daily_cost', 'hourly_cost'].includes(f) ? 'number' : 'text'}
            >
              {(fieldOptions[f] ?? []).map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{translate(locale, 'common.cancel')}</Button>
          <Button onClick={submit} variant="contained">
            {translate(locale, 'common.create')}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
