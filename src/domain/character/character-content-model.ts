import { z } from "zod";
import { STABLE_ID_PATTERN } from "../../shared/id";
import { JsonObjectSchema } from "../../shared/json";
import { ActivatableEffectSchema } from "./character-effect-model";

const StableId = z.string().regex(STABLE_ID_PATTERN);
const ExtraConditionSchema = z.object({
  id: StableId,
  key: z.string().min(1),
  label: z.string().min(1),
  level: z.number().int().positive().nullable(),
  addedAt: z.string().datetime({ offset: true }),
});

export const TraitAdjustmentSchema = z.object({
  category: z.string(),
  subcategory: z.string(),
  ability: z.string(),
  value: z.number().finite(),
  advantage: z.boolean(),
  disadvantage: z.boolean(),
  applyToDerived: z.boolean(),
});

export const CharacterTraitV2Schema = z.object({
  id: StableId,
  order: z.number().int().nonnegative(),
  name: z.string().min(1),
  description: z.string(),
  collapsed: z.boolean(),
  uses: z.object({
    maximum: z.number().int().nonnegative(),
    used: z.number().int().nonnegative(),
    reset: z.enum(["none", "short-rest", "long-rest"]),
  }).refine((uses) => uses.used <= uses.maximum, {
    message: "Used trait uses cannot exceed maximum uses",
    path: ["used"],
  }),
  adjustment: TraitAdjustmentSchema.nullable(),
  effect: ActivatableEffectSchema,
  legacyData: JsonObjectSchema,
});

export const CharacterTraitGroupV2Schema = z.object({
  id: StableId,
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
  collapsed: z.boolean(),
  traits: z.array(CharacterTraitV2Schema),
  legacyData: JsonObjectSchema,
});

export const CharacterNoteV2Schema = z.object({
  id: StableId,
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
  content: z.string(),
  tags: z.array(z.string()),
  legacyData: JsonObjectSchema,
});

export const CharacterNoteGroupV2Schema = z.object({
  id: StableId,
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
  collapsed: z.boolean(),
  notes: z.array(CharacterNoteV2Schema),
  legacyData: JsonObjectSchema,
});

export const CharacterExtraV2Schema = z.object({
  id: StableId,
  order: z.number().int().nonnegative(),
  name: z.string().min(1),
  hitPoints: z.object({
    current: z.number().int(),
    maximum: z.number().int().nonnegative(),
    temporary: z.number().int().nonnegative(),
  }),
  conditions: z.array(ExtraConditionSchema),
  statBlock: JsonObjectSchema,
  legacyData: JsonObjectSchema,
});

export const CharacterTraitDraftSchema = CharacterTraitV2Schema.omit({ id: true });
export const CharacterTraitGroupDraftSchema = CharacterTraitGroupV2Schema.omit({ id: true, traits: true });
export const CharacterNoteDraftSchema = CharacterNoteV2Schema.omit({ id: true });
export const CharacterNoteGroupDraftSchema = CharacterNoteGroupV2Schema.omit({ id: true, notes: true });
export const CharacterExtraDraftSchema = CharacterExtraV2Schema.omit({ id: true });

export type CharacterTraitV2 = z.infer<typeof CharacterTraitV2Schema>;
export type CharacterTraitGroupV2 = z.infer<typeof CharacterTraitGroupV2Schema>;
export type CharacterNoteV2 = z.infer<typeof CharacterNoteV2Schema>;
export type CharacterNoteGroupV2 = z.infer<typeof CharacterNoteGroupV2Schema>;
export type CharacterExtraV2 = z.infer<typeof CharacterExtraV2Schema>;
export type CharacterTraitDraft = z.infer<typeof CharacterTraitDraftSchema>;
export type CharacterTraitGroupDraft = z.infer<typeof CharacterTraitGroupDraftSchema>;
export type CharacterNoteDraft = z.infer<typeof CharacterNoteDraftSchema>;
export type CharacterNoteGroupDraft = z.infer<typeof CharacterNoteGroupDraftSchema>;
export type CharacterExtraDraft = z.infer<typeof CharacterExtraDraftSchema>;
