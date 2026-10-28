import { Body, Controller, Get, HttpCode, Inject, Post, Res } from '@nestjs/common';
import { adminLoginSchema, gateInputSchema, participantLoginSchema, type ParticipantRef, type Session } from '@bsc/api-contract';
import type { Response } from 'express';
import { CONFIG, type Config } from '../config.js';
import { AuthService } from '../platform/auth.service.js';
import type { Viewer } from '../platform/policy.js';
import { Access, ClientIp, COOKIE_NAME, SessionCookie, ZodPipe } from './context.js';

@Controller('api')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  private setCookie(res: Response, value: string, maxAgeMs: number): void {
    res.cookie(COOKIE_NAME, value, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.cookieSecure,
      path: '/',
      maxAge: maxAgeMs,
    });
  }

  @Get('health')
  @Access('public')
  async health(): Promise<{ ok: true }> {
    await this.auth.purgeExpired(); // touches the store, so a dead database shows up here
    return { ok: true };
  }

  @Get('session')
  @Access('public')
  async session(@SessionCookie() cookie: string | undefined): Promise<Session | null> {
    const viewer: Viewer | null = await this.auth.viewerFor(cookie);
    return viewer ? this.auth.sessionOf(viewer) : null;
  }

  @Post('auth/gate')
  @HttpCode(200)
  @Access('public')
  async gate(
    @ClientIp() ip: string,
    @Body(new ZodPipe(gateInputSchema)) body: { password: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<ParticipantRef[]> {
    const issued = await this.auth.verifySharedPassword(ip, body.password);
    if (issued.cookie) this.setCookie(res, issued.cookie, 15 * 60_000);
    return issued.value;
  }

  @Post('auth/participant')
  @HttpCode(200)
  @Access('public')
  async participant(
    @SessionCookie() cookie: string | undefined,
    @Body(new ZodPipe(participantLoginSchema)) body: { participantId: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<Session> {
    const issued = await this.auth.loginParticipant(cookie, body.participantId);
    if (issued.cookie) this.setCookie(res, issued.cookie, this.config.sessionTtlMs);
    return issued.value;
  }

  @Post('auth/admin')
  @HttpCode(200)
  @Access('public')
  async admin(
    @ClientIp() ip: string,
    @Body(new ZodPipe(adminLoginSchema)) body: { username: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<Session> {
    const issued = await this.auth.loginAdmin(ip, body.username, body.password);
    if (issued.cookie) this.setCookie(res, issued.cookie, this.config.sessionTtlMs);
    return issued.value;
  }

  @Post('auth/logout')
  @HttpCode(204)
  @Access('public')
  async logout(@SessionCookie() cookie: string | undefined, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(cookie);
    res.clearCookie(COOKIE_NAME, { path: '/' });
  }
}
