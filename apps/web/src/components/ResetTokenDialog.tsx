import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../api/context';
import type { ParticipantRef } from '../api/types';
import { keys } from '../hooks/queries';
import { ConfirmModal } from './ConfirmModal';

/** Confirms and performs an admin reset of a participant's token. Shared by the participants list and the activity pages. */
export function ResetTokenDialog({ participant, onClose, onError }: { participant: ParticipantRef | null; onClose: () => void; onError?: (error: unknown) => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const reset = useMutation({
    mutationFn: (id: string) => api.admin.resetParticipantToken(id),
    onSuccess: (_result, id) => {
      onClose();
      void qc.invalidateQueries({ queryKey: keys.admin.participants });
      void qc.invalidateQueries({ queryKey: keys.admin.monitor });
      void qc.invalidateQueries({ queryKey: keys.admin.connections });
      void qc.invalidateQueries({ queryKey: keys.admin.activity(id) });
      void qc.invalidateQueries({ queryKey: keys.participants });
    },
    onError: (error) => {
      onClose();
      onError?.(error);
    },
  });
  return (
    <ConfirmModal
      show={!!participant}
      title={`Reset the token of ${participant?.name}?`}
      confirmLabel="Reset token"
      variant="warning"
      busy={reset.isPending}
      onCancel={onClose}
      onConfirm={() => participant && reset.mutate(participant.id)}
    >
      Their current token stops working and their connected programs are disconnected. They will see a notice on the Account page and create a new token themselves; you never see it. Their activity counts as reviewed.
    </ConfirmModal>
  );
}
