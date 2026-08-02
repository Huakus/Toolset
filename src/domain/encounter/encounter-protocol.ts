import { z } from "zod";
import { STABLE_ID_PATTERN } from "../../shared/id";

export const GM_PROTOCOL = "talespire-5e-toolset-gm";
export const GM_PROTOCOL_VERSION = 1;

const StableIdSchema = z.string().regex(STABLE_ID_PATTERN);
const MessageIdSchema = z.string().regex(/^msg_[a-f0-9]{16}$/);
const TimestampSchema = z.string().datetime({ offset: true });

export const CharacterSummarySchema = z.object({
  characterId: StableIdSchema,
  name: z.string().min(1),
  currentHitPoints: z.number().int().nonnegative(),
  maximumHitPoints: z.number().int().nonnegative(),
  temporaryHitPoints: z.number().int().nonnegative(),
  armorClass: z.number().int().nonnegative(),
  passivePerception: z.number().int(),
  spellSaveDc: z.number().int(),
  conditionKeys: z.array(z.string().min(1)),
});

const PayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("gm/request-character-summary"), requestId: MessageIdSchema }),
  z.object({ type: z.literal("player/character-summary"), requestId: MessageIdSchema.nullable(), summary: CharacterSummarySchema }),
  z.object({ type: z.literal("player/set-initiative"), combatantId: StableIdSchema, initiative: z.number().int(), expectedRevision: z.number().int().nonnegative() }),
  z.object({ type: z.literal("player/request-encounter"), knownRevision: z.number().int().nonnegative().nullable() }),
  z.object({
    type: z.literal("gm/encounter-changed"),
    encounterId: StableIdSchema,
    revision: z.number().int().nonnegative(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({
    type: z.literal("gm/turn-changed"),
    encounterId: StableIdSchema,
    revision: z.number().int().nonnegative(),
    round: z.number().int().positive(),
    activeCombatantId: StableIdSchema.nullable(),
  }),
]);

export const GmProtocolMessageSchema = z.object({
  protocol: z.literal(GM_PROTOCOL),
  version: z.literal(GM_PROTOCOL_VERSION),
  messageId: MessageIdSchema,
  sentAt: TimestampSchema,
  payload: PayloadSchema,
});

export type GmProtocolPayload = z.infer<typeof PayloadSchema>;
export type GmProtocolMessage = z.infer<typeof GmProtocolMessageSchema>;
export type CharacterSummary = z.infer<typeof CharacterSummarySchema>;

export function createGmProtocolMessage(payload: GmProtocolPayload, sentAt = new Date().toISOString()): GmProtocolMessage {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return GmProtocolMessageSchema.parse({
    protocol: GM_PROTOCOL,
    version: GM_PROTOCOL_VERSION,
    messageId: `msg_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`,
    sentAt,
    payload,
  });
}

export function parseGmProtocolMessage(raw: string): GmProtocolMessage | null {
  try {
    const parsed = GmProtocolMessageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
