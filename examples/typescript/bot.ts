// Minimal Battleships program. It demonstrates the protocol only: the fleet layout is fixed and the
// "strategy" is to fire at the first cell not tried yet.
//
// Run with Node 22.18+ (type stripping is built in):
//   BSC_URL=wss://host/program/v1 BSC_TOKEN=bsc_... BSC_LOBBY=K7QM-4XD2-7 node bot.ts

const url = process.env.BSC_URL ?? 'ws://localhost:3000/program/v1';
const token = process.env.BSC_TOKEN;
const lobby = process.env.BSC_LOBBY;
const ruleset = process.env.BSC_RULESET ?? 'classic-10x10';
if (!token || !lobby) throw new Error('Set BSC_TOKEN and BSC_LOBBY');

let fleet: number[] = [];
const socket = new WebSocket(url);

const send = (message: object) => socket.send(JSON.stringify(message));

socket.addEventListener('open', () => {
  send({ type: 'hello', token, lobby, accepts: [ruleset], program: { name: 'example-ts', version: '1' } });
});

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  switch (message.type) {
    case 'welcome':
      fleet = message.ruleset.fleet;
      console.log('connected as seat', message.seat, message.resumed ? '(resumed)' : '');
      break;
    case 'place':
      // New game. Forget everything about the previous one here.
      send({
        type: 'placement',
        rid: message.rid,
        ships: fleet.map((len, i) => ({ len, x: 0, y: i * 2, dir: 'h' })),
      });
      break;
    case 'turn': {
      // `enemy` is a list of row strings: '.' means "not shot yet".
      const y = message.enemy.findIndex((row: string) => row.includes('.'));
      const x = message.enemy[y].indexOf('.');
      send({ type: 'fire', rid: message.rid, x, y });
      break;
    }
    case 'game_over':
      console.log(`game ${message.game.index}/${message.game.total}: ${message.winner} won (${message.reason})`);
      break;
    case 'reset':
      // The lobby was restarted. Drop the current game; the next `place` starts a new one.
      console.log('reset:', message.reason);
      break;
    case 'error':
      console.error('platform error:', message.code, message.message);
      break;
  }
});

socket.addEventListener('close', (event) => {
  console.log('closed', event.code, event.reason);
  process.exit(event.code === 1000 || event.code === 4000 ? 0 : 1);
});
