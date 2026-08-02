import { CampaignV2Schema, type CampaignV2, type CharacterV2, type LegacyEntityV2, type LegacyGroupV2 } from "../../domain/character/character-v2";
import { checksumJson } from "../../shared/hash";
import { createDeterministicId } from "../../shared/id";
import { cloneJson, type JsonObject, type JsonValue } from "../../shared/json";
import { LegacyCampaignV1Schema, type LegacyCharacterV1 } from "./legacy-v1";
import {
  createDefaultCharacterChecks,
  SKILL_DEFINITIONS,
  type CharacterChecks,
  type SaveKey,
  type SkillKey,
} from "../../domain/character/character-checks";
import {
  abilityModifier,
  proficiencyBonus,
} from "../../domain/character/character-projection";
import type { CharacterInventoryItemV2 } from "../../domain/character/character-inventory-model";
import { createDefaultSpellSlots } from "../../domain/character/character-spell-model";
import { characterColorForId } from "../../domain/character/create-character";
import {
  findSpellDefinitionByName,
  spellLevelNumber,
} from "../../domain/spells/spell-catalog";
import { migrateLegacyEncounters } from "./migrate-encounters-v1";

export interface MigrationOptions {
  campaignId: string;
  migratedAt?: string;
}

export interface MigrationReport {
  sourceVersion: 1 | 2;
  targetVersion: 2;
  sourceChecksum: string;
  resultChecksum: string;
  migratedCharacters: number;
  generatedEntityIds: number;
  warnings: string[];
}

export type MigrationPreview =
  | {
      ok: true;
      data: CampaignV2;
      report: MigrationReport;
    }
  | {
      ok: false;
      issues: string[];
    };

const mappedCharacterKeys = new Set([
  "characterTempHp",
  "currentHitDice",
  "insp",
  "upcastToggle",
  "playerWeaponProficiency",
  "playerArmorProficiency",
  "playerLanguageProficiency",
  "playerToolsProficiency",
  "initiativeButton",
  "AC",
  "speed",
  "characterLevel",
  "playerXP",
  "playerClass",
  "currentCharacterHP",
  "maxCharacterHP",
  "strengthScore",
  "dexterityScore",
  "constitutionScore",
  "intelligenceScore",
  "wisdomScore",
  "charismaScore",
  "hitDiceButton",
  "conditions",
  "coins",
  "alignment",
  "actionTable",
  "spellData",
  "inventoryData",
  "groupTraitData",
  "groupNotesData",
  "extrasData",
]);

function asObject(value: JsonValue | undefined): JsonObject {
  return value !== null && !Array.isArray(value) && typeof value === "object"
    ? cloneJson(value)
    : {};
}

function asObjectArray(value: JsonValue | undefined): JsonObject[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(asObject);
}

