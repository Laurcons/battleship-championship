import { useQuery } from '@tanstack/react-query';
import { Alert, Card } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useApi } from '../../api/context';
import type { LobbySummary } from '../../api/types';
import { CopyButton } from '../../components/CopyButton';
import { RulesetDetails } from '../../components/RulesetDetails';
import { keys, useRulesets } from '../../hooks/queries';
import { formatDuration } from '../../lib/format';
import { toWireRuleset } from '@bsc/protocol';

/** The ruleset this lobby is pinned to, how programs receive it, and the platform limits. */
export function RulesTab({ lobby }: { lobby: LobbySummary }) {
  const api = useApi();
  const rulesets = useRulesets();
  const platform = useQuery({ queryKey: keys.platform, queryFn: () => api.getPlatformInfo() });
  const info = rulesets.data?.find((r) => r.ruleset.id === lobby.rulesetId);
  // pretty-printed, but with the fleet on one line
  const wire = JSON.stringify(toWireRuleset(lobby.ruleset), null, 2).replace(/\[\s+([\d,\s]+?)\s+\]/g, (_m, inner: string) => `[${inner.replace(/\s+/g, ' ')}]`);
  const limits = platform.data?.limits;
  return (
    <div style={{ maxWidth: 820 }}>
      {info && !info.enabled && (
        <Alert variant="secondary" className="py-2" data-testid="ruleset-disabled">
          This ruleset has since been disabled: it can no longer be chosen for new lobbies. This lobby keeps it, and its rules never change.
        </Alert>
      )}
      <Card className="mb-4">
        <Card.Body>
          <Card.Title as="h2" className="h5 mono">
            {lobby.rulesetId}
          </Card.Title>
          <p className="small">{lobby.ruleset.description}</p>
          <RulesetDetails ruleset={lobby.ruleset} />
        </Card.Body>
      </Card>

      <Card className="mb-4" data-testid="lobby-visibility">
        <Card.Body>
          <Card.Title as="h2" className="h6">
            What you can see in this lobby
          </Card.Title>
          <p className="small mb-0">
            {lobby.godMode
              ? 'God mode: both participants see both fleets live.'
              : 'Restricted view: each participant sees only what their own program knows while a game is running, and everything once it has ended.'}{' '}
            {lobby.createdBy.name} chose this when creating the lobby, and it cannot change.
          </p>
        </Card.Body>
      </Card>

      {lobby.stopOnInfraction && (
        <Card className="mb-4" data-testid="lobby-stop-rule">
          <Card.Body>
            <Card.Title as="h2" className="h6">
              Stops on infraction
            </Card.Title>
            <p className="small mb-0">
              A battery here ends, as aborted with the results so far, at the first invalid move, malformed reply or timeout of either program. The game where it happened stays in the history, marked void.
            </p>
          </Card.Body>
        </Card>
      )}

      <Card className="mb-4">
        <Card.Body>
          <div className="d-flex align-items-center mb-2">
            <Card.Title as="h2" className="h6 m-0">
              What your program receives
            </Card.Title>
            <span className="ms-auto">
              <CopyButton text={wire} label="Copy" />
            </span>
          </div>
          <p className="small">
            The <code>ruleset</code> object of the <code>welcome</code> message, so a program does not have to hard-code these. It must list <code>"{lobby.rulesetId}"</code> in <code>accepts</code> to join. See the{' '}
            <Link to="/docs/protocol">protocol</Link> and the <Link to="/docs/rulesets">list of all rulesets</Link>.
          </p>
          <pre className="mono small bg-body border rounded p-2 mb-0" data-testid="wire-ruleset" tabIndex={0} aria-label="Ruleset as sent to programs">
            {wire}
          </pre>
        </Card.Body>
      </Card>

      {limits && (
        <Card>
          <Card.Body>
            <Card.Title as="h2" className="h6">
              Platform limits (the same for every ruleset)
            </Card.Title>
            <ul className="small mb-0" data-testid="limits">
              <li>Move timeout: {formatDuration(limits.moveMs)}. A program that does not answer in time loses the game.</li>
              <li>Placement timeout: {formatDuration(limits.placeMs)}.</li>
              <li>Invalid moves: {limits.maxStrikes} strikes lose the game.</li>
              <li>Resume window after a disconnect: {formatDuration(limits.graceMs)}.</li>
              <li>A lobby expires after {formatDuration(limits.idleExpiryMs)} without activity.</li>
            </ul>
          </Card.Body>
        </Card>
      )}
    </div>
  );
}
