import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, CardContent, Grid, MenuItem, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography, Paper,
} from '@mui/material';
import { fetchComparison, fetchAnomalies, fetchForecasts, runScenario, type Comparison } from '../api';
import { translate, type Locale } from '@company-os/i18n';

type Row = Record<string, unknown>;

export default function Intelligence() {
  const locale: Locale = (localStorage.getItem('cos.locale') as Locale) ?? 'fr';
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [anomalies, setAnomalies] = useState<Row[]>([]);
  const [forecasts, setForecasts] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scenarioType, setScenarioType] = useState('material_price_increase');
  const [percent, setPercent] = useState('10');
  const [result, setResult] = useState<Row | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, a, f] = await Promise.all([fetchComparison(), fetchAnomalies(), fetchForecasts()]);
      setComparison(c);
      setAnomalies(a.anomalies);
      setForecasts(f.forecasts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function simulate() {
    setBusy(true);
    setError(null);
    try {
      const changes = scenarioType === 'add_team'
        ? [{ type: 'add_team', value: 1 }]
        : scenarioType === 'remove_team'
          ? [{ type: 'remove_team', value: 1 }]
          : [{ type: scenarioType, value: Number(percent) / 100 }];
      const r = await runScenario({
        name: `${scenarioType} ${percent}%`,
        horizon_days: 30,
        changes,
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>{translate(locale, 'nav.ai')}</Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle1">Comparaison de chantiers (rentabilité réelle)</Typography>
                <TableContainer component={Paper} sx={{ mt: 1 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Chantier</TableCell><TableCell>Revenu (DA)</TableCell><TableCell>Coût (DA)</TableCell>
                        <TableCell>Marge (DA)</TableCell><TableCell>Incidents</TableCell><TableCell>Retard (j)</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(comparison?.projects ?? []).map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>{p.code} — {p.name}</TableCell>
                          <TableCell>{p.revenue.toLocaleString('fr-DZ')}</TableCell>
                          <TableCell>{p.cost.toLocaleString('fr-DZ')}</TableCell>
                          <TableCell>{p.margin.toLocaleString('fr-DZ')}</TableCell>
                          <TableCell>{p.incidents}</TableCell>
                          <TableCell>{p.delay_days ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                      {(comparison?.projects ?? []).length === 0 && (
                        <TableRow><TableCell colSpan={6}>{translate(locale, 'common.none')}</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle1">Anomalies détectées (variance &gt; 10%)</Typography>
                {anomalies.length === 0 ? (
                  <Typography>Aucune anomalie.</Typography>
                ) : (
                  anomalies.map((a, i) => (
                    <Typography key={i} variant="body2">• {JSON.stringify(a)}</Typography>
                  ))
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle1">Prévisions consommation (30 jours)</Typography>
                {forecasts.length === 0 ? (
                  <Typography>Aucune prévision disponible.</Typography>
                ) : (
                  forecasts.map((f, i) => (
                    <Typography key={i} variant="body2">
                      • {String(f.material ?? '')} — épuisement dans ~{String(f.daysToDepletion ?? '?')} j
                    </Typography>
                  ))
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle1">Simulation de scénario (persistée, traçable)</Typography>
                <TextField
                  select label="Changement" value={scenarioType} sx={{ mr: 2, minWidth: 220 }}
                  onChange={(e) => setScenarioType(e.target.value)}
                >
                  {['material_price_increase', 'labor_cost_increase', 'other_costs_increase', 'add_team', 'remove_team'].map((t) => (
                    <MenuItem key={t} value={t}>{t}</MenuItem>
                  ))}
                </TextField>
                {scenarioType.endsWith('increase') && (
                  <TextField label="%" type="number" value={percent} sx={{ width: 100 }} onChange={(e) => setPercent(e.target.value)} />
                )}
                <Button variant="contained" onClick={simulate} disabled={busy} sx={{ ml: 2 }}>
                  Simuler
                </Button>
                {result && (
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    Résultat : <code>{JSON.stringify(result)}</code>
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}
