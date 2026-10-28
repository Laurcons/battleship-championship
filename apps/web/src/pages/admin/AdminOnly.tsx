import { Alert } from 'react-bootstrap';
import { Link } from 'react-router-dom';

export function AdminOnly() {
  return (
    <Alert variant="warning" data-testid="admin-only">
      This page is for the admin. <Link to="/admin/login">Admin login</Link>
    </Alert>
  );
}
