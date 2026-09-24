import { useState } from 'react';
import { Box, Button, Card, CardContent, TextField, Typography, Alert } from '@mui/material';
import { login, type AuthSession } from '../api';

interface Props {
  onLoggedIn: (s: AuthSession) => void;
}

export default function Login({ onLoggedIn }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLoggedIn(await login(email, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default' }}>
      <Card sx={{ minWidth: 340 }}>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            Company OS
          </Typography>
          <form onSubmit={submit}>
            <TextField
              label="Identifiant / المعرّف / Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              fullWidth
              margin="normal"
              autoComplete="username"
            />
            <TextField
              label="Mot de passe"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
              margin="normal"
              autoComplete="current-password"
            />
            {error && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {error}
              </Alert>
            )}
            <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={busy}>
              Se connecter
            </Button>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
