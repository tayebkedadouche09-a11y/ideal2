import { useCallback, useEffect, useState } from 'react';
import { Alert, Card, CardContent, Chip, Grid, Typography } from '@mui/material';
import { fetchBriefing, type Briefing } from '../api';
import { formatMoney, translate, type Locale } from '@company-os/i18n';

export default function Briefing() {
  const locale: Locale = (localStorage.getItem('cos.locale') as Locale) ?? 'fr';
  const [data, setData] = useState<Briefing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchBriefing());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>{translate(locale, 'dash.dailyBriefing')}</Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {!data && !error && <Typography color="text.secondary">{translate(locale, 'common.loading')}</Typography>}
        {data && (
          <Grid container spacing={2}>
            <Grid item xs={12} md={3}>
              <Card variant="outlined">
                <CardContent>
                  <Typography color="text.secondary">Chantiers actifs</Typography>
                  <Typography variant="h4">{data.projects.active}</Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    {data.projects.delayed.length} en retard · {data.projects.requiringAttention.length} à surveiller
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={3}>
              <Card variant="outlined">
                <CardContent>
                  <Typography color="text.secondary">Impayés en retard</Typography>
                  <Typography variant="h4">{formatMoney(Number(data.finance.overdueAmount), locale)}</Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>{data.finance.overdueInvoices} facture(s)</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Typography color="text.secondary">Alertes stock (autonomie)</Typography>
                  {data.stock.length === 0 ? (
                    <Typography>Aucune alerte.</Typography>
                  ) : (
                    data.stock.map((s) => (
                      <Typography key={s.name} variant="body2">
                        • {s.name} — {s.physical} {s.unit} (min {s.min_stock}, ~{Number(s.days_left).toFixed(0)} j)
                      </Typography>
                    ))
                  )}
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Typography color="text.secondary">Maintenance véhicule à venir</Typography>
                  {data.fleet.length === 0 ? (
                    <Typography>Aucune échéance.</Typography>
                  ) : (
                    data.fleet.map((f) => (
                      <Typography key={f.registration} variant="body2">
                        • {f.registration} — échéance {String(f.next_due_date).slice(0, 10)}
                      </Typography>
                    ))
                  )}
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12}>
              <Card variant="outlined">
                <CardContent>
                  <Typography color="text.secondary">Chantiers nécessitant une attention</Typography>
                  {data.projects.requiringAttention.length === 0 ? (
                    <Typography>Aucun.</Typography>
                  ) : (
                    data.projects.requiringAttention.map((p) => (
                      <Chip key={p.code} label={`${p.code} — ${p.name}`} sx={{ mr: 0.5, mb: 0.5 }} />
                    ))
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}
      </CardContent>
    </Card>
  );
}
