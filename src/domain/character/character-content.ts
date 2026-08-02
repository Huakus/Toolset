import {
  CharacterV2Schema,
  IsoTimestampSchema,
  StableIdSchema,
  type CharacterV2,
} from "./character-v2";
import { CharacterRevisionConflictError } from "./edit-character";
import {
  CharacterExtraV2Schema,
  CharacterNoteGroupV2Schema,
  CharacterNoteV2Schema,
  CharacterTraitGroupV2Schema,
  CharacterTraitV2Schema,
  type CharacterExtraV2,
  type CharacterNoteGroupV2,
  type CharacterNoteV2,
  type CharacterTraitGroupV2,
  type CharacterTraitV2,
} from "./character-content-model";

export * from "./character-content-model";

export class CharacterContentNotFoundError extends Error {
  constructor(readonly kind: string, readonly id: string) {
    super(`${kind} ${id} was not found`);
    this.name = "CharacterContentNotFoundError";
  }
}

interface MutationOptions { expectedRevision: number; updatedAt: string }

function prepare(input: CharacterV2, options: MutationOptions): { character: CharacterV2; updatedAt: string } {
  const character = CharacterV2Schema.parse(input);
  const updatedAt = IsoTimestampSchema.parse(options.updatedAt);
  if (character.revision !== options.expectedRevision) {
    throw new CharacterRevisionConflictError(options.expectedRevision, character.revision);
  }
  return { character, updatedAt };
}

function finish(character: CharacterV2, patch: Partial<Pick<CharacterV2, "traits" | "notes" | "extras">>, updatedAt: string): CharacterV2 {
  return CharacterV2Schema.parse({
    ...character,
    ...patch,
    revision: character.revision + 1,
    metadata: { ...character.metadata, updatedAt },
  });
}

export function upsertTraitGroup(input: CharacterV2, groupInput: CharacterTraitGroupV2, options: MutationOptions): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const group = CharacterTraitGroupV2Schema.parse(groupInput);
  const traits = [...character.traits.filter((entry) => entry.id !== group.id), group]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return finish(character, { traits }, updatedAt);
}

export function removeTraitGroup(input: CharacterV2, groupIdInput: string, options: MutationOptions): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const groupId = StableIdSchema.parse(groupIdInput);
  if (!character.traits.some((group) => group.id === groupId)) throw new CharacterContentNotFoundError("Trait group", groupId);
  return finish(character, { traits: character.traits.filter((group) => group.id !== groupId) }, updatedAt);
}

export function upsertTrait(input: CharacterV2, groupIdInput: string, traitInput: CharacterTraitV2, options: MutationOptions): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const groupId = StableIdSchema.parse(groupIdInput);
  const trait = CharacterTraitV2Schema.parse(traitInput);
  let found = false;
  const traits = character.traits.map((group) => {
    if (group.id !== groupId) return group;
    found = true;
    return {
      ...group,
      traits: [...group.traits.filter((entry) => entry.id !== trait.id), trait]
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    };
  });
  if (!found) throw new CharacterContentNotFoundError("Trait group", groupId);
  return finish(character, { traits }, updatedAt);
}

export function removeTrait(input: CharacterV2, groupIdInput: string, traitIdInput: string, options: MutationOptions): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const groupId = StableIdSchema.parse(groupIdInput);
  const traitId = StableIdSchema.parse(traitIdInput);
  const group = character.traits.find((entry) => entry.id === groupId);
  if (!group?.traits.some((trait) => trait.id === traitId)) throw new CharacterContentNotFoundError("Trait", traitId);
  return finish(character, {
    traits: character.traits.map((entry) => entry.id === groupId
      ? { ...entry, traits: entry.traits.filter((trait) => trait.id !== traitId) }
      : entry),
  }, updatedAt);
}

export function setTraitUsed(input: CharacterV2, groupIdInput: string, traitIdInput: string, used: number, options: MutationOptions): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const groupId = StableIdSchema.parse(groupIdInput);
  const traitId = StableIdSchema.parse(traitIdInput);
  let found = false;
  const traits = character.traits.map((group) => group.id !== groupId ? group : {
    ...group,
    traits: group.traits.map((trait) => {
      if (trait.id !== traitId) return trait;
      found = true;
      return CharacterTraitV2Schema.parse({ ...trait, uses: { ...trait.uses, used } });
    }),
  });
  if (!found) throw new CharacterContentNotFoundError("Trait", traitId);
  return finish(character, { traits }, updatedAt);
}

export function resetTraitsByRest(character: CharacterV2, reset: "short-rest" | "long-rest"): CharacterV2["traits"] {
  return character.traits.map((group) => ({
    ...group,
    traits: group.traits.map((trait) => trait.uses.reset === reset
      ? { ...trait, uses: { ...trait.uses, used: 0 } }
      : trait),
  }));
}

export function upsertNoteGroup(input: CharacterV2, groupInput: CharacterNoteGroupV2, options: MutationOptions): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const group = CharacterNoteGroupV2Schema.parse(groupInput);
  return finish(character, {
    notes: [...character.notes.filter((entry) => entry.id !== group.id), group]
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
  }, updatedAt);
}

