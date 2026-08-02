import { z } from "zod";

export const SKILL_DEFINITIONS = {
  acrobatics: { label: "Acrobacias", ability: "dexterity" },
  animalHandling: { label: "Trato con animales", ability: "wisdom" },
  arcana: { label: "Arcano", ability: "intelligence" },
  athletics: { label: "Atletismo", ability: "strength" },
  deception: { label: "Engaño", ability: "charisma" },
  history: { label: "Historia", ability: "intelligence" },
  insight: { label: "Perspicacia", ability: "wisdom" },
  intimidation: { label: "Intimidación", ability: "charisma" },
  investigation: { label: "Investigación", ability: "intelligence" },
  medicine: { label: "Medicina", ability: "wisdom" },
  nature: { label: "Naturaleza", ability: "intelligence" },
  perception: { label: "Percepción", ability: "wisdom" },
  performance: { label: "Interpretación", ability: "charisma" },
  persuasion: { label: "Persuasión", ability: "charisma" },
  religion: { label: "Religión", ability: "intelligence" },
  sleightOfHand: { label: "Juego de manos", ability: "dexterity" },
  stealth: { label: "Sigilo", ability: "dexterity" },
  survival: { label: "Supervivencia", ability: "wisdom" },
} as const;

export const SAVE_DEFINITIONS = {
  strength: { label: "Fuerza" },
  dexterity: { label: "Destreza" },
  constitution: { label: "Constitución" },
  intelligence: { label: "Inteligencia" },
  wisdom: { label: "Sabiduría" },
  charisma: { label: "Carisma" },
} as const;

export type SkillKey = keyof typeof SKILL_DEFINITIONS;
export type SaveKey = keyof typeof SAVE_DEFINITIONS;
export type CheckAbilityKey = SaveKey;

export const RollModeSchema = z.enum(["normal", "advantage", "disadvantage"]);
export type RollMode = z.infer<typeof RollModeSchema>;
export const SkillProficiencySchema = z.union([
  z.literal(0),
  z.literal(0.5),
  z.literal(1),
  z.literal(2),
]);
export const SaveProficiencySchema = z.union([z.literal(0), z.literal(1)]);

const SkillStateSchema = z.object({
  proficiency: SkillProficiencySchema,
  bonus: z.number().int(),
  rollMode: RollModeSchema,
});

const SaveStateSchema = z.object({
  proficiency: SaveProficiencySchema,
  bonus: z.number().int(),
  rollMode: RollModeSchema,
});

const skillShape = Object.fromEntries(
  Object.keys(SKILL_DEFINITIONS).map((key) => [key, SkillStateSchema]),
) as { [K in SkillKey]: typeof SkillStateSchema };

const saveShape = Object.fromEntries(
  Object.keys(SAVE_DEFINITIONS).map((key) => [key, SaveStateSchema]),
) as { [K in SaveKey]: typeof SaveStateSchema };

export const CharacterChecksSchema = z.object({
  skills: z.object(skillShape),
  savingThrows: z.object(saveShape),
  initiative: z.object({
    bonus: z.number().int(),
    rollMode: RollModeSchema,
  }),
  passiveBonuses: z.object({
    perception: z.number().int(),
    investigation: z.number().int(),
    insight: z.number().int(),
  }),
});

export type CharacterChecks = z.infer<typeof CharacterChecksSchema>;
export type SkillState = CharacterChecks["skills"][SkillKey];
export type SaveState = CharacterChecks["savingThrows"][SaveKey];

export function createDefaultCharacterChecks(): CharacterChecks {
  return CharacterChecksSchema.parse({
    skills: Object.fromEntries(
      Object.keys(SKILL_DEFINITIONS).map((key) => [
        key,
        { proficiency: 0, bonus: 0, rollMode: "normal" },
      ]),
    ),
    savingThrows: Object.fromEntries(
      Object.keys(SAVE_DEFINITIONS).map((key) => [
        key,
        { proficiency: 0, bonus: 0, rollMode: "normal" },
      ]),
    ),
    initiative: { bonus: 0, rollMode: "normal" },
    passiveBonuses: { perception: 0, investigation: 0, insight: 0 },
  });
}
