import { z } from "zod";
import { STABLE_ID_PATTERN } from "../../shared/id";
import { JsonObjectSchema } from "../../shared/json";
import { ActivatableEffectSchema } from "./character-effect-model";

export const InventoryCostSchema = z.object({
  quantity: z.number().finite().nonnegative(),
  unit: z.string(),
});

export const InventoryChargesSchema = z.object({
  current: z.number().int().nonnegative(),
  maximum: z.number().int().nonnegative(),
  reset: z.string(),
}).refine((charges) => charges.current <= charges.maximum, {
  message: "Current charges cannot exceed maximum charges",
  path: ["current"],
});

export const InventoryArmorSchema = z.object({
  base: z.number().int(),
  dexterityBonus: z.boolean(),
  maximumDexterityBonus: z.number().int().nonnegative().nullable(),
  armorCategory: z.string(),
  stealthDisadvantage: z.boolean(),
});

export const InventoryWeaponSchema = z.object({
  category: z.string(),
  range: z.string(),
  normalRange: z.number().int().nonnegative().nullable(),
  longRange: z.number().int().nonnegative().nullable(),
  damageExpression: z.string(),
  versatileDamageExpression: z.string(),
  damageType: z.string(),
  attackBonus: z.number().int(),
  damageBonus: z.number().int(),
});

export const InventoryBonusSchema = z.object({
  category: z.string(),
  key: z.string(),
  value: z.number().finite(),
  advantage: z.boolean(),
  disadvantage: z.boolean(),
});

export const CharacterInventoryItemV2Schema = z.object({
  id: z.string().regex(STABLE_ID_PATTERN),
  order: z.number().int().nonnegative(),
  group: z.string().min(1),
  name: z.string().min(1),
  quantity: z.number().int().nonnegative(),
  unitWeight: z.number().finite().nonnegative(),
  cost: InventoryCostSchema,
  category: z.string(),
  description: z.string(),
  properties: z.array(z.string()),
  equipped: z.boolean(),
  attuned: z.boolean(),
  requiresAttunement: z.boolean(),
  usable: z.boolean(),
  consumable: z.boolean(),
  charges: InventoryChargesSchema.nullable(),
  armor: InventoryArmorSchema.nullable(),
  weapon: InventoryWeaponSchema.nullable(),
  bonuses: z.array(InventoryBonusSchema),
  effect: ActivatableEffectSchema,
  legacyData: JsonObjectSchema,
});

export const CharacterInventoryItemDraftSchema = CharacterInventoryItemV2Schema.omit({
  id: true,
});

export type CharacterInventoryItemV2 = z.infer<typeof CharacterInventoryItemV2Schema>;
export type CharacterInventoryItemDraft = z.infer<typeof CharacterInventoryItemDraftSchema>;
export type InventoryCharges = z.infer<typeof InventoryChargesSchema>;
