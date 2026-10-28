import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  createLobbySchema,
  startSeriesSchema,
  ApiError,
  type Frame,
  type GameDetail,
  type GameListItem,
  type LobbySummary,
  type OpponentChoice,
  type SeriesInfo,
  type SeriesReport,
} from '@bsc/api-contract';
import type { Seat } from '@bsc/engine';
import type { Request, Response } from 'express';
import { CONFIG, type Config } from '../config.js';
import { AuthService } from '../platform/auth.service.js';
import { LiveHub } from '../platform/live-hub.js';
import { RuntimeService } from '../platform/runtime/runtime.service.js';
import { LobbiesService } from '../platform/lobbies.service.js';
import type { Viewer } from '../platform/policy.js';
import { Access, CurrentViewer, ZodPipe, type AuthedRequest } from './context.js';

const MAX_SSE_PER_SESSION = 20;

@Controller('api/lobbies')
export class LobbiesController {
  private sseBySession = new Map<string, number>();

  constructor(
    @Inject(LobbiesService) private readonly lobbies: LobbiesService,
    @Inject(LiveHub) private readonly hub: LiveHub,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RuntimeService) private readonly runtime: RuntimeService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Get()
  @Access('any')
  list(@CurrentViewer() viewer: Viewer): LobbySummary[] {
    return this.lobbies.list(viewer);
  }

  @Post()
  @HttpCode(201)
  @Access('participant')
  create(
    @CurrentViewer() viewer: Viewer,
    @Body(new ZodPipe(createLobbySchema)) body: { opponent: OpponentChoice; rulesetId: string; godMode?: boolean },
  ): Promise<LobbySummary> {
    return this.lobbies.create(viewer, body);
  }

  @Get(':id')
  @Access('any')
  get(@CurrentViewer() viewer: Viewer, @Param('id') id: string): LobbySummary {
    return this.lobbies.summary(this.lobbies.getFor(viewer, id), viewer);
  }

  @Delete(':id')
  @HttpCode(204)
  @Access('any')
  async remove(@CurrentViewer() viewer: Viewer, @Param('id') id: string): Promise<void> {
    await this.lobbies.delete(viewer, id);
  }

  @Post(':id/start')
  @HttpCode(200)
  @Access('participant')
  start(@CurrentViewer() viewer: Viewer, @Param('id') id: string, @Body(new ZodPipe(startSeriesSchema)) body: { games: number }): Promise<LobbySummary> {
    return this.runtime.start(viewer, id, body.games);
  }

  @Post(':id/restart-game')
  @HttpCode(200)
  @Access('participant')
  restartGame(@CurrentViewer() viewer: Viewer, @Param('id') id: string): Promise<LobbySummary> {
    return this.runtime.restartGame(viewer, id);
  }

  @Post(':id/reset-series')
  @HttpCode(200)
  @Access('participant')
  resetSeries(@CurrentViewer() viewer: Viewer, @Param('id') id: string): Promise<LobbySummary> {
    return this.runtime.resetSeries(viewer, id);
  }

  @Get(':id/series')
  @Access('any')
  series(@CurrentViewer() viewer: Viewer, @Param('id') id: string): SeriesInfo[] {
    return this.lobbies.listSeries(viewer, id);
  }

  @Get(':id/games')
  @Access('any')
  games(@CurrentViewer() viewer: Viewer, @Param('id') id: string, @Query('seriesId') seriesId?: string): Promise<GameListItem[]> {
    return this.lobbies.listGames(viewer, id, typeof seriesId === 'string' ? seriesId : undefined);
  }

  @Get(':id/games/:gameId')
  @Access('any')
  game(@CurrentViewer() viewer: Viewer, @Param('id') id: string, @Param('gameId') gameId: string): Promise<GameDetail> {
    return this.lobbies.getGame(viewer, id, gameId);
  }

  @Get(':id/report')
  @Access('any')
  report(@CurrentViewer() viewer: Viewer, @Param('id') id: string, @Query('seriesId') seriesId?: string): Promise<SeriesReport | null> {
    return this.lobbies.getSeriesReport(viewer, id, typeof seriesId === 'string' ? seriesId : undefined);
  }

  @Get(':id/frames/:seat')
  @Access('any')
  frames(@CurrentViewer() viewer: Viewer, @Param('id') id: string, @Param('seat') seat: string): Frame[] {
    if (seat !== '1' && seat !== '2') throw new ApiError('not_found', 'No program on that seat.');
    return this.lobbies.getFrameLog(viewer, id, Number(seat) as Seat);
  }

  /** Server-sent events: the lobby and its live game, redacted for this viewer. */
  @Get(':id/live')
  @Access('any')
  async live(
    @CurrentViewer() viewer: Viewer,
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const lobby = this.lobbies.getFor(viewer, id);
    const cookie = (req as AuthedRequest).sessionCookie ?? '';
    const open = this.sseBySession.get(cookie) ?? 0;
    if (open >= MAX_SSE_PER_SESSION) throw new ApiError('rate_limited', 'Too many open live views.');
    this.sseBySession.set(cookie, open + 1);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('retry: 2000\n\n');

    const unsubscribe = this.hub.subscribe(lobby.id, viewer, (update) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(update)}\n\n`);
    });
    // Comments keep proxies from closing the stream; each beat also re-checks the session.
    const beat = setInterval(() => {
      void this.auth.viewerFor(cookie).then((still) => {
        if (!still) res.end();
        else if (!res.writableEnded) res.write(': keep-alive\n\n');
      });
    }, this.config.limits.pingIntervalMs);
    req.on('close', () => {
      clearInterval(beat);
      unsubscribe();
      const left = (this.sseBySession.get(cookie) ?? 1) - 1;
      if (left <= 0) this.sseBySession.delete(cookie);
      else this.sseBySession.set(cookie, left);
    });
  }
}