function asString(value: JsonValue | undefined, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function asInteger(value: JsonValue | undefined, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(asString(value), 10);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function asStringArray(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.map((entry) => asString(entry)) : [];
}

function legacyHitDieSize(formula: string): 4 | 6 | 8 | 10 | 12 | 20 {
  const match = formula.match(/d(4|6|8|10|12|20)$/);
  const parsed = match?.[1] === undefined ? 8 : Number(match[1]);
  return parsed as 4 | 6 | 8 | 10 | 12 | 20;
}

function legacyConditionLevel(label: string): number | null {
  const match = label.match(/\s(\d+)$/);
  return match?.[1] === undefined ? null : Number(match[1]);
}

const legacySkillModifierKeys: Record<SkillKey, string> = {
  acrobatics: "acrobaticsMod",
  animalHandling: "animalHandlingMod",
  arcana: "arcanaMod",
  athletics: "athleticsMod",
  deception: "deceptionMod",
  history: "historyMod",
  insight: "insightMod",
  intimidation: "intimidationMod",
  investigation: "investigationMod",
  medicine: "medicineMod",
  nature: "natureMod",
  perception: "perceptionMod",
  performance: "performanceMod",
  persuasion: "persuasionMod",
  religion: "religionMod",
  sleightOfHand: "sleightofHandMod",
  stealth: "stealthMod",
  survival: "survivalMod",
};

function skillProficiency(value: JsonValue | undefined): 0 | 0.5 | 1 | 2 {
  const parsed = typeof value === "number" ? value : Number(asString(value));
  return parsed === 0.5 || parsed === 1 || parsed === 2 ? parsed : 0;
}

function saveProficiency(value: JsonValue | undefined): 0 | 1 {
  return Number(value) === 1 ? 1 : 0;
}

function migrateChecks(
  legacy: LegacyCharacterV1,
  abilities: CharacterV2["abilities"],
  level: number,
): CharacterChecks {
  const checks = createDefaultCharacterChecks();
  const proficiency = proficiencyBonus(level);
  (Object.keys(SKILL_DEFINITIONS) as SkillKey[]).forEach((key, index) => {
    const rank = skillProficiency(legacy[`pb-${index + 1}`]);
    const definition = SKILL_DEFINITIONS[key];
    const calculated = Math.floor(
      abilityModifier(abilities[definition.ability]) + proficiency * rank,
    );
    const modifierKey = legacySkillModifierKeys[key];
    const observed = Object.hasOwn(legacy, modifierKey)
      ? asInteger(legacy[modifierKey], calculated)
      : calculated;
    checks.skills[key] = {
      proficiency: rank,
      bonus: observed - calculated,
      rollMode: "normal",
    };
  });
  (Object.keys(checks.savingThrows) as SaveKey[]).forEach((key, index) => {
    checks.savingThrows[key].proficiency = saveProficiency(
      legacy[`pb-${index + 19}`],
    );
  });
  const initiativeCalculated = abilityModifier(abilities.dexterity);
  checks.initiative.bonus =
    asInteger(legacy.initiativeButton, initiativeCalculated) - initiativeCalculated;
  return checks;
}

function legacyActionData(container: JsonObject): JsonObject {
  const nested = Object.values(container).find(
    (value): value is JsonObject =>
      value !== null && !Array.isArray(value) && typeof value === "object",
  );
  return nested ?? container;
}

function legacyActionAbility(value: JsonValue | undefined): keyof CharacterV2["abilities"] | null {
  const normalized = asString(value).trim().toLowerCase();
  const abilities: Record<string, keyof CharacterV2["abilities"]> = {
    str: "strength",
    fue: "strength",
    strength: "strength",
    dex: "dexterity",
    des: "dexterity",
    dexterity: "dexterity",
    con: "constitution",
    constitution: "constitution",
    int: "intelligence",
    intelligence: "intelligence",
    wis: "wisdom",
    sab: "wisdom",
    wisdom: "wisdom",
    cha: "charisma",
    car: "charisma",
    charisma: "charisma",
  };
  return abilities[normalized] ?? null;
}

function legacyActionCategories(value: JsonValue | undefined): CharacterV2["actions"][number]["categories"] {
  const categories = asObject(value);
  const mapped: CharacterV2["actions"][number]["categories"] = [];
  if (categories.attacks === true) mapped.push("attack");
  if (categories.actions === true) mapped.push("action");
  if (categories["bonus-actions"] === true) mapped.push("bonus-action");
  if (categories.reactions === true) mapped.push("reaction");
  if (categories.other === true) mapped.push("other");
  return mapped.length > 0 ? mapped : ["other"];
}

function asBoolean(value: JsonValue | undefined, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    if (["true", "1", "yes"].includes(value.toLowerCase())) return true;
    if (["false", "0", "no", ""].includes(value.toLowerCase())) return false;
  }
  return fallback;
}

function asFiniteNumber(value: JsonValue | undefined, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(asString(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nestedString(value: JsonValue | undefined, key: string): string {
  return asString(asObject(value)[key]);
}

function migrateInventoryCost(value: JsonValue | undefined): CharacterInventoryItemV2["cost"] {
  const object = asObject(value);
  if (Object.keys(object).length > 0) {
    return {
      quantity: Math.max(0, asFiniteNumber(object.quantity)),
      unit: asString(object.unit),
    };
  }
  const match = asString(value).trim().match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(.*)$/);
  return match === null
    ? { quantity: 0, unit: asString(value) }
    : { quantity: Math.max(0, Number(match[1])), unit: match[2]?.trim() ?? "" };
}

function migrateInventoryProperties(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((property) => {
      if (typeof property === "string") return property;
      const object = asObject(property);
      return asString(object.index, asString(object.name));
    })
    .filter((property) => property.length > 0);
}

function migrateInventoryBonuses(value: JsonValue | undefined): CharacterInventoryItemV2["bonuses"] {
  return asObjectArray(value).map((bonus) => ({
    category: asString(bonus.category),
    key: asString(bonus.key),
    value: asFiniteNumber(bonus.value),
    advantage: asBoolean(bonus.advantage),
    disadvantage: asBoolean(bonus.disadvantage),
  }));
}

function typedInventoryItem(entity: LegacyEntityV2): CharacterInventoryItemV2 {
  const data = entity.data;
  const quantity = Math.max(0, asInteger(data.quantity, 1));
  const savedRowWeight = Math.max(0, asFiniteNumber(data.weight));
  const category = nestedString(data.equipment_category, "index") || asString(data.category) || entity.group || "equipment";
  const properties = migrateInventoryProperties(data.properties);
  const requiresAttunement =
    asBoolean(data.requiresAttunement) || properties.includes("attunement");
  const chargesOptions = asObject(data.chargesOptions);
  const hasCharges =
    asBoolean(data.hasCharges) ||
    Object.hasOwn(data, "currentCharges") ||
    asInteger(chargesOptions.maxCharges) > 0;
  const maximumCharges = Math.max(0, asInteger(chargesOptions.maxCharges));
  const armorClass = asObject(data.armor_class);
  const damage = asObject(data.damage);
  const damageType = asObject(damage.damage_type);
  const range = asObject(data.range);
  const throwRange = asObject(data.throw_range);
  const twoHandedDamage = asObject(data.two_handed_damage);
  const weaponLike = category === "weapon" || Object.keys(damage).length > 0;
  const armorLike = category === "armor" || category === "shield" || Object.keys(armorClass).length > 0;
  const usable =
    asBoolean(data.useable, asBoolean(data.usable)) ||
    hasCharges ||
    ["potion", "spell-scroll"].includes(category);
  return {
    id: entity.id,
    order: entity.order,
    group: entity.group || "equipment",
    name: asString(data.name, `Objeto ${entity.order + 1}`).trim() || `Objeto ${entity.order + 1}`,
    quantity,
    // v1 persisted the already-multiplied row weight. Dividing restores the
    // unit value while keeping the exact total for every positive quantity.
    unitWeight: quantity > 0 ? savedRowWeight / quantity : savedRowWeight,
    cost: migrateInventoryCost(data.cost),
    category,
    description: Array.isArray(data.description)
      ? data.description.map((part) => asString(part)).join("\n")
      : asString(data.description),
    properties,
    equipped: asBoolean(data.equipped),
    attuned: asBoolean(data.attuned),
    requiresAttunement,
    usable,
    consumable: asBoolean(data.consumable, category === "potion"),
    charges: hasCharges
      ? {
          current: Math.min(
            Math.max(0, asInteger(data.currentCharges, maximumCharges)),
            maximumCharges,
          ),
          maximum: maximumCharges,
          reset: asString(chargesOptions.chargeReset),
        }
      : null,
    armor: armorLike
      ? {
          base: asInteger(armorClass.base, category === "shield" ? 2 : 10),
          dexterityBonus: asBoolean(armorClass.dex_bonus),
          maximumDexterityBonus: Object.hasOwn(armorClass, "max_bonus")
            ? Math.max(0, asInteger(armorClass.max_bonus))
            : null,
          armorCategory: asString(data.armor_category),
          stealthDisadvantage: asBoolean(data.stealth_disadvantage),
        }
      : null,
    weapon: weaponLike
      ? {
          category: asString(data.weapon_category),
          range: asString(data.weapon_range),
          normalRange: Object.hasOwn(range, "normal") || Object.hasOwn(throwRange, "normal")
            ? Math.max(0, asInteger(throwRange.normal, asInteger(range.normal)))
            : null,
          longRange: Object.hasOwn(range, "long") || Object.hasOwn(throwRange, "long")
            ? Math.max(0, asInteger(throwRange.long, asInteger(range.long)))
            : null,
          damageExpression: asString(damage.damage_dice),
          versatileDamageExpression: asString(twoHandedDamage.damage_dice),
          damageType: asString(damageType.name, asString(damageType.index)),
          attackBonus: asInteger(data.weaponToHitBonus, asInteger(data.weapon_to_hit_bonus)),
          damageBonus: asInteger(data.weaponDamageBonus, asInteger(data.weapon_damage_bonus)),
        }
      : null,
    bonuses: migrateInventoryBonuses(data.bonus),
    effect: { description: "", active: false },
    legacyData: cloneJson(data),
  };
}

function legacyPrepared(value: JsonValue | undefined): boolean {
  return asBoolean(value);
}

function typedCharacterSpells(
  entities: readonly LegacyEntityV2[],
): CharacterV2["spellcasting"]["spells"] {
  return entities.map((entity) => {
    const name = asString(entity.data.name, `Conjuro ${entity.order + 1}`).trim();
    const definition = findSpellDefinitionByName(name);
    return {
      id: entity.id,
      order: entity.order,
      name: name || `Conjuro ${entity.order + 1}`,
      level: definition?.level ?? spellLevelNumber(entity.group ?? ""),
      prepared: legacyPrepared(entity.data.prepared),
      source: definition === null ? "legacy-unresolved" as const : "bundled" as const,
      definition,
      effect: { description: "", active: false },
    };
  });
}

function migrateSpellSlots(spellData: JsonObject): CharacterV2["spellcasting"]["slots"] {
  const slots = createDefaultSpellSlots();
  for (const [levelName, rawLevel] of Object.entries(spellData)) {
    const level = spellLevelNumber(levelName);
    if (level < 1) continue;
    const legacySlots = asObject(rawLevel).slots;
    if (!Array.isArray(legacySlots)) continue;
    slots[String(level)] = {
      maximum: legacySlots.length,
      used: legacySlots.filter((slot) => asBoolean(slot)).length,
    };
  }
  return slots;
}

function legacyTraitReset(value: JsonValue | undefined): "none" | "short-rest" | "long-rest" {
  const normalized = asString(value).trim().toLowerCase().replaceAll(" ", "-");
  return normalized === "short-rest" || normalized === "long-rest" ? normalized : "none";
}

function typedTraitGroups(groups: readonly LegacyGroupV2[]): CharacterV2["traits"] {
  return groups.map((group) => ({
    id: group.id,
    order: group.order,
    title: group.title.trim() || `Grupo ${group.order + 1}`,
    collapsed: group.collapsed,
    traits: group.items.map((entity) => {
      const data = entity.data;
      const checkboxStates = Array.isArray(data.checkboxStates)
        ? data.checkboxStates.map((state) => asBoolean(state))
        : [];
      const maximum = Math.max(0, asInteger(data.numberOfUses, checkboxStates.length));
      const adjustmentCategory = asString(data.adjustmentCategory);
      return {
        id: entity.id,
        order: entity.order,
        name: asString(data.traitName, `Rasgo ${entity.order + 1}`).trim() || `Rasgo ${entity.order + 1}`,
        description: asString(data.traitDescription),
        collapsed: asBoolean(data.cheveron),
        uses: {
          maximum,
          used: Math.min(maximum, checkboxStates.filter(Boolean).length),
          reset: legacyTraitReset(data.resetType),
        },
        adjustment: adjustmentCategory && adjustmentCategory.toLowerCase() !== "none"
          ? {
              category: adjustmentCategory,
              subcategory: asString(data.adjustmentSubCategory),
              ability: asString(data.adjustmentAbility),
              value: asFiniteNumber(data.adjustmentValue),
              advantage: asBoolean(data.advantage),
              disadvantage: asBoolean(data.disadvantage),
              // Legacy persisted the already-adjusted displayed value.
              applyToDerived: false,
            }
          : null,
        effect: { description: "", active: false },
        legacyData: cloneJson(data),
      };
    }),
    legacyData: cloneJson(group.data),
  }));
}

function typedNoteGroups(groups: readonly LegacyGroupV2[]): CharacterV2["notes"] {
  return groups.map((group) => ({
    id: group.id,
    order: group.order,
    title: group.title.trim() || `Notas ${group.order + 1}`,
    collapsed: group.collapsed,
    notes: group.items.map((entity) => ({
      id: entity.id,
      order: entity.order,
      title: asString(entity.data.noteTitle, `Nota ${entity.order + 1}`).trim() || `Nota ${entity.order + 1}`,
      content: asString(entity.data.noteContent),
      tags: asStringArray(entity.data.tags).filter(Boolean),
      legacyData: cloneJson(entity.data),
    })),
    legacyData: cloneJson(group.data),
  }));
}

function typedExtras(entities: readonly LegacyEntityV2[]): CharacterV2["extras"] {
  return entities.map((entity) => ({
    id: entity.id,
    order: entity.order,
    name: asString(entity.data.name, `Extra ${entity.order + 1}`).trim() || `Extra ${entity.order + 1}`,
    hitPoints: {
      current: asInteger(entity.data.currentHp),
      maximum: Math.max(0, asInteger(entity.data.maxHp)),
      temporary: Math.max(0, asInteger(entity.data.tempHp)),
    },
    conditions: [],
    statBlock: asObject(entity.data.statBlock),
    legacyData: cloneJson(entity.data),
  }));
}

function entityIdentityHint(data: JsonObject): string {
  for (const key of ["uniqueId", "itemId", "id", "name", "traitName", "noteTitle"]) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) {
      return `${key}:${value}`;
    }
  }
  return "anonymous";
}

async function migrateEntities(
  kind: string,
  characterId: string,
  entries: readonly JsonObject[],
  group: string | null,
): Promise<LegacyEntityV2[]> {
  return Promise.all(
    entries.map(async (data, order) => ({
      id: await createDeterministicId(
        kind,
        characterId,
        group ?? "",
        String(order),
        entityIdentityHint(data),
      ),
      order,
      group,
      legacyId:
        typeof data.uniqueId === "string"
          ? data.uniqueId
          : typeof data.itemId === "string"
            ? data.itemId
            : null,
      data: cloneJson(data),
    })),
  );
}

async function migrateInventory(
  characterId: string,
  value: JsonValue | undefined,
): Promise<LegacyEntityV2[]> {
  const inventory = asObject(value);
  const groups = await Promise.all(
    Object.entries(inventory).map(([group, entries]) =>
      migrateEntities("inv", characterId, asObjectArray(entries), group),
    ),
  );
  return groups.flat();
}

async function migrateSpells(
  characterId: string,
  spellData: JsonObject,
): Promise<LegacyEntityV2[]> {
  const levels = Object.entries(spellData).filter(
    ([key]) => key !== "spellcastingModifier" && key !== "spelllevelselected",
  );
  const groups = await Promise.all(
    levels.map(([level, levelValue]) => {
      const levelData = asObject(levelValue);
      return migrateEntities(
        "spl",
        characterId,
        asObjectArray(levelData.spells),
        level,
      );
    }),
  );
  return groups.flat();
}

async function migrateGroups(
  groupKind: string,
  itemKind: string,
  itemKey: "notes" | "traits",
  characterId: string,
  value: JsonValue | undefined,
): Promise<LegacyGroupV2[]> {
  return Promise.all(
    asObjectArray(value).map(async (groupData, order) => {
      const title = asString(groupData["group-title"], `Grupo ${order + 1}`);
      const items = await migrateEntities(
        itemKind,
        characterId,
        asObjectArray(groupData[itemKey]),
        title,
      );
      const data = cloneJson(groupData);
      delete data[itemKey];

      return {
        id: await createDeterministicId(
          groupKind,
          characterId,
          String(order),
          title,
        ),
        order,
        title,
        collapsed: Boolean(groupData["group-chevron"]),
        data,
        items,
      };
    }),
  );
}

function collectUnmappedCharacterData(character: LegacyCharacterV1): JsonObject {
  const unmapped: JsonObject = {};
  for (const [key, value] of Object.entries(character)) {
    if (!mappedCharacterKeys.has(key)) {
      unmapped[key] = cloneJson(value);
    }
  }
  return unmapped;
}

async function migrateCharacter(
  campaignId: string,
  sourceKey: string,
  legacy: LegacyCharacterV1,
  migratedAt: string,
): Promise<CharacterV2> {
  const id = await createDeterministicId("chr", campaignId, sourceKey);
  const coins = asObject(legacy.coins);
  const spellData = asObject(legacy.spellData);
  const spellLevels = cloneJson(spellData);
  delete spellLevels.spellcastingModifier;
  delete spellLevels.spelllevelselected;
  const hitDiceFormula = asString(legacy.hitDiceButton, "1d8");
  const migratedConditions = await migrateEntities(
    "cnd",
    id,
    asObjectArray(legacy.conditions),
    null,
  );
  const migratedActions = await migrateEntities(
    "act",
    id,
    asObjectArray(legacy.actionTable),
    null,
  );
  const migratedInventory = await migrateInventory(id, legacy.inventoryData);
  const inventory = (await Promise.all(migratedInventory.map(async (entity) => {
    const item = typedInventoryItem(entity);
    if (!item.equipped || item.quantity <= 1) return [item];
    return [
      { ...item, quantity: 1 },
      {
        ...item,
        id: await createDeterministicId("inv", id, `${entity.id}:unequipped-stack`),
        order: item.order + 1,
        quantity: item.quantity - 1,
        equipped: false,
        attuned: false,
      },
    ];
  }))).flat();
  const migratedSpells = await migrateSpells(id, spellData);
  const spells = typedCharacterSpells(migratedSpells);
  const migratedTraits = await migrateGroups(
    "trg", "trt", "traits", id, legacy.groupTraitData,
  );
  const migratedNotes = await migrateGroups(
    "ntg", "not", "notes", id, legacy.groupNotesData,
  );
  const migratedExtras = await migrateEntities(
    "ext", id, asObjectArray(legacy.extrasData), null,
  );
  const typedConditions = migratedConditions.map((condition) => {
    const label = asString(
      condition.data.text,
      asString(condition.data.condition, "Condición"),
    );
    return {
      id: condition.id,
      key: asString(
        condition.data.value,
        asString(condition.data.condition, label),
      ).toLowerCase(),
      label,
      level: legacyConditionLevel(label),
      addedAt: migratedAt,
    };
  });
  const exhaustionLevel = typedConditions.find(
    (condition) => condition.key === "exhaustion",
  )?.level;
  const level = Math.max(0, asInteger(legacy.characterLevel));
  const abilities: CharacterV2["abilities"] = {
    strength: asInteger(legacy.strengthScore),
    dexterity: asInteger(legacy.dexterityScore),
    constitution: asInteger(legacy.constitutionScore),
    intelligence: asInteger(legacy.intelligenceScore),
    wisdom: asInteger(legacy.wisdomScore),
    charisma: asInteger(legacy.charismaScore),
  };
  const checks = migrateChecks(legacy, abilities, level);
  const proficiency = proficiencyBonus(level);
  const actions: CharacterV2["actions"] = migratedActions.map((entity) => {
    const data = legacyActionData(entity.data);
    const legacyName = asString(data.secondColumn).trim();
    const ability = legacyActionAbility(data.seventhColumn);
    const proficient = Number(data.proficiencyButton) > 0;
    const calculatedAttack =
      (ability === null ? 0 : abilityModifier(abilities[ability])) +
      (proficient ? proficiency : 0);
    const observedAttack = asInteger(data.fourthColumn, calculatedAttack);
    return {
      id: entity.id,
      order: entity.order,
      name: legacyName || `Acción ${entity.order + 1}`,
      categories: legacyActionCategories(data.ninthColumn),
      activation: "",
      reach: asString(data.thirdColumn),
      ability,
      proficient,
      attackBonus: observedAttack - calculatedAttack,
      damageExpression: asString(data.fifthColumn),
      damageBonus: asInteger(data.damageBonus),
      damageType: asString(data.twelvethColumn),
      weaponType: asString(data.weaponType),
      properties: asString(data.tenthColumn),
      description: asString(data.elventhColumn),
      inventoryItemId:
        typeof data.itemId === "string" && data.itemId.length > 0
          ? inventory.find((item) =>
              migratedInventory.find((entity) => entity.id === item.id)?.legacyId === data.itemId,
            )?.id ?? null
          : null,
      rollMode: "normal",
    };
  });

  return {
    schemaVersion: 2,
    id,
    revision: 0,
    name: sourceKey,
    color: characterColorForId(id),
    identity: {
      className: asString(legacy.playerClass),
      level,
      experience: Math.max(0, asInteger(legacy.playerXP)),
      alignment: asString(legacy.alignment),
    },
    abilities,
    combat: {
      armorClass: asInteger(legacy.AC),
      speed: asString(legacy.speed),
      initiative: asString(legacy.initiativeButton),
      hitPoints: {
        current: asInteger(legacy.currentCharacterHP),
        maximum: Math.max(0, asInteger(legacy.maxCharacterHP)),
        temporary: Math.max(0, asInteger(legacy.characterTempHp)),
      },
      hitDice: {
        current: asString(legacy.currentHitDice),
        formula: hitDiceFormula,
        remaining: Math.max(0, asInteger(legacy.currentHitDice)),
        maximum: Math.max(0, asInteger(legacy.characterLevel)),
        dieSize: legacyHitDieSize(hitDiceFormula),
      },
      deathSaves: {
        successes: 0,
        failures: 0,
      },
      conditions: typedConditions.filter(
        (condition) => condition.key !== "exhaustion",
      ),
      inspiration: asInteger(legacy.insp) > 0,
      exhaustion: Math.min(6, Math.max(0, exhaustionLevel ?? 0)),
    },
    proficiencies: {
      weapons: asStringArray(legacy.playerWeaponProficiency),
      armor: asStringArray(legacy.playerArmorProficiency),
      languages: asStringArray(legacy.playerLanguageProficiency),
      tools: asStringArray(legacy.playerToolsProficiency),
    },
    checks,
    actions,
    inventory,
    traits: typedTraitGroups(migratedTraits),
    notes: typedNoteGroups(migratedNotes),
    extras: typedExtras(migratedExtras),
    taleSpire: null,
    currency: {
      copper: asInteger(coins.cp),
      silver: asInteger(coins.sp),
      electrum: asInteger(coins.ep),
      gold: asInteger(coins.gp),
      platinum: asInteger(coins.pp),
    },
    spellcasting: {
      ability:
        typeof spellData.spellcastingModifier === "string"
          ? spellData.spellcastingModifier
          : null,
      selectedLevel:
        typeof spellData.spelllevelselected === "string"
          ? spellData.spelllevelselected
          : null,
      levels: spellLevels,
      showUpcast: asBoolean(legacy.upcastToggle),
      attackBonus: asInteger(spellData.spellmagicbonus),
      saveDcBonus: 0,
      favoriteSpells: [],
      spells,
      slots: migrateSpellSlots(spellData),
    },
    collections: {
      conditions: migratedConditions,
      actions: migratedActions,
      spells: migratedSpells,
      inventory: migratedInventory,
      traits: migratedTraits,
      notes: migratedNotes,
      extras: migratedExtras,
    },
    legacy: {
      sourceKey,
      unmapped: collectUnmappedCharacterData(legacy),
    },
    metadata: {
      createdAt: migratedAt,
      updatedAt: migratedAt,
      migratedFrom: "v1",
    },
  };
}

function formatIssues(error: { issues: readonly { path: PropertyKey[]; message: string }[] }): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "root";
    return `${path}: ${issue.message}`;
  });
}

