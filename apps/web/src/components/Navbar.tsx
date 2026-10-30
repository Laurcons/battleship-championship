import { useQueryClient } from '@tanstack/react-query';
import { Container, Nav, Navbar, NavDropdown } from 'react-bootstrap';
import { NavLink, useNavigate } from 'react-router-dom';
import { useApi } from '../api/context';
import type { Session } from '../api/types';

/** The bar shown on public pages (the documentation) to someone who has not logged in. */
export function PublicNavbar() {
  const link = ({ isActive }: { isActive: boolean }) => `nav-link${isActive ? ' active' : ''}`;
  return (
    <Navbar expand="md" variant="dark" bg="primary" className="mb-4" aria-label="Main navigation">
      <Container>
        <Navbar.Brand as={NavLink} to="/login">
          <i className="bi bi-grid-3x3-gap-fill me-2" aria-hidden="true" />
          Battleships Championship
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="public-nav" />
        <Navbar.Collapse id="public-nav">
          <Nav className="me-auto">
            <NavLink to="/docs" className={link}>
              Docs
            </NavLink>
          </Nav>
          <Nav>
            <NavLink to="/login" className={link}>
              Participant login
            </NavLink>
            <NavLink to="/admin/login" className={link}>
              Admin login
            </NavLink>
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
}

export function AppNavbar({ session }: { session: Session }) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const logout = async () => {
    await api.logout();
    qc.clear();
    navigate(session.role === 'admin' ? '/admin/login' : '/login');
  };
  const link = ({ isActive }: { isActive: boolean }) => `nav-link${isActive ? ' active' : ''}`;
  return (
    <Navbar expand="md" variant="dark" bg="primary" className="mb-4" aria-label="Main navigation">
      <Container>
        <Navbar.Brand as={NavLink} to="/lobbies">
          <i className="bi bi-grid-3x3-gap-fill me-2" aria-hidden="true" />
          Battleships Championship
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="main-nav" />
        <Navbar.Collapse id="main-nav">
          <Nav className="me-auto">
            <NavLink to="/lobbies" className={link}>
              Lobbies
            </NavLink>
            {session.role === 'participant' && (
              <NavLink to="/account" className={link}>
                Account
              </NavLink>
            )}
            <NavLink to="/docs" className={link}>
              Docs
            </NavLink>
            {session.role === 'admin' && (
              <NavDropdown title="Admin" id="admin-menu">
                <NavDropdown.Item as={NavLink} to="/admin/participants">
                  Participants
                </NavDropdown.Item>
                <NavDropdown.Item as={NavLink} to="/admin/rulesets">
                  Rulesets
                </NavDropdown.Item>
                <NavDropdown.Item as={NavLink} to="/admin/settings">
                  Settings
                </NavDropdown.Item>
                <NavDropdown.Item as={NavLink} to="/admin/audit">
                  Audit log
                </NavDropdown.Item>
              </NavDropdown>
            )}
          </Nav>
          <Nav>
            <NavDropdown
              align="end"
              id="user-menu"
              title={
                <span data-testid="current-user">
                  <i className={`bi bi-${session.role === 'admin' ? 'shield-lock' : 'person-circle'} me-1`} aria-hidden="true" />
                  {session.role === 'admin' ? `Admin (${session.username})` : session.name}
                </span>
              }
            >
              <NavDropdown.Item onClick={() => void logout()}>Log out</NavDropdown.Item>
            </NavDropdown>
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
}
