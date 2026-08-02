import englishEquipment from "../../../equipment-eng.json";
import spanishEquipment from "../../../equipment-es.json";
import {
  CharacterInventoryItemDraftSchema,
  type CharacterInventoryItemDraft,
} from "../character/character-inventory-model";
import { cloneJson, type JsonObject, type JsonValue } from "../../shared/json";

export type EquipmentCatalogDraft = Omit<CharacterInventoryItemDraft, "order" | "group">;

function object(value: JsonValue | undefined): JsonObject {
  return value !== null && value !== undefined && !Array.isArray(value) && typeof value === "object"
    ? value
    : {};
}

function text(value: JsonValue | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function number(value: JsonValue | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function normalizeEquipmentDefinition(input: unknown): EquipmentCatalogDraft {
  const existing = CharacterInventoryItemDraftSchema.safeParse(input);
  if (existing.success) {
    const { order: _order, group: _group, ...definition } = existing.data;
    return definition;
  }
  const data = cloneJson(input as JsonObject);
  const category = object(data.equipment_category);
  const cost = object(data.cost);
  const damage = object(data.damage);
  const damageType = object(damage.damage_type);
  const range = object(data.throw_range ?? data.range);
  const armorClass = object(data.armor_class);
  const properties = Array.isArray(data.properties)
    ? data.properties.map((entry) => text(object(entry).name || object(entry).index)).filter(Boolean)
    : [];
  const bonuses = (Array.isArray(data.bonus) ? data.bonus : Array.isArray(data.bonuses) ? data.bonuses : [])
    .map((entry) => object(entry))
    .map((entry) => ({
      category: text(entry.category),
      key: text(entry.key),
      value: Number(entry.value) || 0,
      advantage: Boolean(entry.advantage),
      disadvantage: Boolean(entry.disadvantage),
    }))
    .filter((entry) => entry.category.length > 0 && entry.key.length > 0);
  const categoryKey = text(category.index || data.category).toLowerCase();
  const isWeapon = categoryKey.includes("weapon") || damage.damage_dice !== undefined;
  const isArmor = categoryKey.includes("armor") || armorClass.base !== undefined;
  const name = text(data.name).trim();

  return {
    name: name || "Objeto sin nombre",
    quantity: 1,
    unitWeight: number(data.weight),
    cost: { quantity: number(cost.quantity), unit: text(cost.unit) },
    category: categoryKey || "adventuring-gear",
    description: text(data.description ?? data.desc),
    properties,
    equipped: false,
    attuned: false,
    requiresAttunement: Boolean(data.requires_attunement ?? data.requiresAttunement) ||
      properties.some((property) => property.toLowerCase().includes("attun")),
    usable: Boolean(data.usable) || categoryKey.includes("potion") || categoryKey.includes("scroll"),
    consumable: Boolean(data.consumable) || categoryKey.includes("potion") || categoryKey.includes("scroll"),
    charges: null,
    armor: isArmor ? {
      base: Math.trunc(number(armorClass.base)),
      dexterityBonus: Boolean(armorClass.dex_bonus),
      maximumDexterityBonus: armorClass.max_bonus === undefined ? null : Math.trunc(number(armorClass.max_bonus)),
      armorCategory: text(data.armor_category),
      stealthDisadvantage: Boolean(data.stealth_disadvantage),
    } : null,
    weapon: isWeapon ? {
      category: text(data.weapon_category ?? data.category_range),
      range: text(data.weapon_range),
      normalRange: range.normal === undefined ? null : Math.trunc(number(range.normal)),
      longRange: range.long === undefined ? null : Math.trunc(number(range.long)),
      damageExpression: text(damage.damage_dice),
      versatileDamageExpression: text(object(data.two_handed_damage).damage_dice),
      damageType: text(damageType.name || damageType.index),
      attackBonus: 0,
      damageBonus: 0,
    } : null,
    bonuses,
    effect: { description: "", active: false },
    legacyData: data,
  };
}

const englishDefinitions = (englishEquipment as unknown[]).map(normalizeEquipmentDefinition);
const spanishDefinitions = (spanishEquipment as unknown[]).map(normalizeEquipmentDefinition);
const definitions = [...englishDefinitions, ...spanishDefinitions];

export function allEquipmentDefinitions(): readonly EquipmentCatalogDraft[] {
  return definitions;
}

export function equipmentDefinitionsForLanguage(language: "eng" | "es" | "both"): readonly EquipmentCatalogDraft[] {
  return language === "eng" ? englishDefinitions : language === "es" ? spanishDefinitions : definitions;
}

export function findEquipmentDefinitionByName(name: string): EquipmentCatalogDraft | null {
  const normalized = name.trim().toLocaleLowerCase();
  return definitions.find((item) => item.name.toLocaleLowerCase() === normalized) ?? null;
}
