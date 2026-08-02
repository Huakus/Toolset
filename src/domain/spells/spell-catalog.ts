import englishSpells from "../../../spells-eng.json";
import spanishSpells from "../../../spells-es.json";
import {
  SpellDefinitionSchema,
  type SpellDefinition,
} from "../character/character-spell-model";
import { cloneJson, type JsonObject, type JsonValue } from "../../shared/json";

function object(value: unknown): JsonObject {
  return value !== null && !Array.isArray(value) && typeof value === "object"
    ? cloneJson(value as JsonObject)
    : {};
}

function text(value: JsonValue | undefined): string {
  return value === undefined || value === null ? "" : String(value);
}

export function spellLevelNumber(value: string): number {
  const normalized = value.trim().toLowerCase();
  if (normalized === "cantrip" || normalized === "truco") return 0;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isInteger(parsed) ? Math.min(9, Math.max(0, parsed)) : 0;
}

export function normalizeSpellDefinition(input: unknown): SpellDefinition {
  const normalized = SpellDefinitionSchema.safeParse(input);
  if (normalized.success) return normalized.data;
  const data = object(input);
  const attackRaw = text(data.toHitOrDC).toLowerCase();
  const attackType = attackRaw.includes("hit") || attackRaw.includes("golpear")
    ? "attack"
    : attackRaw.includes("dc") || attackRaw.includes("cd")
      ? "save"
      : "none";
  return SpellDefinitionSchema.parse({
    name: text(data.name).trim(),
    level: spellLevelNumber(text(data.level)),
    description: text(data.desc ?? data.description),
    higherLevels: text(data.higher_level),
    range: text(data.range),
    components: text(data.components),
    material: text(data.material),
    ritual: ["yes", "true", "ritual"].includes(text(data.ritual).toLowerCase()),
    duration: text(data.duration),
    concentration: ["yes", "true", "sí", "si"].includes(text(data.concentration).toLowerCase()),
    castingTime: text(data.casting_time),
    school: text(data.school),
    classes: text(data.class),
    attackType,
    saveAbility: text(data.spell_save_dc_type),
    damageExpression: text(data.damage_dice),
    upcastDamageExpression: text(data.damage_dice_upcast),
    addAbilityModifier: ["yes", "true", "sí", "si"].includes(text(data.ability_modifier).toLowerCase()),
    damageType: text(data.damage_type_01),
    year: text(data.year || "2014"),
    legacyData: data,
  });
}

const englishDefinitions = (englishSpells as unknown[]).map(normalizeSpellDefinition);
const spanishDefinitions = (spanishSpells as unknown[]).map(normalizeSpellDefinition);
const definitions = [...englishDefinitions, ...spanishDefinitions];

export function allSpellDefinitions(): readonly SpellDefinition[] {
  return definitions;
}

export function spellDefinitionsForLanguage(language: "eng" | "es" | "both"): readonly SpellDefinition[] {
  return language === "eng" ? englishDefinitions : language === "es" ? spanishDefinitions : definitions;
}

export function findSpellDefinitionByName(name: string): SpellDefinition | null {
  const normalized = name.trim().toLocaleLowerCase();
  return definitions.find((spell) => spell.name.toLocaleLowerCase() === normalized) ?? null;
}
