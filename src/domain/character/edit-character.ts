import { z } from "zod";
import {
  CharacterV2Schema,
  IsoTimestampSchema,
  type CharacterV2,
} from "./character-v2";
import { CharacterChecksSchema } from "./character-checks";

const IdentityPatchSchema = z
  .object({
    className: z.string().optional(),
    level: z.number().int().nonnegative().optional(),
    experience: z.number().int().nonnegative().optional(),
    alignment: z.string().optional(),
  })
  .strict();

const AbilitiesPatchSchema = z
  .object({
    strength: z.number().int().optional(),
    dexterity: z.number().int().optional(),
    constitution: z.number().int().optional(),
    intelligence: z.number().int().optional(),
    wisdom: z.number().int().optional(),
    charisma: z.number().int().optional(),
  })
  .strict();

const HitPointsPatchSchema = z
  .object({
    current: z.number().int().optional(),
    maximum: z.number().int().nonnegative().optional(),
    temporary: z.number().int().nonnegative().optional(),
  })
  .strict();

const HitDicePatchSchema = z
  .object({
    current: z.string().optional(),
    formula: z.string().optional(),
    remaining: z.number().int().nonnegative().optional(),
    maximum: z.number().int().nonnegative().optional(),
    dieSize: z.union([
      z.literal(4),
      z.literal(6),
      z.literal(8),
      z.literal(10),
      z.literal(12),
      z.literal(20),
    ]).optional(),
  })
  .strict();

const CombatPatchSchema = z
  .object({
    armorClass: z.number().int().optional(),
    speed: z.string().optional(),
    initiative: z.string().optional(),
    hitPoints: HitPointsPatchSchema.optional(),
    hitDice: HitDicePatchSchema.optional(),
    inspiration: z.boolean().optional(),
    exhaustion: z.number().int().min(0).max(6).optional(),
  })
  .strict();

const CurrencyPatchSchema = z
  .object({
    copper: z.number().int().optional(),
    silver: z.number().int().optional(),
    electrum: z.number().int().optional(),
    gold: z.number().int().optional(),
    platinum: z.number().int().optional(),
  })
  .strict();

const ProficienciesPatchSchema = z
  .object({
    weapons: z.array(z.string()).optional(),
    armor: z.array(z.string()).optional(),
    languages: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
  })
  .strict();

export const CharacterCorePatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    identity: IdentityPatchSchema.optional(),
    abilities: AbilitiesPatchSchema.optional(),
    checks: CharacterChecksSchema.optional(),
    combat: CombatPatchSchema.optional(),
    proficiencies: ProficienciesPatchSchema.optional(),
    currency: CurrencyPatchSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "At least one character field must be provided",
  });

export type CharacterCorePatch = z.infer<typeof CharacterCorePatchSchema>;

export class CharacterRevisionConflictError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Character revision conflict: expected ${expectedRevision}, found ${actualRevision}`,
    );
    this.name = "CharacterRevisionConflictError";
  }
}

export interface EditCharacterOptions {
  expectedRevision: number;
  updatedAt: string;
}

export function editCharacterCore(
  input: CharacterV2,
  patchInput: CharacterCorePatch,
  options: EditCharacterOptions,
): CharacterV2 {
  const character = CharacterV2Schema.parse(input);
  const patch = CharacterCorePatchSchema.parse(patchInput);
  const updatedAt = IsoTimestampSchema.parse(options.updatedAt);

  if (character.revision !== options.expectedRevision) {
    throw new CharacterRevisionConflictError(
      options.expectedRevision,
      character.revision,
    );
  }

  const identity = CharacterV2Schema.shape.identity.parse({
    ...character.identity,
    ...patch.identity,
  });
  const patchedHitDice = {
    ...character.combat.hitDice,
    ...patch.combat?.hitDice,
  };
  const hitDice = {
    ...patchedHitDice,
    maximum: identity.level,
    remaining: Math.min(
      patchedHitDice.remaining ?? character.combat.hitDice.remaining,
      identity.level,
    ),
  };

  return CharacterV2Schema.parse({
    ...character,
    ...("name" in patch ? { name: patch.name } : {}),
    ...("color" in patch ? { color: patch.color } : {}),
    identity,
    abilities: { ...character.abilities, ...patch.abilities },
    checks: patch.checks ?? character.checks,
    combat: {
      ...character.combat,
      ...patch.combat,
      hitPoints: {
        ...character.combat.hitPoints,
        ...patch.combat?.hitPoints,
      },
      hitDice,
    },
    proficiencies: { ...character.proficiencies, ...patch.proficiencies },
    currency: { ...character.currency, ...patch.currency },
    revision: character.revision + 1,
    metadata: {
      ...character.metadata,
      updatedAt,
    },
  });
}
