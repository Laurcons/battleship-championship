import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BOT_KINDS } from '@bsc/bots';
import { Alert, Button, Card, Form } from 'react-bootstrap';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useApi } from '../api/context';
import type { OpponentChoice, RulesetInfo } from '../api/types';
import { ErrorAlert, Loading } from '../components/ErrorAlert';
import { getLastGodMode, rememberGodMode } from '../lib/lastChoice';
import { RulesetDetails } from '../components/RulesetDetails';
import { keys, useRulesets, useSession } from '../hooks/queries';

const schema = z.object({
  opponent: z.string().min(1, 'Choose an opponent.'),
  rulesetId: z.string().min(1, 'Choose a ruleset.'),
  godMode: z.boolean(),
  stopOnInfraction: z.boolean(),
});

function parseOpponent(value: string): OpponentChoice {
  const [kind, id] = value.split(':') as [string, string];
  return kind === 'bot' ? { kind: 'bot', bot: id as 'random' | 'hunt-target' } : { kind: 'participant', participantId: id };
}

function RulesetSummary({ info }: { info: RulesetInfo }) {
  return (
    <Card className="mt-2" data-testid="ruleset-summary">
      <Card.Body className="py-2">
        <div className="small mb-2">{info.ruleset.description}</div>
        <RulesetDetails ruleset={info.ruleset} testId="ruleset-summary-details" />
      </Card.Body>
    </Card>
  );
}

export function NewLobbyPage() {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const rulesets = useRulesets();
  const participants = useQuery({ queryKey: keys.participants, queryFn: () => api.listParticipants() });
  const platform = useQuery({ queryKey: keys.platform, queryFn: () => api.getPlatformInfo() });
  const enabled = rulesets.data?.filter((r) => r.enabled) ?? [];
  const defaultRuleset = enabled.find((r) => r.isDefault)?.ruleset.id ?? '';
  const form = useForm({
    resolver: zodResolver(schema),
    values: { opponent: '', rulesetId: defaultRuleset, godMode: session?.role === 'participant' ? getLastGodMode(session.participantId) : true, stopOnInfraction: false },
  });
  const selected = useWatch({ control: form.control });
  const create = useMutation({
    mutationFn: (input: { opponent: OpponentChoice; rulesetId: string; godMode: boolean; stopOnInfraction: boolean }) => api.createLobby(input),
    onSuccess: (lobby) => {
      void qc.invalidateQueries({ queryKey: keys.lobbies });
      navigate(`/lobbies/${lobby.id}`);
    },
  });

  if (session?.role === 'admin') {
    return <Alert variant="info">The admin cannot create lobbies. Log in as a participant to do that.</Alert>;
  }
  if (rulesets.isLoading || participants.isLoading || platform.isLoading) return <Loading />;

  const me = session?.role === 'participant' ? session.participantId : '';
  const chosenRuleset = enabled.find((r) => r.ruleset.id === selected.rulesetId);
  const forcedGod = selected.opponent === `participant:${me}` || !!selected.opponent?.startsWith('bot:');
  const allowed = platform.data?.allowGodMode ?? true;
  const locked = forcedGod || !allowed;
  const godMode = forcedGod ? true : !allowed ? false : (selected.godMode ?? true);

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 className="h3 mb-3">New lobby</h1>
      <ErrorAlert error={create.error} />
      <Form
        noValidate
        onSubmit={form.handleSubmit((values) => {
          if (!locked && me) rememberGodMode(me, godMode);
          create.mutate({ opponent: parseOpponent(values.opponent), rulesetId: values.rulesetId, godMode, stopOnInfraction: values.stopOnInfraction });
        })}
      >
        <Form.Group className="mb-3" controlId="opponent">
          <Form.Label>Opponent</Form.Label>
          <Form.Select isInvalid={!!form.formState.errors.opponent} {...form.register('opponent')}>
            <option value="">Choose an opponent…</option>
            <optgroup label="Participants">
              {participants.data?.map((p) => (
                <option key={p.id} value={`participant:${p.id}`}>
                  {p.id === me ? `${p.name} (yourself: two of your programs play each other)` : p.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Practice bots (run by the platform)">
              {BOT_KINDS.map((b) => (
                <option key={b.kind} value={`bot:${b.kind}`}>
                  {b.label}: {b.description}
                </option>
              ))}
            </optgroup>
          </Form.Select>
          <Form.Control.Feedback type="invalid">{form.formState.errors.opponent?.message}</Form.Control.Feedback>
        </Form.Group>

        <Form.Group className="mb-3" controlId="ruleset">
          <Form.Label>Ruleset</Form.Label>
          <Form.Select isInvalid={!!form.formState.errors.rulesetId} {...form.register('rulesetId')}>
            {enabled.map((r) => (
              <option key={r.ruleset.id} value={r.ruleset.id}>
                {r.ruleset.id}
                {r.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </Form.Select>
          <Form.Control.Feedback type="invalid">{form.formState.errors.rulesetId?.message}</Form.Control.Feedback>
          {chosenRuleset && <RulesetSummary info={chosenRuleset} />}
          <Form.Text>Your program must list this ruleset in <code>accepts</code>, or the lobby refuses it.</Form.Text>
        </Form.Group>

        <Form.Group className="mb-4" controlId="god-mode">
          <Form.Check
            type="switch"
            label="Show both fleets live (god mode)"
            checked={godMode}
            disabled={locked}
            onChange={(e) => form.setValue('godMode', e.target.checked)}
          />
          <Form.Text className="d-block" data-testid="view-note">
            {forcedGod
              ? 'Always on against yourself or a practice bot.'
              : !allowed
                ? 'The admin has turned god mode off.'
                : godMode
                  ? 'Both players see both fleets during a game.'
                  : 'Each player only sees what their own program knows during a game.'}{' '}
            Fixed once the lobby is created.
          </Form.Text>
        </Form.Group>

        <Form.Group className="mb-4" controlId="stop-on-infraction">
          <Form.Check
            type="switch"
            label="End a battery at the first infraction"
            checked={selected.stopOnInfraction ?? false}
            onChange={(e) => form.setValue('stopOnInfraction', e.target.checked)}
          />
          <Form.Text className="d-block">
            An invalid move, a malformed reply or a timeout. The game stays in the history. Fixed once the lobby is created.
          </Form.Text>
        </Form.Group>

        <div className="d-flex gap-2">
          <Button type="submit" disabled={create.isPending}>
            Create lobby
          </Button>
          <Link to="/lobbies" className="btn btn-outline-secondary">
            Cancel
          </Link>
        </div>
      </Form>
    </div>
  );
}
