import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="text-center py-5">
      <h1 className="h3">Page not found</h1>
      <p className="text-body-secondary">The page you are looking for does not exist.</p>
      <Link to="/lobbies">Back to your lobbies</Link>
    </div>
  );
}
