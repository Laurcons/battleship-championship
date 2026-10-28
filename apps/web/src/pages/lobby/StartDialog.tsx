import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Button, Form, Modal } from 'react-bootstrap';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useApi } from '../../api/context';
import type { LobbySummary } from '../../api/types';
import { keys } from '../../hooks/queries';

export function StartDialog({
  show,
  lobby,
  busy,
  onStart,
  onCancel,
}: {
  show: boolean;
  lobby: LobbySummary;
  busy: boolean;
  onStart: (games: number) => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const platform = useQuery({ queryKey: keys.platform, queryFn: () => api.getPlatformInfo() });
  const max = platform.data?.maxBatterySize ?? 1000;
  const schema = z.object({
    games: z.coerce.number<number>().int('Use a whole number.').min(1, 'At least 1 game.').max(max, `At most ${max} games.`),
  });
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { games: lobby.series?.target ?? 1 } });
  return (
    <Modal show={show} onHide={onCancel} centered>
      <Form noValidate onSubmit={form.handleSubmit((v) => onStart(v.games))}>
        <Modal.Header closeButton>
          <Modal.Title>Start playing</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group controlId="games">
            <Form.Label>Number of games</Form.Label>
            <Form.Control type="number" min={1} max={max} isInvalid={!!form.formState.errors.games} {...form.register('games')} />
            <Form.Control.Feedback type="invalid">{form.formState.errors.games?.message}</Form.Control.Feedback>
            <Form.Text>
              The programs play this many games back to back at full speed. The starting player alternates every game; {lobby.seats[0].owner.name} starts game 1. Maximum: {max}.
            </Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="success" disabled={busy}>
            Start
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
