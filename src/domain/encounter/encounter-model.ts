import { z } from "zod";
import { STABLE_ID_PATTERN } from "../../shared/id";

const StableIdSchema = z.string().regex(STABLE_ID_PATTERN);
const TimestampSchema = z.string().datetime({ offset: true });

export const EncounterConditionSchema = z.object({
  id: StableIdSchema,
  key: z.string().min(1),
  label: z.string().min(1),
  level: z.number().int().positive().nullable(),
  addedAt: TimestampSchema,
});

const CombatantBaseSchema = z.object({
  id: StableIdSchema,
  name: z.string().min(1),
  initiative: z.number().int().nullable(),
  order: z.number().int().nonnegative(),
  armorClass: z.number().int().nonnegative().nullable(),
  hitPoints: z.object({
    current: z.number().int().nonnegative(),
    maximum: z.number().int().nonnegative(),
    temporary: z.number().int().nonnegative(),
  }),
  conditions: z.array(EncounterConditionSchema),
  visibleToPlayers: z.boolean(),
});

export const PlayerCombatantSchema = CombatantBaseSchema.extend({
  kind: z.literal("player"),
  characterId: StableIdSchema.nullable(),
  taleSpireClientId: z.string().min(1).nullable(),
});

export const MonsterCombatantSchema = CombatantBaseSchema.extend({
  kind: z.literal("monster"),
  monsterDefinitionId: z.string().min(1),
});

export const CustomCombatantSchema = CombatantBaseSchema.extend({
  kind: z.literal("custom"),
});

export const EncounterCombatantSchema = z.discriminatedUnion("kind", [
  PlayerCombatantSchema,
  MonsterCombatantSchema,
  CustomCombatantSchema,
]).refine(
  (combatant) => combatant.hitPoints.current <= combatant.hitPoints.maximum,
  { message: "Los PG actuales no pueden superar los PG máximos.", path: ["hitPoints", "current"] },
);

export const EncounterSchema = z.object({
  schemaVersion: z.literal(1),
  id: StableIdSchema,
  revision: z.number().int().nonnegative(),
  name: z.string().min(1),
  round: z.number().int().positive(),
  activeCombatantId: StableIdSchema.nullable(),
  combatants: z.array(EncounterCombatantSchema),
  metadata: z.object({
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  }),
}).superRefine((encounter, context) => {
  const ids = new Set<string>();
  encounter.combatants.forEach((combatant, index) => {
    if (ids.has(combatant.id)) {
      context.addIssue({
        code: "custom",
        message: "Cada combatiente debe tener un identificador único.",
        path: ["combatants", index, "id"],
      });
    }
    ids.add(combatant.id);
  });
  if (encounter.activeCombatantId !== null && !ids.has(encounter.activeCombatantId)) {
    context.addIssue({
      code: "custom",
      message: "El turno activo debe pertenecer a un combatiente del encuentro.",
      path: ["activeCombatantId"],
    });
  }
});

export type EncounterCondition = z.infer<typeof EncounterConditionSchema>;
export type PlayerCombatant = z.infer<typeof PlayerCombatantSchema>;
export type MonsterCombatant = z.infer<typeof MonsterCombatantSchema>;
export type CustomCombatant = z.infer<typeof CustomCombatantSchema>;
export type EncounterCombatant = z.infer<typeof EncounterCombatantSchema>;
export type Encounter = z.infer<typeof EncounterSchema>;

