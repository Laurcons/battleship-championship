import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Seat } from '@bsc/engine';
import {
  ABUSE_MAX_FRAMES,
  ABUSE_WINDOW_MS,
  CLOSE,
  MAX_INBOUND_FRAME_BYTES,
  PROGRAM_PATH,
  normalizeLobbyCode,
  parseInbound,
  type Hello,
} from '@bsc/protocol';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { CONFIG, type Config } from '../config.js';
import { AccountsService } from '../platform/accounts.service.js';
import { LobbiesService } from '../platform/lobbies.service.js';
import type { Lobby } from '../platform/lobby.js';
import { RuntimeService } from '../platform/runtime/runtime.service.js';
import type { SeatLink } from '../platform/runtime/seat-link.js';
import { CLOCK, type Clock } from '../platform/util.js';

/** One program connection: a WebSocket that may or may not have said hello yet. */
class WsLink implements SeatLink {
  readonly kind = 'ws' as const;
  seat: Seat | null = null;
  lobby: Lobby | null = null;
  helloTimer: ReturnType<typeof setTimeout> | null = null;
  pingTimer: ReturnType<typeof setInterval> | null = null;
  lastPong = 0;
  lastPingAt = 0;
  abuse: number[] = [];

  constructor(
    readonly socket: WebSocket,
    readonly ip: string,
  ) {}

  send(text: string): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(text);
  }

  close(code: number, reason: string): void {
    // Close reasons are limited to 123 bytes.
    if (this.socket.readyState === this.socket.OPEN || this.socket.readyState === this.socket.CONNECTING) this.socket.close(code, reason.slice(0, 120));
  }
}

const errorFrame = (code: string, message: string, fatal: boolean) => JSON.stringify({ type: 'error', code, message, fatal });

/**
 * The raw WebSocket endpoint programs connect to (docs/protocol-v1.md). It owns the transport:
 * framing limits, heartbeat, the hello handshake and seat allocation. Game logic is in the lobby runtime.
 */
