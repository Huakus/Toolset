import { z } from "zod";
import { STABLE_ID_PATTERN } from "../../shared/id";
import { RollModeSchema } from "./character-checks";

export const ActionCategorySchema = z.enum([
  "attack",
  "action",
  "bonus-action",
  "reaction",
  "other",
]);

export const ActionAbilitySchema = z.enum([
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
]);

export const CharacterActionV2Schema = z.object({
  id: z.string().regex(STABLE_ID_PATTERN),
  order: z.number().int().nonnegative(),
  name: z.string().min(1),
  categories: z.array(ActionCategorySchema).min(1),
  activation: z.string(),
  reach: z.string(),
  ability: ActionAbilitySchema.nullable(),
  proficient: z.boolean(),
  attackBonus: z.number().int(),
  damageExpression: z.string(),
  damageBonus: z.number().int(),
  damageType: z.string(),
  weaponType: z.string(),
  properties: z.string(),
  description: z.string(),
  inventoryItemId: z.string().nullable(),
  rollMode: RollModeSchema,
});

export const CharacterActionDraftSchema = CharacterActionV2Schema.omit({
  id: true,
});

export type CharacterActionV2 = z.infer<typeof CharacterActionV2Schema>;
export type CharacterActionDraft = z.infer<typeof CharacterActionDraftSchema>;
