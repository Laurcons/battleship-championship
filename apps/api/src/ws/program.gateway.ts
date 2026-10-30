import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { Inject, Injectable, Logger, type BeforeApplicationShutdown, type OnApplicationBootstrap } from '@nestjs/common';
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
import { ActivityService } from '../platform/activity.service.js';
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
  participantId: string | null = null;
  /** The activity-history row of this connection, once it has been accepted. */
  connectionId: string | null = null;
  /** Why the platform closed the connection, if it did. */
  platformClose: { code: number; reason: string } | null = null;

  constructor(
    readonly socket: WebSocket,
    readonly ip: string,
    /** Whether the connection reached the platform over TLS (wss://). */
    readonly secure: boolean,
  ) {}

  send(text: string): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(text);
  }

  close(code: number, reason: string): void {
    this.platformClose ??= { code, reason };
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
export class ProgramGateway implements OnApplicationBootstrap, BeforeApplicationShutdown {
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
    @Inject(ActivityService) private readonly activity: ActivityService,
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
      const secure = this.isSecure(req);
      wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, ip, secure));
    };
    this.server.on('upgrade', this.onUpgrade);
    this.accounts.onInsecureRevoked((participantId) => {
      for (const link of this.links) {
        if (link.participantId === participantId && !link.secure) link.close(CLOSE.CLOSED_BY_PLATFORM, 'Insecure connections are no longer allowed for this account.');
      }
    });
  }

  /** Runs before the HTTP server stops accepting: it would otherwise wait for these sockets forever. */
  beforeApplicationShutdown(): void {
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

  /**
   * Whether the program connected with TLS. The platform itself speaks plain HTTP behind a reverse
   * proxy, so this trusts the proxy's X-Forwarded-Proto (same hop counting as the client address).
   * Without a trusted proxy a connection can only be secure if this server terminates TLS itself.
   */
  private isSecure(req: IncomingMessage): boolean {
    if ((req.socket as { encrypted?: boolean }).encrypted) return true;
    const hops = this.config.trustProxyHops;
    if (hops <= 0) return false;
    const protos = String(req.headers['x-forwarded-proto'] ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const proto = protos[protos.length - hops] ?? protos[0];
    return proto === 'https' || proto === 'wss';
  }

  // --- connection lifecycle --------------------------------------------------------------------

  private accept(socket: WebSocket, ip: string, secure: boolean): void {
    const link = new WsLink(socket, ip, secure);
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
    socket.on('close', (code: number) => this.onClose(link, code));
    socket.on('error', () => undefined); // the close event follows
  }

  private stopTimers(link: WsLink): void {
    if (link.helloTimer) clearTimeout(link.helloTimer);
    if (link.pingTimer) clearInterval(link.pingTimer);
    link.helloTimer = null;
    link.pingTimer = null;
  }

  private onClose(link: WsLink, code: number): void {
    this.stopTimers(link);
    if (!this.links.delete(link)) return;
    if (link.connectionId) {
      const peerClosed = code === 1000 || code === 1001 || code === 1005;
      this.activity.ended(link.connectionId, link.platformClose?.reason ?? (peerClosed ? 'Closed by the program.' : 'Connection lost.'));
    }
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
      link.platformClose ??= { code: 1006, reason: 'No answer to ping: connection lost.' };
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
    if (!parsed.ok) {
      // A well-formed JSON object of a known type that fails its schema is, here, an invalid hello.
      const code = parsed.code === 'bad_shape' ? 'bad_hello' : parsed.code;
      return this.fatal(link, code, parsed.message, CLOSE.BAD_REQUEST);
    }
    if (parsed.frame.type !== 'hello') {
      return this.fatal(link, 'unexpected_message', 'The first frame must be "hello".', CLOSE.BAD_REQUEST);
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
    if (owned.length === 0) {
      // A valid token on a lobby that is not theirs: the program is told nothing more than for a wrong token, the admin is told.
      this.activity.denied(participant, { ip: link.ip, secure: link.secure, lobbyId: lobby.id });
      return deny();
    }
    if (this.lobbies.statusOf(lobby) === 'expired') return deny();

    if (!link.secure && !participant.allowInsecure) {
      return this.fatal(
        link,
        'tls_required',
        'This account may only connect over a secure WebSocket (wss://). Use wss://, or ask the admin to allow ws:// for your account. Your token was sent unencrypted.',
        CLOSE.TLS_REQUIRED,
      );
    }

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
    link.participantId = participant.id;
    const program = hello.program ? { name: hello.program.name, version: hello.program.version ?? '' } : null;
    const before = lobby.seats[seat - 1];
    link.connectionId = this.activity.connected(participant, {
      ip: link.ip,
      secure: link.secure,
      program,
      lobbyId: lobby.id,
      seat,
      previousSeenAt: before?.connection === 'connected' ? before.lastSeenAt : null,
    });
    rt.attach(seat, link, program, redactHello(text, hello.token));
  }
}

/** The stored copy of a hello never contains the token. */
function redactHello(text: string, token: string): string {
  return text.split(token).join(`bsc_••••••••${token.slice(-4)}`);
}
