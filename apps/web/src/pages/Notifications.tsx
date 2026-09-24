import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, CardContent, Chip, List, ListItem, ListItemText, Typography } from '@mui/material';
import { fetchNotifications, markNotificationRead, evaluateNotifications, type Notification } from '../api';
import { translate, type Locale } from '@company-os/i18n';

export default function Notifications() {
  const locale: Locale = (localStorage.getItem('cos.locale') as Locale) ?? 'fr';
  const [rows, setRows] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await fetchNotifications();
      setRows(d.notifications);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function evaluate() {
    setBusy(true);
    setError(null);
    try {
      await evaluateNotifications();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  async function markRead(id: string) {
    try {
      await markNotificationRead(id);
      setRows((p) => p.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }

  const unread = rows.filter((n) => !n.read_at).length;

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {translate(locale, 'nav.notifications')} {unread > 0 && <Chip size="small" color="error" label={unread} sx={{ ml: 1 }} />}
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Button variant="contained" onClick={evaluate} disabled={busy} sx={{ mb: 2 }}>
          Évaluer les règles (factures en retard, stock, maintenance, retards)
        </Button>
        {rows.length === 0 ? (
          <Typography color="text.secondary">{translate(locale, 'common.none')}</Typography>
        ) : (
          <List>
            {rows.map((n) => (
              <ListItem
                key={n.id}
                secondaryAction={
                  !n.read_at && (
                    <Button size="small" onClick={() => void markRead(n.id)}>
                      {translate(locale, 'common.confirm')}
                    </Button>
                  )
                }
                sx={{ bgcolor: n.read_at ? 'transparent' : 'action.hover', borderRadius: 1, mb: 0.5 }}
              >
                <ListItemText
                  primary={
                    <>
                      <Chip size="small" label={n.severity} color={n.severity === 'critical' ? 'error' : n.severity === 'high' ? 'warning' : 'default'} sx={{ mr: 1 }} />
                      <strong>{n.title}</strong>
                    </>
                  }
                  secondary={`${n.body ?? ''} — ${String(n.created_at).slice(0, 16).replace('T', ' ')}`}
                />
              </ListItem>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );
}
