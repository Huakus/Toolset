import englishMonsters from "../../../Monster_Manual-eng.json";
import spanishMonsters from "../../../Monster_Manual-es.json";
import { cloneJson, type JsonObject } from "../../shared/json";

const monsters = [
  ...Object.values(englishMonsters as Record<string, unknown>),
  ...Object.values(spanishMonsters as Record<string, unknown>),
].filter((value): value is JsonObject => value !== null && !Array.isArray(value) && typeof value === "object")
  .map(cloneJson);

export interface MonsterFeature {
  name: string;
  content: string;
  usage: string;
}

export interface MonsterDefinition {
  id: string;
  name: string;
  type: string;
  challenge: string;
  armorClass: number;
  hitPoints: number;
  hitPointFormula: string;
  initiativeModifier: number;
  initiativeAdvantage: boolean;
  speed: string[];
  abilities: Record<string, number>;
  saves: string[];
  skills: string[];
  senses: string[];
  languages: string[];
  damageVulnerabilities: string[];
  damageResistances: string[];
  damageImmunities: string[];
  conditionImmunities: string[];
  traits: MonsterFeature[];
  actions: MonsterFeature[];
  reactions: MonsterFeature[];
  legendaryActions: MonsterFeature[];
  legacyData: JsonObject;
}

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function integer(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function boolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function features(value: unknown): MonsterFeature[] {
  return Array.isArray(value) ? value.flatMap((entry) => {
    const data = object(entry);
    const name = String(data.Name ?? data.name ?? "").trim();
    const content = String(data.Content ?? data.content ?? "").trim();
    return name || content ? [{ name, content, usage: String(data.Usage ?? data.usage ?? "").trim() }] : [];
  }) : [];
}

function quickActions(value: unknown): MonsterFeature[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const data = object(entry);
    const name = String(data.Name ?? data.name ?? "").trim();
    const toHit = String(data.ToHit ?? data.toHit ?? "").trim();
    const damage = String(data.Damage ?? data.damage ?? "").trim();
    const damageType = String(data.DamageType ?? data.damageType ?? "").trim();
    const parts = [toHit ? `Ataque: ${toHit}` : "", damage ? `Daño: ${damage}${damageType ? ` ${damageType}` : ""}` : ""].filter(Boolean);
    return name || parts.length ? [{ name, content: parts.join(" · "), usage: "" }] : [];
  });
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string" || typeof entry === "number") return [String(entry)];
    const data = object(entry);
    const name = String(data.Name ?? data.name ?? "").trim();
    const detail = String(data.Value ?? data.value ?? data.Modifier ?? data.modifier ?? "").trim();
    return name || detail ? [`${name}${name && detail ? " " : ""}${detail}`] : [];
  }).filter(Boolean);
}

export function normalizeMonsterDefinition(value: unknown): MonsterDefinition {
  const source = object(value);
  const hp = object(source.HP ?? source.hp);
  const ac = object(source.AC ?? source.ac);
  const abilityData = object(source.Abilities ?? source.abilities);
  return {
    id: String(source.Id ?? source.id ?? source.Name ?? source.name ?? "").trim(),
    name: String(source.Name ?? source.name ?? "").trim(),
    type: String(source.Type ?? source.type ?? "").trim(),
    challenge: String(source.Challenge ?? source.challenge ?? source.CR ?? source.cr ?? "").trim(),
    armorClass: integer(ac.Value ?? ac.value ?? source.AC ?? source.ac),
    hitPoints: Math.max(0, integer(hp.Value ?? hp.value ?? source.HP ?? source.hp)),
    hitPointFormula: String(hp.Notes ?? hp.notes ?? "").replace(/[()]/g, "").trim(),
    initiativeModifier: integer(source.InitiativeModifier ?? source.initiativeModifier),
    initiativeAdvantage: boolean(source.InitiativeAdvantage ?? source.initiativeAdvantage),
    speed: strings(source.Speed ?? source.speed),
    abilities: Object.fromEntries(Object.entries(abilityData).map(([key, score]) => [key, integer(score)])),
    saves: strings(source.Saves ?? source.saves),
    skills: strings(source.Skills ?? source.skills),
    senses: strings(source.Senses ?? source.senses),
    languages: strings(source.Languages ?? source.languages),
    damageVulnerabilities: strings(source.DamageVulnerabilities ?? source.damageVulnerabilities),
    damageResistances: strings(source.DamageResistances ?? source.damageResistances),
    damageImmunities: strings(source.DamageImmunities ?? source.damageImmunities),
    conditionImmunities: strings(source.ConditionImmunities ?? source.conditionImmunities),
    traits: features(source.Traits ?? source.traits),
    actions: [...quickActions(source.QuickAction ?? source.quickAction), ...features(source.Actions ?? source.actions)],
    reactions: features(source.Reactions ?? source.reactions),
    legendaryActions: features(source.LegendaryActions ?? source.legendaryActions),
    legacyData: cloneJson(source),
  };
}

const definitions = monsters.map(normalizeMonsterDefinition).filter((monster) => monster.name);

export function allMonsterNames(): readonly string[] {
  return definitions.map((monster) => monster.name);
}

export function findMonsterByName(name: string): JsonObject | null {
  const normalized = name.trim().toLocaleLowerCase();
  return monsters.find((monster) =>
    String(monster.Name ?? monster.name ?? "").toLocaleLowerCase() === normalized,
  ) ?? null;
}

export function monsterDefinitions(): readonly MonsterDefinition[] {
  return definitions;
}

export function findMonsterDefinition(nameOrId: string): MonsterDefinition | null {
  const normalized = nameOrId.trim().toLocaleLowerCase();
  return definitions.find((monster) => monster.id.toLocaleLowerCase() === normalized || monster.name.toLocaleLowerCase() === normalized) ?? null;
}