@Injectable()
export class ProgramGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('ws');
  private wss: WebSocketServer | null = null;
  private links = new Set<WsLink>();
  private perIp = new Map<string, number>();
  private onUpgrade: ((req: IncomingMessage, socket: Duplex, head: Buffer) => void) | null = null;
  private server: import('node:http').Server | null = null;

  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(LobbiesService) private readonly lobbies: LobbiesService,
    @Inject(RuntimeService) private readonly runtime: RuntimeService,
  ) {}

  onApplicationBootstrap(): void {
    // Max payload is above our own limit so an oversized frame can be answered with an error before closing.
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_INBOUND_FRAME_BYTES * 4, perMessageDeflate: false });
    this.wss = wss;
    this.server = this.adapterHost.httpAdapter.getHttpServer() as import('node:http').Server;
    this.onUpgrade = (req, socket, head) => {
      const path = (req.url ?? '').split('?')[0];
      if (path !== PROGRAM_PATH) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      const ip = this.clientIp(req);
      if (this.links.size >= this.config.limits.maxProgramConnections || (this.perIp.get(ip) ?? 0) >= 20) {
        socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, ip));
    };
    this.server.on('upgrade', this.onUpgrade);
  }

  onApplicationShutdown(): void {
    if (this.server && this.onUpgrade) this.server.off('upgrade', this.onUpgrade);
    for (const link of this.links) {
      this.stopTimers(link);
      link.socket.terminate();
    }
    this.links.clear();
    this.wss?.close();
  }

  count(): number {
    return this.links.size;
  }

  private clientIp(req: IncomingMessage): string {
    const hops = this.config.trustProxyHops;
    if (hops > 0) {
      const forwarded = String(req.headers['x-forwarded-for'] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const ip = forwarded[forwarded.length - hops];
      if (ip) return ip;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  // --- connection lifecycle --------------------------------------------------------------------

  private accept(socket: WebSocket, ip: string): void {
    const link = new WsLink(socket, ip);
    this.links.add(link);
    this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);
    link.lastPong = this.clock.now();
    link.helloTimer = setTimeout(() => this.fatal(link, 'hello_timeout', 'No hello within the time limit.', CLOSE.HELLO_TIMEOUT), this.config.limits.helloTimeoutMs);
    link.pingTimer = setInterval(() => this.ping(link), this.config.limits.pingIntervalMs);

    socket.on('pong', () => {
      const now = this.clock.now();
      link.lastPong = now;
      if (link.lobby && link.seat) {
        const state = link.lobby.seats[link.seat - 1];
        if (state) {
          state.latencyMs = Math.max(0, now - link.lastPingAt);
          state.lastSeenAt = now;
        }
      }
    });
    socket.on('message', (data, isBinary) => this.onMessage(link, data, isBinary));
    socket.on('close', () => this.onClose(link));
    socket.on('error', () => undefined); // the close event follows
  }

  private stopTimers(link: WsLink): void {
    if (link.helloTimer) clearTimeout(link.helloTimer);
    if (link.pingTimer) clearInterval(link.pingTimer);
    link.helloTimer = null;
    link.pingTimer = null;
  }

  private onClose(link: WsLink): void {
    this.stopTimers(link);
    if (!this.links.delete(link)) return;
    const count = (this.perIp.get(link.ip) ?? 1) - 1;
    if (count <= 0) this.perIp.delete(link.ip);
    else this.perIp.set(link.ip, count);
    if (link.lobby && link.seat) {
      this.runtime.runtimeFor(link.lobby).detach(link.seat, link, 'Connection closed by the program.');
    }
  }

  private ping(link: WsLink): void {
    const now = this.clock.now();
    if (now - link.lastPong > this.config.limits.pongTimeoutMs) {
      // Dead peer: drop it now, so the seat's resume window starts.
      link.socket.terminate();
      return;
    }
    link.lastPingAt = now;
    if (link.socket.readyState === link.socket.OPEN) link.socket.ping();
  }

  private fatal(link: WsLink, code: string, message: string, closeCode: number): void {
    link.send(errorFrame(code, message, true));
    link.close(closeCode, message);
  }

  /** Counts a bad frame; too many in a short time ends the connection. */
  private abuse(link: WsLink): boolean {
    const now = this.clock.now();
    link.abuse = link.abuse.filter((t) => now - t < ABUSE_WINDOW_MS);
    link.abuse.push(now);
    if (link.abuse.length > ABUSE_MAX_FRAMES) {
      this.fatal(link, 'rate_limited', 'Too many invalid frames.', CLOSE.RATE_LIMITED);
      return true;
    }
    return false;
  }

  // --- messages --------------------------------------------------------------------------------

  private onMessage(link: WsLink, data: RawData, isBinary: boolean): void {
    if (isBinary) return this.fatal(link, 'bad_json', 'Binary frames are not supported.', CLOSE.BAD_REQUEST);
    const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
    if (buffer.length > MAX_INBOUND_FRAME_BYTES) {
      return this.fatal(link, 'frame_too_large', `Frames are limited to ${MAX_INBOUND_FRAME_BYTES} bytes.`, CLOSE.BAD_REQUEST);
    }
    const text = buffer.toString('utf8');
    if (link.seat && link.lobby) {
      const result = this.runtime.runtimeFor(link.lobby).receive(link.seat, link, text);
      if (result.counted) this.abuse(link);
      return;
    }
    this.onFirstFrame(link, text);
  }

  private onFirstFrame(link: WsLink, text: string): void {
    const parsed = parseInbound(text);
    if (!parsed.ok || parsed.frame.type !== 'hello') {
      const message = parsed.ok ? 'The first frame must be "hello".' : parsed.message;
      return this.fatal(link, parsed.ok ? 'unexpected_message' : parsed.code, message, CLOSE.BAD_REQUEST);
    }
    this.hello(link, parsed.frame, text);
  }

  /** Authenticates, joins the lobby, checks the ruleset and seats the program. */
  private hello(link: WsLink, hello: Hello, text: string): void {
    // Wrong token, unknown lobby and "not your lobby" are deliberately indistinguishable.
    const deny = () => this.fatal(link, 'auth_failed', 'Authentication failed.', CLOSE.AUTH_FAILED);
    const participant = this.accounts.findByToken(hello.token);
    const code = normalizeLobbyCode(hello.lobby);
    const lobby = code ? this.lobbies.find(code) : undefined;
    if (!participant || !lobby) return deny();
    const owned = ([1, 2] as const).filter((s) => {
      const owner = lobby.row.seats[s - 1];
      return owner?.kind === 'participant' && owner.participantId === participant.id;
    });
    if (owned.length === 0 || this.lobbies.statusOf(lobby) === 'expired') return deny();

    if (!hello.accepts.includes(lobby.row.rulesetId)) {
      return this.fatal(link, 'ruleset_mismatch', `This lobby plays the ruleset "${lobby.row.rulesetId}", which is not in your "accepts" list.`, CLOSE.RULESET_MISMATCH);
    }

    const rt = this.runtime.runtimeFor(lobby);
    // Seat choice: a valid session_id reclaims its seat; otherwise the first of the participant's seats without a program.
    let seat: Seat | undefined;
    if (hello.session_id) seat = owned.find((s) => rt.sessionOf(s) === hello.session_id);
    seat ??= owned.find((s) => lobby.seats[s - 1]?.connection !== 'connected');
    // A participant with a single seat that still looks connected is reconnecting (the old socket is
    // half-open): the new connection replaces the old one instead of being refused.
    if (seat === undefined && owned.length === 1) seat = owned[0];
    if (seat === undefined) return this.fatal(link, 'lobby_full', 'The lobby has no empty seat for you.', CLOSE.LOBBY_FULL);

    if (link.helloTimer) clearTimeout(link.helloTimer);
    link.helloTimer = null;
    link.seat = seat;
    link.lobby = lobby;
    const program = hello.program ? { name: hello.program.name, version: hello.program.version ?? '' } : null;
    rt.attach(seat, link, program, redactHello(text, hello.token));
  }
}

/** The stored copy of a hello never contains the token. */
function redactHello(text: string, token: string): string {
  return text.split(token).join(`bsc_••••••••${token.slice(-4)}`);
}
