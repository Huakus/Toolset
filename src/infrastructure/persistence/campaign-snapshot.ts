import { z } from "zod";
import {
  CampaignV2Schema,
  type CampaignV2,
} from "../../domain/character/character-v2";
import { checksumJson } from "../../shared/hash";
import { cloneJson } from "../../shared/json";
import { JsonObjectSchema } from "../../shared/json";
import { characterColorForId } from "../../domain/character/create-character";
import {
  CampaignRepositoryConflictError,
  CampaignRepositoryCorruptionError,
  type CampaignSnapshot,
  type SaveExpectation,
} from "../../application/ports/campaign-repository";

export const CampaignEnvelopeSchema = z.object({
  format: z.literal("talespire-toolset-campaign-v2"),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  campaign: JsonObjectSchema,
});

export type CampaignEnvelope = z.infer<typeof CampaignEnvelopeSchema>;

export async function createCampaignSnapshot(
  input: CampaignV2,
): Promise<CampaignSnapshot> {
  const campaign = CampaignV2Schema.parse(input);
  return {
    campaign: cloneJson(campaign),
    checksum: await checksumJson(campaign),
  };
}

export async function decodeCampaignEnvelope(
  raw: string,
): Promise<CampaignSnapshot> {
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    throw new CampaignRepositoryCorruptionError(
      "Stored campaign is not valid JSON",
      { cause: error },
    );
  }

  const parsed = CampaignEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    throw new CampaignRepositoryCorruptionError(
      `Stored campaign envelope is invalid: ${parsed.error.issues[0]?.message ?? "unknown error"}`,
    );
  }

  const storedChecksum = await checksumJson(parsed.data.campaign);
  if (storedChecksum !== parsed.data.checksum) {
    throw new CampaignRepositoryCorruptionError(
      `Stored campaign checksum mismatch: declared ${parsed.data.checksum}, calculated ${storedChecksum}`,
    );
  }

  const normalized = CampaignV2Schema.safeParse(parsed.data.campaign);
  if (!normalized.success) {
    throw new CampaignRepositoryCorruptionError(
      `Stored campaign is invalid: ${normalized.error.issues[0]?.message ?? "unknown error"}`,
    );
  }
  const rawCharacters = parsed.data.campaign.characters;
  const rawCharacterMap = rawCharacters !== null && rawCharacters !== undefined && !Array.isArray(rawCharacters) && typeof rawCharacters === "object"
    ? rawCharacters
    : {};
  const campaign = CampaignV2Schema.parse({
    ...normalized.data,
    characters: Object.fromEntries(Object.entries(normalized.data.characters).map(([id, character]) => {
      const rawCharacter = rawCharacterMap[id];
      const hadColor = rawCharacter !== null && rawCharacter !== undefined && !Array.isArray(rawCharacter) && typeof rawCharacter === "object" && typeof rawCharacter.color === "string";
      return [id, hadColor ? character : { ...character, color: characterColorForId(id) }];
    })),
  });
  const actualChecksum = await checksumJson(campaign);

  return {
    campaign: cloneJson(campaign),
    checksum: actualChecksum,
  };
}

export function encodeCampaignEnvelope(snapshot: CampaignSnapshot): string {
  const envelope: CampaignEnvelope = {
    format: "talespire-toolset-campaign-v2",
    checksum: snapshot.checksum,
    campaign: snapshot.campaign,
  };
  return JSON.stringify(envelope);
}

export function assertSaveExpectation(
  expectation: SaveExpectation,
  current: CampaignSnapshot | null,
): void {
  if (expectation.kind === "empty") {
    if (current !== null) {
      throw new CampaignRepositoryConflictError("empty", current.checksum);
    }
    return;
  }

  if (current?.checksum !== expectation.checksum) {
    throw new CampaignRepositoryConflictError(
      expectation.checksum,
      current?.checksum ?? null,
    );
  }
}
