import { Card, CardContent, Grid, Typography, Chip, List, ListItem, ListItemText } from '@mui/material';
import type { DashboardData } from '../api';

export default function Dashboard({ data }: { data: DashboardData | null }) {
  if (!data) return <Typography>Chargement…</Typography>;

  const active = data.projectsByStatus.find((p) => p.status === 'in_progress')?.count ?? 0;

  return (
    <Grid container spacing={2}>
      <Grid item xs={12} sm={6} md={3}>
        <Card>
          <CardContent>
            <Typography color="text.secondary" gutterBottom>
              Chantiers actifs
            </Typography>
            <Typography variant="h4">{active}</Typography>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} sm={6} md={3}>
        <Card>
          <CardContent>
            <Typography color="text.secondary" gutterBottom>
              Factures impayées
            </Typography>
            <Typography variant="h4">{data.unpaidInvoices?.count ?? 0}</Typography>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} sm={6} md={3}>
        <Card>
          <CardContent>
            <Typography color="text.secondary" gutterBottom>
              Alertes stock
            </Typography>
            <Typography variant="h4">{data.stockAlerts.length}</Typography>
            <List dense>
              {data.stockAlerts.slice(0, 3).map((s) => (
                <ListItem key={s.name} disableGutters>
                  <ListItemText primary={s.name} secondary={`${s.physical} ${s.unit} / min ${s.min_stock}`} />
                </ListItem>
              ))}
            </List>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} sm={6} md={3}>
        <Card>
          <CardContent>
            <Typography color="text.secondary" gutterBottom>
              Incidents ouverts
            </Typography>
            {data.openIncidents.length === 0 ? (
              <Typography variant="h4">0</Typography>
            ) : (
              data.openIncidents.slice(0, 3).map((i) => (
                <Chip
                  key={i.id}
                  label={`${i.title} (${i.severity})`}
                  color={i.severity === 'critical' ? 'error' : i.severity === 'high' ? 'warning' : 'default'}
                  sx={{ mr: 0.5, mb: 0.5 }}
                />
              ))
            )}
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12}>
        <Card>
          <CardContent>
            <Typography color="text.secondary" gutterBottom>
              Chantiers en retard
            </Typography>
            {data.delayedProjects.length === 0 ? (
              <Typography>Aucun chantier en retard.</Typography>
            ) : (
              data.delayedProjects.map((p) => (
                <Typography key={p.id}>
                  • {p.code} — {p.name}
                </Typography>
              ))
            )}
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}
