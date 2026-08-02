type AnyRecord = Record<string, any>;

function record(value: unknown): AnyRecord {
  return value !== null && !Array.isArray(value) && typeof value === "object"
    ? value as AnyRecord
    : {};
}

function list(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function stripHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

const abilitySubtypes = [
  "strength-score", "dexterity-score", "constitution-score",
  "intelligence-score", "wisdom-score", "charisma-score",
];

function allModifiers(character: AnyRecord): AnyRecord[] {
  return Object.values(record(character.modifiers)).flatMap((entries) => list(entries));
}

function abilityScore(character: AnyRecord, index: number): number {
  const override = Number(list(character.overrideStats)[index]?.value);
  if (Number.isFinite(override) && list(character.overrideStats)[index]?.value != null) return override;
  const base = Number(list(character.stats)[index]?.value ?? 10);
  const bonus = Number(list(character.bonusStats)[index]?.value ?? 0);
  const matching = allModifiers(character).filter((modifier) => modifier.subType === abilitySubtypes[index]);
  const set = matching.find((modifier) => modifier.type === "set");
  if (set) return Number(set.value ?? set.fixedValue ?? base);
  return base + bonus + matching
    .filter((modifier) => modifier.type === "bonus")
    .reduce((total, modifier) => total + Number(modifier.value ?? modifier.fixedValue ?? 0), 0);
}

function classes(character: AnyRecord): AnyRecord[] {
  return list(character.classes);
}

function totalLevel(character: AnyRecord): number {
  return Math.max(1, classes(character).reduce((total, entry) => total + Number(entry.level ?? 0), 0));
}

function maximumHitPoints(character: AnyRecord): number {
  const constitution = abilityScore(character, 2);
  const modifier = Math.floor((constitution - 10) / 2);
  const level = totalLevel(character);
  const explicit = Number(character.baseHitPoints);
  if (Number.isFinite(explicit) && explicit > 0) return explicit + level * modifier;
  return classes(character).reduce((total, entry, index) => {
    const classLevel = Number(entry.level ?? 0);
    const die = Number(record(entry.definition).hitDice ?? 8);
    if (classLevel < 1) return total;
    const first = index === 0 ? die + modifier : 0;
    const remaining = classLevel - (index === 0 ? 1 : 0);
    return total + first + remaining * (Math.floor(die / 2) + 1 + modifier);
  }, 0);
}

const skillSubtypes = [
  "acrobatics", "animal-handling", "arcana", "athletics", "deception", "history",
  "insight", "intimidation", "investigation", "medicine", "nature", "perception",
  "performance", "persuasion", "religion", "sleight-of-hand", "stealth", "survival",
];
const saveSubtypes = abilitySubtypes.map((ability) => ability.replace("-score", "-saving-throws"));

function proficiencyMap(character: AnyRecord): Record<string, number> {
  const modifiers = allModifiers(character);
  return Object.fromEntries([...skillSubtypes, ...saveSubtypes].map((subtype, index) => {
    const relevant = modifiers.filter((modifier) => modifier.subType === subtype ||
      (index < 18 && modifier.subType === "ability-checks"));
    const rank = relevant.some((modifier) => modifier.type === "expertise")
      ? 2
      : relevant.some((modifier) => modifier.type === "proficiency")
        ? 1
        : relevant.some((modifier) => modifier.type === "half-proficiency") && index < 18
          ? 0.5
          : 0;
    return [`pb-${index + 1}`, index >= 18 ? Math.min(1, rank) : rank];
  }));
}

function categorizedProficiencies(character: AnyRecord): {
  weapons: string[]; armor: string[]; languages: string[]; tools: string[];
} {
  const result = { weapons: [] as string[], armor: [] as string[], languages: [] as string[], tools: [] as string[] };
  for (const modifier of allModifiers(character)) {
    const label = String(modifier.friendlySubtypeName ?? modifier.subType ?? "");
    const subtype = String(modifier.subType ?? "");
    if (modifier.type === "language") result.languages.push(label);
    if (modifier.type !== "proficiency") continue;
    if (/weapon|sword|bow|axe|dagger|mace|spear|hammer|flail|whip|net|sling|dart/i.test(subtype)) result.weapons.push(label);
    else if (/armor|shield/i.test(subtype)) result.armor.push(label);
    else if (/language|common|elvish|dwarvish|draconic|infernal|celestial|sylvan/i.test(subtype)) result.languages.push(label);
    else if (/tool|kit|supplies|instrument|set|vehicles/i.test(subtype)) result.tools.push(label);
  }
  for (const key of Object.keys(result) as (keyof typeof result)[]) result[key] = [...new Set(result[key].filter(Boolean))];
  return result;
}

const slotTable = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1],
  [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

function spellData(character: AnyRecord): AnyRecord {
  const caster = classes(character).find((entry) => record(entry.definition).canCastSpells);
  const ability = ["STR", "DEX", "CON", "INT", "WIS", "CHA"]
    [Number(record(caster?.definition).spellCastingAbilityId ?? 6) - 1] ?? "CHA";
  const result: AnyRecord = { spellcastingModifier: ability, spelllevelselected: "9", Cantrip: { spells: [], slots: [] } };
  const effectiveLevel = classes(character).reduce((total, entry) => {
    const definition = record(entry.definition);
    if (!definition.canCastSpells || definition.name === "Warlock") return total;
    return total + Math.floor(Number(entry.level ?? 0) / Number(record(definition.spellRules).multiClassSpellSlotDivisor ?? 1));
  }, 0);
  const maxima = slotTable[Math.max(0, Math.min(19, effectiveLevel - 1))] ?? [];
  const usedByLevel = new Map<number, number>();
  for (const slot of [...list(character.spellSlots), ...list(character.pactMagic)]) {
    const level = Number(slot.level);
    usedByLevel.set(level, (usedByLevel.get(level) ?? 0) + Number(slot.used ?? 0));
  }
  for (let level = 1; level <= 9; level += 1) {
    const suffix = level === 1 ? "st" : level === 2 ? "nd" : level === 3 ? "rd" : "th";
    const maximum = Number(maxima[level - 1] ?? 0);
    const used = Math.min(maximum, usedByLevel.get(level) ?? 0);
    result[`${level}${suffix}-level`] = { spells: [], slots: Array.from({ length: maximum }, (_, index) => index < used) };
  }
  const collected: AnyRecord[] = [];
  for (const entries of Object.values(record(character.spells))) collected.push(...list(entries));
  for (const classSpell of list(character.classSpells)) collected.push(...list(classSpell.spells));
  for (const spell of collected) {
    const definition = record(spell.definition);
    const level = Number(definition.level ?? spell.level ?? 0);
    const name = String(definition.name ?? spell.name ?? "").trim();
    if (!name || level < 0 || level > 9) continue;
    const key = level === 0 ? "Cantrip" : `${level}${level === 1 ? "st" : level === 2 ? "nd" : level === 3 ? "rd" : "th"}-level`;
    result[key].spells.push({ name, prepared: Boolean(spell.prepared ?? spell.isPrepared) ? "1" : "0" });
  }
  return result;
}

function traitGroups(character: AnyRecord): AnyRecord[] {
  const mapTrait = (entry: AnyRecord): AnyRecord => {
    const definition = record(entry.definition);
    const maximum = Number(record(entry.limitedUse).maxUses ?? entry.numberOfUses ?? 0);
    const used = Number(record(entry.limitedUse).numberUsed ?? 0);
    const resetId = Number(record(entry.limitedUse).resetType ?? entry.resetType);
    return {
      traitName: String(definition.name ?? entry.name ?? "Unnamed Trait"),
      cheveron: true,
      traitDescription: stripHtml(definition.description ?? entry.description),
      checkboxStates: Array.from({ length: Math.max(0, maximum) }, (_, index) => index < used),
      numberOfUses: String(Math.max(0, maximum)),
      adjustmentCategory: "None", adjustmentSubCategory: "", adjustmentAbility: "NONE", adjustmentValue: "0",
      resetType: resetId === 1 ? "short-rest" : resetId === 2 ? "long-rest" : "none",
    };
  };
  const groups: AnyRecord[] = [];
  if (list(character.feats).length) groups.push({ "group-title": "Feats", "group-chevron": false, traits: list(character.feats).map(mapTrait) });
  const racial = list(record(character.race).racialTraits);
  if (racial.length) groups.push({ "group-title": "Racial Traits", "group-chevron": false, traits: racial.map(mapTrait) });
  const features = classes(character).flatMap((entry) => list(entry.classFeatures)
    .filter((feature) => Number(record(feature.definition).requiredLevel ?? 0) <= Number(entry.level ?? 0)));
  if (features.length) groups.push({ "group-title": "Class Traits", "group-chevron": false, traits: features.map(mapTrait) });
  return groups;
}

function inventory(character: AnyRecord): AnyRecord {
  const groups: AnyRecord = { equipment: [], backpack: [], "other-possessions": [], attunement: [] };
  for (const entry of list(character.inventory)) {
    const definition = record(entry.definition);
    const category = String(definition.filterType ?? definition.type ?? "").toLowerCase();
    const item = {
      ...definition,
      name: String(definition.name ?? "Unnamed Item"),
      uniqueId: `ddb-${String(entry.id ?? definition.id ?? definition.name ?? groups.equipment.length)}`,
      quantity: Number(entry.quantity ?? 1),
      weight: Number(definition.weight ?? 0) * Number(entry.quantity ?? 1),
      cost: definition.cost ? `${record(definition.cost).value ?? 0} ${record(definition.cost).denomination ?? "gp"}` : "0 gp",
      equipped: Boolean(entry.equipped), attuned: Boolean(entry.attuned),
      useable: category.includes("potion"),
    };
    const target = Number(entry.containerEntityTypeId) === 1439493548 ? "backpack" : "equipment";
    groups[target].push(item);
  }
  return groups;
}

export function convertDndBeyondCharacter(input: unknown): { characters: Record<string, unknown> } {
  const character = record(record(input).data ?? input);
  const name = String(character.name ?? "D&D Beyond Character").trim() || "D&D Beyond Character";
  const proficiencies = categorizedProficiencies(character);
  const level = totalLevel(character);
  const maximumHp = Math.max(0, maximumHitPoints(character));
  const dexterity = abilityScore(character, 1);
  const primaryDie = Number(record(classes(character)[0]?.definition).hitDice ?? 8);
  const alignments: Record<number, string> = { 1: "LG", 2: "NG", 3: "CG", 4: "LN", 5: "N", 6: "CN", 7: "LE", 8: "NE", 9: "CE" };
  const legacy = {
    characterTempHp: String(character.temporaryHitPoints ?? 0),
    currentHitDice: String(Math.max(0, level - list(character.hitDice).reduce((sum, die) => sum + Number(die.numberUsed ?? 0), 0))),
    insp: character.inspiration ? 1 : 0,
    upcastToggle: 1,
    playerWeaponProficiency: proficiencies.weapons,
    playerArmorProficiency: proficiencies.armor,
    playerLanguageProficiency: proficiencies.languages,
    playerToolsProficiency: proficiencies.tools,
    initiativeButton: String(Math.floor((dexterity - 10) / 2)),
    AC: String(character.armorClass ?? record(character.stats).armorClass ?? 10),
    speed: String(record(character.race).weightSpeeds?.normal?.walk ?? character.speed ?? 30),
    characterLevel: String(level),
    playerXP: String(character.currentXp ?? 0),
    playerClass: classes(character).map((entry) => {
      const definition = record(entry.definition);
      const subclass = record(entry.subclassDefinition).name;
      return `${definition.name ?? ""}${subclass ? ` (${subclass})` : ""}`;
    }).filter(Boolean).join(" / "),
    currentCharacterHP: Math.max(0, maximumHp - Number(character.removedHitPoints ?? 0)),
    maxCharacterHP: maximumHp,
    strengthScore: abilityScore(character, 0), dexterityScore: dexterity,
    constitutionScore: abilityScore(character, 2), intelligenceScore: abilityScore(character, 3),
    wisdomScore: abilityScore(character, 4), charismaScore: abilityScore(character, 5),
    hitDiceButton: `${level}d${primaryDie}`,
    ...proficiencyMap(character),
    conditions: list(record(character.conditions).conditions).map((condition) => ({ text: String(condition.name), value: String(condition.name).toLowerCase() })),
    coins: record(character.currencies), alignment: alignments[Number(character.alignmentId)] ?? "",
    actionTable: [], spellData: spellData(character), inventoryData: inventory(character),
    groupTraitData: traitGroups(character), groupNotesData: [], extrasData: [],
  };
  return { characters: { [name]: legacy } };
}
