import {
  CharacterV2Schema,
  IsoTimestampSchema,
  StableIdSchema,
  type CharacterV2,
} from "./character-v2";
import { CharacterRevisionConflictError } from "./edit-character";
import {
  CharacterSpellV2Schema,
  SpellLevelSchema,
  SpellSlotStateSchema,
  type CharacterSpellV2,
} from "./character-spell-model";

export * from "./character-spell-model";

export class CharacterSpellNotFoundError extends Error {
  constructor(readonly spellId: string) {
    super(`Character spell ${spellId} was not found`);
    this.name = "CharacterSpellNotFoundError";
  }
}

export class SpellSlotUnavailableError extends Error {
  constructor(readonly level: number) {
    super(`No level ${level} spell slot is available`);
    this.name = "SpellSlotUnavailableError";
  }
}

interface SpellMutationOptions {
  expectedRevision: number;
  updatedAt: string;
}

function prepare(input: CharacterV2, options: SpellMutationOptions): {
  character: CharacterV2;
  updatedAt: string;
} {
  const character = CharacterV2Schema.parse(input);
  const updatedAt = IsoTimestampSchema.parse(options.updatedAt);
  if (character.revision !== options.expectedRevision) {
    throw new CharacterRevisionConflictError(options.expectedRevision, character.revision);
  }
  return { character, updatedAt };
}

function finish(
  character: CharacterV2,
  spellcasting: CharacterV2["spellcasting"],
  updatedAt: string,
  combat = character.combat,
): CharacterV2 {
  return CharacterV2Schema.parse({
    ...character,
    spellcasting,
    combat,
    revision: character.revision + 1,
    metadata: { ...character.metadata, updatedAt },
  });
}

export function upsertCharacterSpell(
  input: CharacterV2,
  spellInput: CharacterSpellV2,
  options: SpellMutationOptions,
): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const spell = CharacterSpellV2Schema.parse(spellInput);
  const spells = [
    ...character.spellcasting.spells.filter((entry) => entry.id !== spell.id),
    spell,
  ].sort((left, right) => left.level - right.level || left.order - right.order || left.name.localeCompare(right.name));
  return finish(character, { ...character.spellcasting, spells }, updatedAt);
}

export function removeCharacterSpell(
  input: CharacterV2,
  spellIdInput: string,
  options: SpellMutationOptions,
): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const spellId = StableIdSchema.parse(spellIdInput);
  if (!character.spellcasting.spells.some((spell) => spell.id === spellId)) {
    throw new CharacterSpellNotFoundError(spellId);
  }
  return finish(character, {
    ...character.spellcasting,
    spells: character.spellcasting.spells.filter((spell) => spell.id !== spellId),
  }, updatedAt);
}

export function setCharacterSpellPrepared(
  input: CharacterV2,
  spellIdInput: string,
  prepared: boolean,
  options: SpellMutationOptions,
): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const spellId = StableIdSchema.parse(spellIdInput);
  if (!character.spellcasting.spells.some((spell) => spell.id === spellId)) {
    throw new CharacterSpellNotFoundError(spellId);
  }
  return finish(character, {
    ...character.spellcasting,
    spells: character.spellcasting.spells.map((spell) =>
      spell.id === spellId ? { ...spell, prepared } : spell,
    ),
  }, updatedAt);
}

export function setCharacterSpellFavorite(
  input: CharacterV2,
  spellNameInput: string,
  favorite: boolean,
  options: SpellMutationOptions,
): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const spellName = spellNameInput.trim();
  if (!spellName) throw new Error("Spell name is required");
  const normalizedName = spellName.toLocaleLowerCase();
  const withoutSpell = character.spellcasting.favoriteSpells.filter(
    (name) => name.toLocaleLowerCase() !== normalizedName,
  );
  const favoriteSpells = favorite
    ? [...withoutSpell, spellName].sort((left, right) => left.localeCompare(right, "es", { sensitivity: "base" }))
    : withoutSpell;
  return finish(character, { ...character.spellcasting, favoriteSpells }, updatedAt);
}

export function setSpellSlots(
  input: CharacterV2,
  levelInput: number,
  slotsInput: { maximum: number; used: number },
  options: SpellMutationOptions,
): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const level = SpellLevelSchema.min(1).parse(levelInput);
  const slots = SpellSlotStateSchema.parse(slotsInput);
  return finish(character, {
    ...character.spellcasting,
    slots: { ...character.spellcasting.slots, [String(level)]: slots },
  }, updatedAt);
}

export function castCharacterSpell(
  input: CharacterV2,
  spellIdInput: string,
  slotLevelInput: number,
  options: SpellMutationOptions & { concentrationCondition?: CharacterV2["combat"]["conditions"][number] },
): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const spellId = StableIdSchema.parse(spellIdInput);
  const spell = character.spellcasting.spells.find((entry) => entry.id === spellId);
  if (!spell) throw new CharacterSpellNotFoundError(spellId);
  const slotLevel = SpellLevelSchema.parse(slotLevelInput);
  if (slotLevel < spell.level) {
    throw new SpellSlotUnavailableError(slotLevel);
  }
  let slots = character.spellcasting.slots;
  if (spell.level > 0) {
    const state = slots[String(slotLevel)] ?? { maximum: 0, used: 0 };
    if (state.used >= state.maximum) throw new SpellSlotUnavailableError(slotLevel);
    slots = { ...slots, [String(slotLevel)]: { ...state, used: state.used + 1 } };
  }
  const combat = options.concentrationCondition && spell.definition?.concentration
    ? {
        ...character.combat,
        conditions: [
          ...character.combat.conditions.filter((condition) => condition.key !== "concentration"),
          options.concentrationCondition,
        ],
      }
    : character.combat;
  return finish(character, { ...character.spellcasting, slots }, updatedAt, combat);
}

export function resetAllSpellSlots(
  input: CharacterV2,
  options: SpellMutationOptions,
): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const slots = Object.fromEntries(
    Object.entries(character.spellcasting.slots).map(([level, state]) => [
      level,
      { ...state, used: 0 },
    ]),
  );
  return finish(character, { ...character.spellcasting, slots }, updatedAt);
}

export function setSpellcastingSettings(
  input: CharacterV2,
  settings: Pick<CharacterV2["spellcasting"], "ability" | "selectedLevel" | "showUpcast" | "attackBonus" | "saveDcBonus">,
  options: SpellMutationOptions,
): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  return finish(character, {
    ...character.spellcasting,
    ...settings,
  }, updatedAt);
}
