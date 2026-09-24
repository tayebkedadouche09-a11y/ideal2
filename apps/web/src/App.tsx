import { useEffect, useMemo, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Box, Toolbar } from '@mui/material';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Briefing from './pages/Briefing';
import ResourcePage from './pages/ResourcePage';
import Quotes from './pages/Quotes';
import InvoiceDetail from './pages/InvoiceDetail';
import Project360 from './pages/Project360';
import StockPage from './pages/StockPage';
import Purchasing from './pages/Purchasing';
import Fleet from './pages/Fleet';
import Documents from './pages/Documents';
import Notifications from './pages/Notifications';
import Intelligence from './pages/Intelligence';
import Audit from './pages/Audit';
import Portal from './pages/Portal';
import FieldOps from './pages/FieldOps';
import CompanyMemory from './pages/CompanyMemory';
import ApprovalCenter from './pages/ApprovalCenter';
import Chat from './pages/Chat';
import Shell from './components/Shell';
import { getAuth, setAuth, type AuthSession, fetchDashboard, type DashboardData } from './api';
import { dir, type Locale } from '@company-os/i18n';

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(() => getAuth());
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

  useEffect(() => {
    if (!session) return;
    fetchDashboard().then(setDashboard).catch(() => setSession(null));
  }, [session]);

  const locale: Locale = (localStorage.getItem('cos.locale') as Locale) ?? 'fr';
  const direction = useMemo(() => dir(locale), [locale]);
  const role = session?.user.roles[0];

  if (!session) {
    return (
      <Login
        onLoggedIn={(s) => {
          setAuth(s);
          setSession(s);
        }}
      />
    );
  }

  const home = role === 'customer' ? '/portal' : '/';

  return (
    <Box dir={direction} sx={{ display: 'flex', minHeight: '100vh' }}>
      <Shell session={session} onLocale={(l) => { localStorage.setItem('cos.locale', l); location.reload(); }} />
      <Box component="main" sx={{ flexGrow: 1, p: 3, minWidth: 0 }}>
        <Toolbar />
        <Routes>
          <Route path="/" element={<Dashboard data={dashboard} />} />
          <Route path="/briefing" element={<Briefing />} />
          <Route path="/clients" element={<ResourcePage key="clients" resource="/clients" titleKey="nav.clients" columns={['name', 'city', 'phone', 'email']} createFields={['name', 'code', 'city', 'phone', 'email']} />} />
          <Route path="/suppliers" element={<ResourcePage key="suppliers" resource="/suppliers" titleKey="nav.suppliers" columns={['name', 'city', 'phone', 'email']} createFields={['name', 'city', 'phone', 'email']} />} />
          <Route path="/contracts" element={<ResourcePage key="contracts" resource="/contracts" titleKey="nav.contracts" columns={['number', 'title', 'value', 'status']} />} />
          <Route path="/quotes" element={<Quotes />} />
          <Route path="/projects" element={<ResourcePage key="projects" resource="/projects" titleKey="nav.projects" columns={['code', 'name', 'status', 'planned_end']} createFields={['name', 'client_id', 'code']} linkRow={(row) => `/projects/${row.id}`} />} />
          <Route path="/projects/:id" element={<Project360 />} />
          <Route path="/planning" element={<ResourcePage key="planning" resource="/projects" titleKey="nav.planning" columns={['code', 'name', 'planned_start', 'planned_end', 'status']} />} />
          <Route path="/stock" element={<StockPage />} />
          <Route path="/purchasing" element={<Purchasing />} />
          <Route path="/employees" element={<ResourcePage key="employees" resource="/employees" titleKey="nav.employees" columns={['first_name', 'last_name', 'role', 'phone']} createFields={['first_name', 'last_name', 'role', 'phone']} />} />
          <Route path="/teams" element={<ResourcePage key="teams" resource="/teams" titleKey="nav.teams" columns={['name', 'leader_name']} />} />
          <Route path="/vehicles" element={<Fleet />} />
          <Route path="/invoices" element={<ResourcePage key="invoices" resource="/invoices" titleKey="nav.finance" columns={['number', 'status', 'issue_date', 'total']} linkRow={(row) => `/invoices/${row.id}`} />} />
          <Route path="/invoices/:id" element={<InvoiceDetail />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/communications" element={<ResourcePage key="comms" resource="/communications" titleKey="nav.communications" columns={['kind', 'subject', 'occurred_at']} />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/intelligence" element={<Intelligence />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/portal" element={<Portal />} />
          <Route path="/field" element={<FieldOps />} />
          <Route path="/memory" element={<CompanyMemory />} />
          <Route path="/approvals" element={<ApprovalCenter />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </Box>
    </Box>
  );
}