function countGeneratedEntityIds(campaign: CampaignV2): number {
  let count = 1;
  for (const character of Object.values(campaign.characters)) {
    count += 1;
    count += character.collections.conditions.length;
    count += character.collections.actions.length;
    count += character.collections.spells.length;
    count += character.collections.inventory.length;
    count += character.collections.extras.length;
    for (const group of [...character.collections.traits, ...character.collections.notes]) {
      count += 1 + group.items.length;
    }
  }
  return count;
}

export async function previewCampaignMigration(
  input: unknown,
  options: MigrationOptions,
): Promise<MigrationPreview> {
  const alreadyV2 = CampaignV2Schema.safeParse(input);
  if (alreadyV2.success) {
    const checksum = await checksumJson(alreadyV2.data);
    return {
      ok: true,
      data: cloneJson(alreadyV2.data),
      report: {
        sourceVersion: 2,
        targetVersion: 2,
        sourceChecksum: checksum,
        resultChecksum: checksum,
        migratedCharacters: 0,
        generatedEntityIds: 0,
        warnings: ["ALREADY_V2"],
      },
    };
  }

  if (options.campaignId.trim().length === 0) {
    return { ok: false, issues: ["campaignId: Required"] };
  }

  const migratedAt = options.migratedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(migratedAt))) {
    return { ok: false, issues: ["migratedAt: Invalid ISO timestamp"] };
  }

  const parsed = LegacyCampaignV1Schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: formatIssues(parsed.error) };
  }

  const source = parsed.data;
  const campaignStableId = await createDeterministicId("cmp", options.campaignId);
  const migratedCharacters = await Promise.all(
    Object.entries(source.characters).map(([sourceKey, character]) =>
      migrateCharacter(options.campaignId, sourceKey, character, migratedAt),
    ),
  );
  const characters = Object.fromEntries(
    migratedCharacters.map((character) => [character.id, character]),
  );
  const encounters = await migrateLegacyEncounters(
    campaignStableId,
    source["Encounter Data"] === undefined ? null : source["Encounter Data"],
    migratedAt,
  );
  const legacyDmNotes = source.DmNotes && typeof source.DmNotes === "object" && !Array.isArray(source.DmNotes)
    ? source.DmNotes as Record<string, unknown>
    : {};
  const legacyNoteGroups = Array.isArray(legacyDmNotes.groupNotesData) ? legacyDmNotes.groupNotesData : [];
  const noteGroups = await Promise.all(legacyNoteGroups.map(async (groupInput, groupIndex) => {
    const group = groupInput && typeof groupInput === "object" && !Array.isArray(groupInput) ? groupInput as Record<string, unknown> : {};
    const groupTitle = String(group["group-title"] ?? `Grupo ${groupIndex + 1}`).trim() || `Grupo ${groupIndex + 1}`;
    const notesInput = Array.isArray(group.notes) ? group.notes : [];
    const notes = await Promise.all(notesInput.map(async (noteInput, noteIndex) => {
      const note = noteInput && typeof noteInput === "object" && !Array.isArray(noteInput) ? noteInput as Record<string, unknown> : {};
      const title = String(note.noteTitle ?? `Nota ${noteIndex + 1}`).trim() || `Nota ${noteIndex + 1}`;
      return {
        id: await createDeterministicId("gmn", options.campaignId, String(groupIndex), String(noteIndex), title),
        title,
        content: String(note.noteContent ?? ""),
      };
    }));
    return {
      id: await createDeterministicId("gmg", options.campaignId, String(groupIndex), groupTitle),
      title: groupTitle,
      notes,
    };
  }));
  const rootUnmapped: JsonObject = {};
  for (const [key, value] of Object.entries(source)) {
    if (
      value !== undefined &&
      key !== "characters" &&
      key !== "DmNotes" &&
      key !== "Encounter Data"
    ) {
      rootUnmapped[key] = cloneJson(value);
    }
  }

  const candidate: CampaignV2 = {
    schemaVersion: 2,
    id: campaignStableId,
    revision: 0,
    characters,
    encounters,
    gm: { noteGroups, randomTables: [], googleDocsUrl: "" },
    legacy: {
      dmNotes: source.DmNotes === undefined ? null : cloneJson(source.DmNotes),
      encounterData:
        source["Encounter Data"] === undefined
          ? null
          : cloneJson(source["Encounter Data"]),
      unmapped: rootUnmapped,
    },
    metadata: {
      createdAt: migratedAt,
      updatedAt: migratedAt,
      migratedFrom: "v1",
    },
  };

  const validated = CampaignV2Schema.safeParse(candidate);
  if (!validated.success) {
    return { ok: false, issues: formatIssues(validated.error) };
  }

  const warnings: string[] = [];
  for (const character of Object.values(source.characters)) {
    if (Object.hasOwn(character, "")) {
      warnings.push("LEGACY_EMPTY_PROPERTY_PRESERVED");
      break;
    }
  }

  return {
    ok: true,
    data: validated.data,
    report: {
      sourceVersion: 1,
      targetVersion: 2,
      sourceChecksum: await checksumJson(source),
      resultChecksum: await checksumJson(validated.data),
      migratedCharacters: migratedCharacters.length,
      generatedEntityIds: countGeneratedEntityIds(validated.data),
      warnings,
    },
  };
}
