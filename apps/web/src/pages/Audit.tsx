import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, CardContent, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Typography, Paper,
} from '@mui/material';
import { fetchAudit } from '../api';
import { translate, type Locale } from '@company-os/i18n';

type Row = Record<string, unknown>;

export default function Audit() {
  const locale: Locale = (localStorage.getItem('cos.locale') as Locale) ?? 'fr';
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [entityType, setEntityType] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = entityType ? `?entity_type=${encodeURIComponent(entityType)}` : '';
      const d = await fetchAudit(qs);
      setRows(d.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }, [entityType]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>{translate(locale, 'nav.audit')}</Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          label="Filtrer par type d'entité (ex: quote, invoice, project)" size="small" sx={{ mb: 2, minWidth: 320 }}
          value={entityType} onChange={(e) => setEntityType(e.target.value)}
        />
        {rows.length === 0 ? (
          <Typography color="text.secondary">{translate(locale, 'common.none')}</Typography>
        ) : (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell><TableCell>Utilisateur</TableCell><TableCell>Action</TableCell>
                  <TableCell>Entité</TableCell><TableCell>Détails</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={String(r.id)}>
                    <TableCell>{String(r.created_at).slice(0, 19).replace('T', ' ')}</TableCell>
                    <TableCell>{String(r.user_id ?? '—').slice(0, 8)}</TableCell>
                    <TableCell>{String(r.action)}</TableCell>
                    <TableCell>{String(r.entity_type)} {String(r.entity_id).slice(0, 8)}</TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                        {r.details ? JSON.stringify(r.details).slice(0, 120) : '—'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}
