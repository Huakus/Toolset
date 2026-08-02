import {
  CharacterV2Schema,
  IsoTimestampSchema,
  StableIdSchema,
  type CharacterV2,
} from "./character-v2";
import { CharacterRevisionConflictError } from "./edit-character";
import {
  CharacterActionV2Schema,
  type CharacterActionV2,
} from "./character-action-model";

export * from "./character-action-model";

export function upsertCharacterAction(
  input: CharacterV2,
  actionInput: CharacterActionV2,
  options: { expectedRevision: number; updatedAt: string },
): CharacterV2 {
  const character = CharacterV2Schema.parse(input);
  const action = CharacterActionV2Schema.parse(actionInput);
  const updatedAt = IsoTimestampSchema.parse(options.updatedAt);
  if (character.revision !== options.expectedRevision) {
    throw new CharacterRevisionConflictError(
      options.expectedRevision,
      character.revision,
    );
  }
  const actions = [
    ...character.actions.filter((existing) => existing.id !== action.id),
    action,
  ].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  return CharacterV2Schema.parse({
    ...character,
    actions,
    revision: character.revision + 1,
    metadata: { ...character.metadata, updatedAt },
  });
}

export function removeCharacterAction(
  input: CharacterV2,
  actionId: string,
  options: { expectedRevision: number; updatedAt: string },
): CharacterV2 {
  const character = CharacterV2Schema.parse(input);
  const id = StableIdSchema.parse(actionId);
  const updatedAt = IsoTimestampSchema.parse(options.updatedAt);
  if (character.revision !== options.expectedRevision) {
    throw new CharacterRevisionConflictError(
      options.expectedRevision,
      character.revision,
    );
  }
  return CharacterV2Schema.parse({
    ...character,
    actions: character.actions.filter((action) => action.id !== id),
    revision: character.revision + 1,
    metadata: { ...character.metadata, updatedAt },
  });
}
