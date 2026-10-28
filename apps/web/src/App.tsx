import { Container } from 'react-bootstrap';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Loading } from './components/ErrorAlert';
import { AppNavbar } from './components/Navbar';
import { useSession } from './hooks/queries';
import { MockPanel } from './components/MockPanel';
import { AdminLoginPage, LoginPage } from './pages/LoginPage';
import { LobbiesPage } from './pages/LobbiesPage';
import { NewLobbyPage } from './pages/NewLobbyPage';
import { LobbyPage } from './pages/lobby/LobbyPage';
import { AccountPage } from './pages/AccountPage';
import { DocsPage } from './pages/DocsPage';
import { AdminParticipantsPage } from './pages/admin/ParticipantsPage';
import { AdminRulesetsPage } from './pages/admin/RulesetsPage';
import { AdminSettingsPage } from './pages/admin/SettingsPage';
import { AdminAuditPage } from './pages/admin/AuditPage';
import { NotFoundPage } from './pages/NotFoundPage';

function Shell() {
  const { data: session, isLoading } = useSession();
  const location = useLocation();
  if (isLoading) return <Loading />;
  if (!session) {
    const admin = location.pathname.startsWith('/admin');
    return <Navigate to={admin ? '/admin/login' : '/login'} replace state={{ from: location.pathname }} />;
  }
  return (
    <>
      <AppNavbar session={session} />
      <Container className="pb-5">
        <Outlet />
      </Container>
    </>
  );
}

export function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/lobbies" replace />} />
          <Route path="/lobbies" element={<LobbiesPage />} />
          <Route path="/lobbies/new" element={<NewLobbyPage />} />
          <Route path="/lobbies/:lobbyId" element={<LobbyPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/token" element={<Navigate to="/account" replace />} />
          <Route path="/docs/*" element={<DocsPage />} />
          <Route path="/admin" element={<Navigate to="/admin/participants" replace />} />
          <Route path="/admin/participants" element={<AdminParticipantsPage />} />
          <Route path="/admin/rulesets" element={<AdminRulesetsPage />} />
          <Route path="/admin/settings" element={<AdminSettingsPage />} />
          <Route path="/admin/audit" element={<AdminAuditPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      <MockPanel />
    </>
  );
}
