import { z } from "zod";
import { STABLE_ID_PATTERN } from "../../shared/id";
import { JsonObjectSchema, JsonValueSchema } from "../../shared/json";
import {
  CharacterChecksSchema,
  createDefaultCharacterChecks,
} from "./character-checks";
import { CharacterActionV2Schema } from "./character-action-model";
import { CharacterInventoryItemV2Schema } from "./character-inventory-model";
import {
  CharacterSpellV2Schema,
  SpellSlotsSchema,
} from "./character-spell-model";
import {
  CharacterExtraV2Schema,
  CharacterNoteGroupV2Schema,
  CharacterTraitGroupV2Schema,
} from "./character-content-model";
import { EncounterSchema } from "../encounter/encounter-model";
import { GmWorkspaceSchema } from "../gm/gm-workspace";

export const StableIdSchema = z.string().regex(STABLE_ID_PATTERN);
export const IsoTimestampSchema = z.string().datetime({ offset: true });

export const ConditionV2Schema = z.object({
  id: StableIdSchema,
  key: z.string().min(1),
  label: z.string().min(1),
  level: z.number().int().positive().nullable(),
  addedAt: IsoTimestampSchema,
});

export const LegacyEntityV2Schema = z.object({
  id: StableIdSchema,
  order: z.number().int().nonnegative(),
  group: z.string().nullable(),
  legacyId: z.string().nullable(),
  data: JsonObjectSchema,
});

export const LegacyGroupV2Schema = z.object({
  id: StableIdSchema,
  order: z.number().int().nonnegative(),
  title: z.string(),
  collapsed: z.boolean(),
  data: JsonObjectSchema,
  items: z.array(LegacyEntityV2Schema),
});

export const CharacterV2Schema = z.object({
  schemaVersion: z.literal(2),
  id: StableIdSchema,
  revision: z.number().int().nonnegative(),
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#d9bd73"),
  identity: z.object({
    className: z.string(),
    level: z.number().int().nonnegative(),
    experience: z.number().int().nonnegative(),
    alignment: z.string(),
  }),
  abilities: z.object({
    strength: z.number().int(),
    dexterity: z.number().int(),
    constitution: z.number().int(),
    intelligence: z.number().int(),
    wisdom: z.number().int(),
    charisma: z.number().int(),
  }),
  combat: z.object({
    armorClass: z.number().int(),
    speed: z.string(),
    initiative: z.string(),
    hitPoints: z.object({
      current: z.number().int(),
      maximum: z.number().int().nonnegative(),
      temporary: z.number().int().nonnegative(),
    }),
    hitDice: z.object({
      current: z.string(),
      formula: z.string(),
      remaining: z.number().int().nonnegative().default(0),
      maximum: z.number().int().nonnegative().default(0),
      dieSize: z.union([
        z.literal(4),
        z.literal(6),
        z.literal(8),
        z.literal(10),
        z.literal(12),
        z.literal(20),
      ]).default(8),
    }),
    deathSaves: z.object({
      successes: z.number().int().min(0).max(3),
      failures: z.number().int().min(0).max(3),
    }).default({ successes: 0, failures: 0 }),
    conditions: z.array(ConditionV2Schema).default([]),
    inspiration: z.boolean(),
    exhaustion: z.number().int().min(0).max(6),
  }),
  proficiencies: z.object({
    weapons: z.array(z.string()),
    armor: z.array(z.string()),
    languages: z.array(z.string()),
    tools: z.array(z.string()),
  }),
  checks: CharacterChecksSchema.default(createDefaultCharacterChecks()),
  actions: z.array(CharacterActionV2Schema).default([]),
  inventory: z.array(CharacterInventoryItemV2Schema).default([]),
  traits: z.array(CharacterTraitGroupV2Schema).default([]),
  notes: z.array(CharacterNoteGroupV2Schema).default([]),
  extras: z.array(CharacterExtraV2Schema).default([]),
  taleSpire: z.object({
    creatureId: z.string().min(1),
    displayName: z.string(),
    boardAssetId: z.string(),
  }).nullable().default(null),
  currency: z.object({
    copper: z.number().int(),
    silver: z.number().int(),
    electrum: z.number().int(),
    gold: z.number().int(),
    platinum: z.number().int(),
  }),
  spellcasting: z.object({
    ability: z.string().nullable(),
    selectedLevel: z.string().nullable(),
    levels: z.record(z.string(), JsonValueSchema),
    showUpcast: z.boolean().default(false),
    attackBonus: z.number().int().default(0),
    saveDcBonus: z.number().int().default(0),
    favoriteSpells: z.array(z.string().min(1)).default([]),
    spells: z.array(CharacterSpellV2Schema).default([]),
    slots: SpellSlotsSchema,
  }),
  collections: z.object({
    conditions: z.array(LegacyEntityV2Schema),
    actions: z.array(LegacyEntityV2Schema),
    spells: z.array(LegacyEntityV2Schema),
    inventory: z.array(LegacyEntityV2Schema),
    traits: z.array(LegacyGroupV2Schema),
    notes: z.array(LegacyGroupV2Schema),
    extras: z.array(LegacyEntityV2Schema),
  }),
  legacy: z.object({
    sourceKey: z.string(),
    unmapped: JsonObjectSchema,
  }),
  metadata: z.object({
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    migratedFrom: z.enum(["v1", "native"]),
  }),
});

export const CampaignV2Schema = z.object({
  schemaVersion: z.literal(2),
  id: StableIdSchema,
  revision: z.number().int().nonnegative(),
  characters: z.record(StableIdSchema, CharacterV2Schema),
  encounters: z.record(StableIdSchema, EncounterSchema).default({}),
  gm: GmWorkspaceSchema.default({ noteGroups: [], randomTables: [], googleDocsUrl: "" }),
  legacy: z.object({
    dmNotes: JsonValueSchema.nullable(),
    encounterData: JsonValueSchema.nullable(),
    unmapped: JsonObjectSchema,
  }),
  metadata: z.object({
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    migratedFrom: z.enum(["v1", "native"]),
  }),
});

export type LegacyEntityV2 = z.infer<typeof LegacyEntityV2Schema>;
export type LegacyGroupV2 = z.infer<typeof LegacyGroupV2Schema>;
export type ConditionV2 = z.infer<typeof ConditionV2Schema>;
export type CharacterV2 = z.infer<typeof CharacterV2Schema>;
export type CampaignV2 = z.infer<typeof CampaignV2Schema>;
