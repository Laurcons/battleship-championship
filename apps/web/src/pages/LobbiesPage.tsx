import { Link } from 'react-router-dom';
import { LobbiesTable } from '../components/LobbiesTable';
import { ErrorAlert, Loading } from '../components/ErrorAlert';
import { useLobbies, useSession } from '../hooks/queries';

export function LobbiesPage() {
  const { data: session } = useSession();
  const { data: lobbies, error, isLoading } = useLobbies();
  const admin = session?.role === 'admin';
  return (
    <>
      <div className="page-title mb-3">
        <h1 className="h3 m-0">{admin ? 'All lobbies' : 'Your lobbies'}</h1>
        {!admin && (
          <Link to="/lobbies/new" className="btn btn-primary ms-auto">
            <i className="bi bi-plus-lg me-1" aria-hidden="true" />
            New lobby
          </Link>
        )}
      </div>
      <ErrorAlert error={error} />
      {isLoading && <Loading />}
      {lobbies && lobbies.length === 0 && (
        <div className="text-center text-body-secondary py-5" data-testid="empty-lobbies">
          <p className="mb-3">You are not part of any lobby yet.</p>
          {!admin && (
            <Link to="/lobbies/new" className="btn btn-primary">
              Create your first lobby
            </Link>
          )}
        </div>
      )}
      {lobbies && lobbies.length > 0 && <LobbiesTable lobbies={lobbies} showCreator={admin} />}
    </>
  );
}
