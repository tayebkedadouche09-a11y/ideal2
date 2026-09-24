import { useEffect, useState } from 'react';
import {
  AppBar, Badge, Box, Divider, Drawer, IconButton, List, ListItemButton, ListItemText,
  Menu, MenuItem, Toolbar, Typography, Button,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import NotificationsIcon from '@mui/icons-material/Notifications';
import type { AuthSession, Notification } from '../api';
import { setAuth, fetchNotifications } from '../api';
import { translate, LOCALES, type Locale } from '@company-os/i18n';

const DRAWER_WIDTH = 250;

interface NavItem { key: string; label: string; visibleTo: string[]; path: string }
const NAV: NavItem[] = [
  { key: 'dashboard', label: 'nav.dashboard', visibleTo: ['owner', 'accountant', 'engineer', 'team_leader', 'storekeeper'], path: '/' },
  { key: 'briefing', label: 'dash.dailyBriefing', visibleTo: ['owner', 'accountant', 'engineer', 'team_leader', 'storekeeper'], path: '/briefing' },
  { key: 'clients', label: 'nav.clients', visibleTo: ['owner', 'accountant', 'engineer'], path: '/clients' },
  { key: 'suppliers', label: 'nav.suppliers', visibleTo: ['owner', 'accountant', 'storekeeper'], path: '/suppliers' },
  { key: 'contracts', label: 'nav.contracts', visibleTo: ['owner', 'accountant', 'engineer'], path: '/contracts' },
  { key: 'quotes', label: 'nav.quotes', visibleTo: ['owner', 'accountant', 'engineer'], path: '/quotes' },
  { key: 'projects', label: 'nav.projects', visibleTo: ['owner', 'accountant', 'engineer', 'team_leader', 'worker'], path: '/projects' },
  { key: 'planning', label: 'nav.planning', visibleTo: ['owner', 'engineer', 'team_leader'], path: '/planning' },
  { key: 'stock', label: 'nav.stock', visibleTo: ['owner', 'storekeeper', 'engineer'], path: '/stock' },
  { key: 'purchasing', label: 'nav.purchasing', visibleTo: ['owner', 'storekeeper'], path: '/purchasing' },
  { key: 'employees', label: 'nav.employees', visibleTo: ['owner', 'accountant', 'engineer'], path: '/employees' },
  { key: 'teams', label: 'nav.teams', visibleTo: ['owner', 'engineer', 'team_leader'], path: '/teams' },
  { key: 'vehicles', label: 'nav.vehicles', visibleTo: ['owner', 'driver'], path: '/vehicles' },
  { key: 'finance', label: 'nav.finance', visibleTo: ['owner', 'accountant'], path: '/invoices' },
  { key: 'documents', label: 'nav.documents', visibleTo: ['owner', 'accountant', 'engineer', 'storekeeper'], path: '/documents' },
  { key: 'communications', label: 'nav.communications', visibleTo: ['owner', 'engineer'], path: '/communications' },
  { key: 'reports', label: 'nav.reports', visibleTo: ['owner', 'accountant', 'engineer'], path: '/intelligence' },
  { key: 'field', label: 'Field Operations', visibleTo: ['owner', 'engineer', 'team_leader', 'worker'], path: '/field' },
  { key: 'memory', label: 'Company Memory', visibleTo: ['owner', 'accountant', 'engineer', 'team_leader'], path: '/memory' },
  { key: 'approvals', label: 'Approval Center', visibleTo: ['owner', 'accountant'], path: '/approvals' },
  { key: 'chat', label: 'Company Chat', visibleTo: ['owner', 'engineer', 'team_leader', 'worker'], path: '/chat' },
  { key: 'audit', label: 'nav.audit', visibleTo: ['owner', 'accountant'], path: '/audit' },
  { key: 'portal', label: 'nav.dashboard', visibleTo: ['customer'], path: '/portal' },
];

interface Props {
  session: AuthSession;
  onLocale: (l: Locale) => void;
}

export default function Shell({ session, onLocale }: Props) {
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [langAnchor, setLangAnchor] = useState<null | HTMLElement>(null);
  const locale: Locale = (localStorage.getItem('cos.locale') as Locale) ?? 'fr';
  const role = session.user.roles[0] ?? 'worker';

  useEffect(() => {
    if (role === 'customer') return;
    fetchNotifications().then((r) => setNotifs(r.notifications.filter((n) => !n.read_at))).catch(() => undefined);
  }, [role]);

  const nav = NAV.filter((n) => n.visibleTo.includes(role));

  return (
    <>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar>
          <IconButton color="inherit" edge="start" onClick={() => setOpen(!open)} sx={{ mr: 2 }}>
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap sx={{ flexGrow: 1 }}>
            {translate(locale, 'app.name')}
          </Typography>
          {role !== 'customer' && (
            <IconButton color="inherit" onClick={(e) => setAnchor(e.currentTarget)} size="large">
              <Badge badgeContent={notifs.length} color="error">
                <NotificationsIcon />
              </Badge>
            </IconButton>
          )}
          <Button color="inherit" onClick={(e) => setLangAnchor(e.currentTarget)}>
            {locale.toUpperCase()}
          </Button>
        </Toolbar>
      </AppBar>
      <Drawer
        variant="temporary"
        open={open}
        onClose={() => setOpen(false)}
        sx={{ width: DRAWER_WIDTH, flexShrink: 0, '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
      >
        <Toolbar />
        <Divider />
        <List>
          {nav.map((n) => (
            <ListItemButton
              key={n.key}
              onClick={() => {
                setOpen(false);
                location.assign(n.path);
              }}
            >
              <ListItemText primary={translate(locale, n.label)} />
            </ListItemButton>
          ))}
        </List>
        <Divider />
        <List>
          <ListItemButton
            onClick={() => {
              setAuth(null);
              location.reload();
            }}
          >
            <ListItemText primary={translate(locale, 'common.logout')} />
          </ListItemButton>
        </List>
      </Drawer>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            location.assign('/notifications');
          }}
        >
          {translate(locale, 'nav.notifications')} ({notifs.length})
        </MenuItem>
      </Menu>
      <Menu anchorEl={langAnchor} open={Boolean(langAnchor)} onClose={() => setLangAnchor(null)}>
        {LOCALES.map((l) => (
          <MenuItem
            key={l}
            onClick={() => {
              setLangAnchor(null);
              onLocale(l);
            }}
          >
            {l.toUpperCase()}
          </MenuItem>
        ))}
      </Menu>
      <Box />
    </>
  );
}
