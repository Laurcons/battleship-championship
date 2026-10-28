import type { GameDetail, LobbySummary } from '../../api/types';
import { GameViewer } from '../../components/GameViewer';

export function LiveTab({ lobby, game }: { lobby: LobbySummary; game: GameDetail | null }) {
  if (!game) {
    const text =
      lobby.status === 'ready'
        ? 'Both programs are connected. Press Start to play.'
        : lobby.status === 'expired'
          ? 'This lobby expired.'
          : lobby.status === 'waiting'
            ? 'Waiting for the programs to connect. The Connection tab shows how to connect yours.'
            : 'The first game is about to start…';
    return (
      <div className="text-center text-body-secondary py-5" data-testid="live-empty">
        {text}
      </div>
    );
  }
  return <GameViewer game={game} lobby={lobby} />;
}
