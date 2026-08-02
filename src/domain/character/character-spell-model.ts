import { z } from "zod";
import { STABLE_ID_PATTERN } from "../../shared/id";
import { JsonObjectSchema } from "../../shared/json";
import { ActivatableEffectSchema } from "./character-effect-model";

export const SpellcastingAbilitySchema = z.enum([
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
]);

export const SpellLevelSchema = z.number().int().min(0).max(9);

export const SpellDefinitionSchema = z.object({
  name: z.string().min(1),
  level: SpellLevelSchema,
  description: z.string(),
  higherLevels: z.string(),
  range: z.string(),
  components: z.string(),
  material: z.string(),
  ritual: z.boolean(),
  duration: z.string(),
  concentration: z.boolean(),
  castingTime: z.string(),
  school: z.string(),
  classes: z.string(),
  attackType: z.enum(["attack", "save", "none"]),
  saveAbility: z.string(),
  damageExpression: z.string(),
  upcastDamageExpression: z.string(),
  addAbilityModifier: z.boolean(),
  damageType: z.string(),
  year: z.string(),
  legacyData: JsonObjectSchema,
});

export const CharacterSpellV2Schema = z.object({
  id: z.string().regex(STABLE_ID_PATTERN),
  order: z.number().int().nonnegative(),
  name: z.string().min(1),
  level: SpellLevelSchema,
  prepared: z.boolean(),
  source: z.enum(["bundled", "custom", "legacy-unresolved"]),
  definition: SpellDefinitionSchema.nullable(),
  effect: ActivatableEffectSchema,
});

export const CharacterSpellDraftSchema = CharacterSpellV2Schema.omit({ id: true });

export const SpellSlotStateSchema = z.object({
  maximum: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
}).refine((slots) => slots.used <= slots.maximum, {
  message: "Used spell slots cannot exceed maximum slots",
  path: ["used"],
});

export function createDefaultSpellSlots(): Record<string, { maximum: number; used: number }> {
  return Object.fromEntries(
    Array.from({ length: 9 }, (_, index) => [String(index + 1), { maximum: 0, used: 0 }]),
  );
}

export const SpellSlotsSchema = z.record(
  z.string().regex(/^[1-9]$/),
  SpellSlotStateSchema,
).default(createDefaultSpellSlots());

export type SpellcastingAbility = z.infer<typeof SpellcastingAbilitySchema>;
export type SpellDefinition = z.infer<typeof SpellDefinitionSchema>;
export type CharacterSpellV2 = z.infer<typeof CharacterSpellV2Schema>;
export type CharacterSpellDraft = z.infer<typeof CharacterSpellDraftSchema>;