export function removeNoteGroup(input: CharacterV2, groupIdInput: string, options: MutationOptions): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const groupId = StableIdSchema.parse(groupIdInput);
  if (!character.notes.some((group) => group.id === groupId)) throw new CharacterContentNotFoundError("Note group", groupId);
  return finish(character, { notes: character.notes.filter((group) => group.id !== groupId) }, updatedAt);
}

export function upsertNote(input: CharacterV2, groupIdInput: string, noteInput: CharacterNoteV2, options: MutationOptions): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const groupId = StableIdSchema.parse(groupIdInput);
  const note = CharacterNoteV2Schema.parse(noteInput);
  let found = false;
  const notes = character.notes.map((group) => {
    if (group.id !== groupId) return group;
    found = true;
    return { ...group, notes: [...group.notes.filter((entry) => entry.id !== note.id), note]
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)) };
  });
  if (!found) throw new CharacterContentNotFoundError("Note group", groupId);
  return finish(character, { notes }, updatedAt);
}

export function removeNote(input: CharacterV2, groupIdInput: string, noteIdInput: string, options: MutationOptions): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const groupId = StableIdSchema.parse(groupIdInput);
  const noteId = StableIdSchema.parse(noteIdInput);
  const group = character.notes.find((entry) => entry.id === groupId);
  if (!group?.notes.some((note) => note.id === noteId)) throw new CharacterContentNotFoundError("Note", noteId);
  return finish(character, { notes: character.notes.map((entry) => entry.id === groupId
    ? { ...entry, notes: entry.notes.filter((note) => note.id !== noteId) }
    : entry) }, updatedAt);
}

export function upsertExtra(input: CharacterV2, extraInput: CharacterExtraV2, options: MutationOptions): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const extra = CharacterExtraV2Schema.parse(extraInput);
  return finish(character, { extras: [...character.extras.filter((entry) => entry.id !== extra.id), extra]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)) }, updatedAt);
}

export function removeExtra(input: CharacterV2, extraIdInput: string, options: MutationOptions): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const extraId = StableIdSchema.parse(extraIdInput);
  if (!character.extras.some((extra) => extra.id === extraId)) throw new CharacterContentNotFoundError("Extra", extraId);
  return finish(character, { extras: character.extras.filter((extra) => extra.id !== extraId) }, updatedAt);
}

export function applyExtraHitPoints(input: CharacterV2, extraIdInput: string, action: { kind: "damage" | "heal" | "temporary"; amount: number }, options: MutationOptions): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const extraId = StableIdSchema.parse(extraIdInput);
  let found = false;
  const extras = character.extras.map((extra) => {
    if (extra.id !== extraId) return extra;
    found = true;
    const hitPoints = { ...extra.hitPoints };
    if (action.kind === "damage") {
      let damage = Math.max(0, Math.trunc(action.amount));
      const absorbed = Math.min(hitPoints.temporary, damage);
      hitPoints.temporary -= absorbed;
      damage -= absorbed;
      hitPoints.current = Math.max(0, hitPoints.current - damage);
    } else if (action.kind === "heal") {
      hitPoints.current = Math.min(hitPoints.maximum, hitPoints.current + Math.max(0, Math.trunc(action.amount)));
    } else {
      hitPoints.temporary = Math.max(hitPoints.temporary, Math.max(0, Math.trunc(action.amount)));
    }
    return { ...extra, hitPoints };
  });
  if (!found) throw new CharacterContentNotFoundError("Extra", extraId);
  return finish(character, { extras }, updatedAt);
}

export function addExtraCondition(
  input: CharacterV2,
  extraIdInput: string,
  condition: CharacterV2["extras"][number]["conditions"][number],
  options: MutationOptions,
): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const extraId = StableIdSchema.parse(extraIdInput);
  let found = false;
  const extras = character.extras.map((extra) => {
    if (extra.id !== extraId) return extra;
    found = true;
    return {
      ...extra,
      conditions: [
        ...extra.conditions.filter((entry) => entry.key !== condition.key),
        condition,
      ],
    };
  });
  if (!found) throw new CharacterContentNotFoundError("Extra", extraId);
  return finish(character, { extras }, updatedAt);
}

export function removeExtraCondition(
  input: CharacterV2,
  extraIdInput: string,
  conditionIdInput: string,
  options: MutationOptions,
): CharacterV2 {
  const { character, updatedAt } = prepare(input, options);
  const extraId = StableIdSchema.parse(extraIdInput);
  const conditionId = StableIdSchema.parse(conditionIdInput);
  const extra = character.extras.find((entry) => entry.id === extraId);
  if (!extra?.conditions.some((condition) => condition.id === conditionId)) {
    throw new CharacterContentNotFoundError("Extra condition", conditionId);
  }
  return finish(character, {
    extras: character.extras.map((entry) => entry.id === extraId
      ? { ...entry, conditions: entry.conditions.filter((condition) => condition.id !== conditionId) }
      : entry),
  }, updatedAt);
}
