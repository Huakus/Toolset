import type { CharacterV2 } from "./character-v2";
import {
  SKILL_DEFINITIONS,
  type SaveKey,
  type SkillKey,
} from "./character-checks";
import type { CharacterActionV2 } from "./character-action-model";
import type { CharacterSpellV2, SpellcastingAbility } from "./character-spell-model";
import type { RollMode } from "./character-checks";

export type AbilityKey = keyof CharacterV2["abilities"];

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function proficiencyBonus(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function activeInventoryBonuses(character: CharacterV2) {
  return character.inventory
    .filter((item) => item.equipped && (!item.requiresAttunement || item.attuned))
    .flatMap((item) => item.bonuses);
}

function inventoryBonus(character: CharacterV2, category: string, keys: readonly string[]): number {
  const normalizedCategory = normalizedKey(category);
  const normalizedKeys = new Set(["all", ...keys.map(normalizedKey)]);
  return activeInventoryBonuses(character)
    .filter((bonus) => normalizedKey(bonus.category) === normalizedCategory && normalizedKeys.has(normalizedKey(bonus.key)))
    .reduce((total, bonus) => total + bonus.value, 0);
}

function traitBonus(character: CharacterV2, category: string, keys: readonly string[]): number {
  const normalizedCategory = normalizedKey(category);
  const normalizedKeys = new Set(keys.map(normalizedKey));
  return character.traits
    .flatMap((group) => group.traits)
    .map((trait) => trait.adjustment)
    .filter((adjustment) =>
      adjustment !== null &&
      adjustment.applyToDerived &&
      normalizedKey(adjustment.category) === normalizedCategory &&
      (normalizedKey(adjustment.subcategory) === "all" || normalizedKeys.has(normalizedKey(adjustment.subcategory))),
    )
    .reduce((total, adjustment) => total + (adjustment?.value ?? 0), 0);
}

export function projectAdjustedRollMode(
  character: CharacterV2,
  category: string,
  keys: readonly string[],
  authored: RollMode,
): RollMode {
  const normalizedCategory = normalizedKey(category);
  const normalizedKeys = new Set(keys.map(normalizedKey));
  const adjustments = character.traits
    .flatMap((group) => group.traits)
    .map((trait) => trait.adjustment)
    .filter((adjustment) => adjustment !== null &&
      normalizedKey(adjustment.category) === normalizedCategory &&
      (normalizedKey(adjustment.subcategory) === "all" || normalizedKeys.has(normalizedKey(adjustment.subcategory))));
  const itemAdjustments = activeInventoryBonuses(character).filter((bonus) =>
    normalizedKey(bonus.category) === normalizedCategory &&
    (normalizedKey(bonus.key) === "all" || normalizedKeys.has(normalizedKey(bonus.key))));
  const conditionKeys = new Set(character.combat.conditions.map((condition) => normalizedKey(condition.key)));
  const categoryKey = normalizedKey(category);
  const keySet = new Set(keys.map(normalizedKey));
  const attacks = categoryKey === "combatstats";
  const skills = categoryKey === "skills";
  const saves = categoryKey === "saves";
  const strengthRoll = keySet.has("strength") || keySet.has("str");
  const dexterityRoll = keySet.has("dexterity") || keySet.has("dex");
  const conditionalAdvantage =
    (attacks && conditionKeys.has("invisible")) ||
    ((skills || saves) && strengthRoll && conditionKeys.has("raging")) ||
    (saves && dexterityRoll && conditionKeys.has("haste"));
  const conditionalDisadvantage =
    (skills && (character.combat.exhaustion >= 1 || conditionKeys.has("poisoned") || conditionKeys.has("frightened"))) ||
    (saves && character.combat.exhaustion >= 3) ||
    (saves && dexterityRoll && conditionKeys.has("restrained")) ||
    (attacks && (character.combat.exhaustion >= 3 || ["blinded", "frightened", "poisoned", "prone", "restrained"].some((key) => conditionKeys.has(key))));
  const advantage = authored === "advantage" || conditionalAdvantage ||
    adjustments.some((adjustment) => adjustment?.advantage) || itemAdjustments.some((bonus) => bonus.advantage);
  const disadvantage = authored === "disadvantage" || conditionalDisadvantage ||
    adjustments.some((adjustment) => adjustment?.disadvantage) || itemAdjustments.some((bonus) => bonus.disadvantage);
  if (advantage === disadvantage) return "normal";
  return advantage ? "advantage" : "disadvantage";
}

function projectedAbilityModifier(character: CharacterV2, ability: AbilityKey): number {
  const short: Record<AbilityKey, string> = {
    strength: "STR", dexterity: "DEX", constitution: "CON",
    intelligence: "INT", wisdom: "WIS", charisma: "CHA",
  };
  return abilityModifier(
    character.abilities[ability] + traitBonus(character, "attributes", [ability, short[ability]]) +
      inventoryBonus(character, "attributes", [ability, short[ability]]),
  );
}

export interface CharacterStatisticsProjection {
  abilityModifiers: Record<AbilityKey, number>;
  proficiencyBonus: number;
  initiativeModifier: number;
  skills: Record<SkillKey, number>;
  savingThrows: Record<SaveKey, number>;
  passives: {
    perception: number;
    investigation: number;
    insight: number;
  };
}

export function projectCharacterStatistics(
  character: CharacterV2,
): CharacterStatisticsProjection {
  const abilityModifiers = Object.fromEntries(
    Object.entries(character.abilities).map(([ability]) => [
      ability,
      projectedAbilityModifier(character, ability as AbilityKey),
    ]),
  ) as Record<AbilityKey, number>;
  const proficiency = proficiencyBonus(character.identity.level);
  const skills = Object.fromEntries(
    Object.entries(SKILL_DEFINITIONS).map(([key, definition]) => {
      const state = character.checks.skills[key as SkillKey];
      return [
        key,
        Math.floor(
          abilityModifiers[definition.ability] +
            proficiency * state.proficiency +
            state.bonus +
            traitBonus(character, "skills", [key, definition.label]) +
            inventoryBonus(character, "skills", [key, definition.label]),
        ),
      ];
    }),
  ) as Record<SkillKey, number>;
  const savingThrows = Object.fromEntries(
    Object.entries(character.checks.savingThrows).map(([key, state]) => [
      key,
      abilityModifiers[key as SaveKey] + proficiency * state.proficiency + state.bonus +
        traitBonus(character, "saves", [key, key.slice(0, 3)]) +
        inventoryBonus(character, "saves", [key, key.slice(0, 3)]),
    ]),
  ) as Record<SaveKey, number>;

  return {
    abilityModifiers,
    proficiencyBonus: proficiency,
    initiativeModifier:
      abilityModifiers.dexterity + character.checks.initiative.bonus +
        traitBonus(character, "skills", ["Initiative"]) + inventoryBonus(character, "skills", ["Initiative"]),
    skills,
    savingThrows,
    passives: {
      perception:
        10 + skills.perception + character.checks.passiveBonuses.perception +
          traitBonus(character, "senses", ["PassivePerception"]) +
          inventoryBonus(character, "senses", ["PassivePerception"]),
      investigation:
        10 + skills.investigation + character.checks.passiveBonuses.investigation +
          traitBonus(character, "senses", ["PassiveInvestigation"]) +
          inventoryBonus(character, "senses", ["PassiveInvestigation"]),
      insight: 10 + skills.insight + character.checks.passiveBonuses.insight +
        traitBonus(character, "senses", ["PassiveInsight"]) + inventoryBonus(character, "senses", ["PassiveInsight"]),
    },
  };
}

export function projectActionAttackModifier(
  character: CharacterV2,
  action: CharacterActionV2,
): number {
  const ability = action.ability === null
    ? 0
    : projectedAbilityModifier(character, action.ability);
  const proficiency = action.proficient
    ? proficiencyBonus(character.identity.level)
    : 0;
  const ranged = normalizedKey(action.reach).includes("ranged") || normalizedKey(action.weaponType).includes("ranged");
  const keys = ["toHitBonus", "AttackandDamage", ranged ? "RangedAttackRolls" : "MeleeAttackRolls"];
  return ability + proficiency + action.attackBonus + inventoryBonus(character, "combatStats", keys);
}

export function projectActionDamageBonus(character: CharacterV2, action: CharacterActionV2): number {
  const ranged = normalizedKey(action.reach).includes("ranged") || normalizedKey(action.weaponType).includes("ranged");
  return action.damageBonus + inventoryBonus(character, "combatStats", [
    "damageBonus", "AttackandDamage", ranged ? "RangedDamageRolls" : "MeleeDamageRolls",
  ]);
}

export interface InventoryProjection {
  totalWeight: number;
  carryingCapacity: number;
  overCapacity: boolean;
  attuned: number;
  maximumAttuned: number;
  calculatedArmorClass: number;
}

export function projectInventory(character: CharacterV2): InventoryProjection {
  const dexterity = projectedAbilityModifier(character, "dexterity");
  const equippedArmor = character.inventory.find(
    (item) => item.equipped && item.category === "armor" && item.armor !== null,
  );
  const baseArmorClass = equippedArmor?.armor === undefined || equippedArmor.armor === null
    ? 10 + dexterity
    : equippedArmor.armor.base + (
      equippedArmor.armor.dexterityBonus
        ? Math.min(
            dexterity,
            equippedArmor.armor.maximumDexterityBonus ?? dexterity,
          )
        : 0
    );
  const shieldBonus = character.inventory
    .filter((item) => item.equipped && item.category === "shield")
    .reduce((total, item) => total + (item.armor?.base ?? 2), 0);
  const carryWeightBonus = character.inventory
    .filter((item) => item.equipped && (!item.requiresAttunement || item.attuned))
    .flatMap((item) => item.bonuses)
    .filter((bonus) => bonus.category === "combatStats" && bonus.key === "CarryWeightBonus")
    .reduce((total, bonus) => total + bonus.value, 0);
  const totalWeight = character.inventory.reduce(
    (total, item) => total + item.unitWeight * item.quantity,
    0,
  );
  const adjustedStrength = character.abilities.strength + traitBonus(character, "attributes", ["strength", "STR"]);
  const carryingCapacity = adjustedStrength * 15 + carryWeightBonus + traitBonus(character, "combatStats", ["CarryWeightBonus"]);
  return {
    totalWeight,
    carryingCapacity,
    overCapacity: totalWeight > carryingCapacity,
    attuned: character.inventory.filter((item) => item.attuned).length,
    maximumAttuned: 3,
    calculatedArmorClass: baseArmorClass + shieldBonus + traitBonus(character, "combatStats", ["AC"]) +
      inventoryBonus(character, "combatStats", ["AC"]),
  };
}

export interface SpellcastingProjection {
  ability: SpellcastingAbility | null;
  attackModifier: number;
  saveDc: number;
}

function normalizedSpellcastingAbility(value: string | null): SpellcastingAbility | null {
  const normalized = value?.trim().toLowerCase();
  const map: Record<string, SpellcastingAbility> = {
    str: "strength", fue: "strength", strength: "strength",
    dex: "dexterity", des: "dexterity", dexterity: "dexterity",
    con: "constitution", constitution: "constitution",
    int: "intelligence", intelligence: "intelligence",
    wis: "wisdom", sab: "wisdom", wisdom: "wisdom",
    cha: "charisma", car: "charisma", charisma: "charisma",
  };
  return normalized === undefined ? null : map[normalized] ?? null;
}

export function projectSpellcasting(character: CharacterV2): SpellcastingProjection {
  const ability = normalizedSpellcastingAbility(character.spellcasting.ability);
  const modifier = ability === null ? 0 : projectedAbilityModifier(character, ability);
  const activeBonuses = character.inventory
    .filter((item) => item.equipped && (!item.requiresAttunement || item.attuned))
    .flatMap((item) => item.bonuses)
    .filter((bonus) => bonus.category === "combatStats");
  const sharedBonus = activeBonuses
    .filter((bonus) => bonus.key === "SpellAttackandSave")
    .reduce((total, bonus) => total + bonus.value, 0);
  const attackBonus = activeBonuses
    .filter((bonus) => bonus.key === "SpellAttack" || bonus.key === "SpellAttackModifier")
    .reduce((total, bonus) => total + bonus.value, 0);
  const saveBonus = activeBonuses
    .filter((bonus) => bonus.key === "SpellSaveDC")
    .reduce((total, bonus) => total + bonus.value, 0);
  const proficiency = proficiencyBonus(character.identity.level);
  return {
    ability,
    attackModifier: modifier + proficiency + sharedBonus + attackBonus + character.spellcasting.attackBonus +
      traitBonus(character, "combatStats", ["SpellAttack", "SpellAttackModifier", "SpellAttackandSave"]),
    saveDc: 8 + modifier + proficiency + sharedBonus + saveBonus + character.spellcasting.saveDcBonus +
      traitBonus(character, "combatStats", ["SpellSaveDC", "SpellAttackandSave"]),
  };
}

function increaseMatchingDice(base: string, increment: string, times: number): string {
  if (times <= 0) return base;
  const match = increment.trim().match(/^(\d*)d(\d+)$/i);
  if (!match) return base;
  const amount = Number(match[1] || 1) * times;
  const sides = match[2]!;
  let replaced = false;
  const result = base.replace(new RegExp(`(\\d*)d${sides}\\b`, "i"), (_whole, count: string) => {
    replaced = true;
    return `${Number(count || 1) + amount}d${sides}`;
  });
  return replaced ? result : `${base}${base ? "+" : ""}${amount}d${sides}`;
}

export function projectSpellDamageExpression(
  character: CharacterV2,
  spell: CharacterSpellV2,
  slotLevel = spell.level,
): string {
  const definition = spell.definition;
  if (!definition) return "";
  let expression = definition.damageExpression;
  if (spell.level === 0 && definition.upcastDamageExpression) {
    const steps = character.identity.level >= 17
      ? 3
      : character.identity.level >= 11
        ? 2
        : character.identity.level >= 5 ? 1 : 0;
    expression = increaseMatchingDice(expression, definition.upcastDamageExpression, steps);
  } else if (slotLevel > spell.level && definition.upcastDamageExpression) {
    expression = increaseMatchingDice(
      expression,
      definition.upcastDamageExpression,
      slotLevel - spell.level,
    );
  }
  if (definition.addAbilityModifier) {
    const ability = projectSpellcasting(character).ability;
    const modifier = ability === null ? 0 : projectedAbilityModifier(character, ability);
    if (modifier !== 0) expression += modifier > 0 ? `+${modifier}` : String(modifier);
  }
  return expression;
}
