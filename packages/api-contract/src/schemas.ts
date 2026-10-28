import { BOT_KINDS } from '@bsc/bots';
import { z } from 'zod';

/** Request bodies of the HTTP API. The server validates with these; the client builds them. */

const botKinds = BOT_KINDS.map((b) => b.kind) as [string, ...string[]];

export const gateInputSchema = z.object({ password: z.string().min(1).max(1024) });
export const participantLoginSchema = z.object({ participantId: z.string().min(1).max(64) });
export const adminLoginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(1024),
});

export const createLobbySchema = z.object({
  opponent: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('participant'), participantId: z.string().min(1).max(64) }),
    z.object({ kind: z.literal('bot'), bot: z.enum(botKinds) }),
  ]),
  rulesetId: z.string().min(1).max(40),
  godMode: z.boolean().optional(),
  stopOnInfraction: z.boolean().optional(),
});

export const startSeriesSchema = z.object({ games: z.number().int().min(1).max(1_000_000) });

export const participantNameSchema = z.object({ name: z.string().min(1).max(100) });

export const rulesetSchema = z.object({
  id: z.string().max(40),
  description: z.string().max(1000),
  width: z.number().int(),
  height: z.number().int(),
  fleet: z.array(z.number().int()).max(50),
  touching: z.boolean(),
  extraTurnOnHit: z.boolean(),
  announceSunk: z.boolean(),
  repeatShot: z.enum(['invalid', 'waste']),
  revealOnGameOver: z.boolean(),
});

export const setEnabledSchema = z.object({ enabled: z.boolean() });

export const updateSettingsSchema = z.object({
  allowGodMode: z.boolean().optional(),
  maxBatterySize: z.number().int().optional(),
});
