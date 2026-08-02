import type { Encounter, EncounterCombatant, EncounterCondition } from "./encounter-model";

export class EncounterRevisionConflictError extends Error {
  constructor(expected: number, actual: number) {
    super(`ENCOUNTER_REVISION_CONFLICT:${expected}:${actual}`);
    this.name = "EncounterRevisionConflictError";
  }
}

export interface EncounterCommandOptions {
  expectedRevision: number;
  updatedAt: string;
}

export type EncounterCommand =
  | { kind: "add-combatant"; combatant: EncounterCombatant }
  | { kind: "remove-combatant"; combatantId: string }
  | { kind: "advance-turn" }
  | { kind: "previous-turn" }
  | { kind: "set-active-combatant"; combatantId: string }
  | { kind: "set-initiative"; combatantId: string; initiative: number | null }
  | { kind: "set-visibility"; combatantId: string; visibleToPlayers: boolean }
  | { kind: "add-condition"; combatantId: string; condition: EncounterCondition }
  | { kind: "remove-condition"; combatantId: string; conditionId: string }
  | {
      kind: "update-combatant-stats";
      combatantId: string;
      name: string;
      armorClass: number;
      hitPoints: EncounterCombatant["hitPoints"];
      conditions: EncounterCombatant["conditions"];
    }
  | { kind: "damage"; combatantId: string; amount: number }
  | { kind: "heal"; combatantId: string; amount: number }
  | { kind: "grant-temporary-hit-points"; combatantId: string; amount: number };

export interface EncounterCommandResult {
  encounter: Encounter;
  effects: {
    roundChangedBy: number;
    hitPointsChangedBy: number;
    temporaryHitPointsChangedBy: number;
  };
}

export function orderedCombatants(encounter: Encounter): EncounterCombatant[] {
  return [...encounter.combatants].sort((left, right) => {
    if (left.initiative === null && right.initiative !== null) return 1;
    if (left.initiative !== null && right.initiative === null) return -1;
    if (left.initiative !== right.initiative) return (right.initiative ?? 0) - (left.initiative ?? 0);
    return left.order - right.order;
  });
}

export function isBloodied(combatant: EncounterCombatant): boolean {
  return combatant.hitPoints.maximum > 0
    && combatant.hitPoints.current > 0
    && combatant.hitPoints.current <= Math.floor(combatant.hitPoints.maximum / 2);
}

export function applyEncounterCommand(
  source: Encounter,
  command: EncounterCommand,
  options: EncounterCommandOptions,
): EncounterCommandResult {
  if (source.revision !== options.expectedRevision) {
    throw new EncounterRevisionConflictError(options.expectedRevision, source.revision);
  }
  const encounter = structuredClone(source);
  const effects = {
    roundChangedBy: 0,
    hitPointsChangedBy: 0,
    temporaryHitPointsChangedBy: 0,
  };

  if (command.kind === "add-combatant") {
    if (encounter.combatants.some((combatant) => combatant.id === command.combatant.id)) {
      throw new Error(`COMBATANT_ALREADY_EXISTS:${command.combatant.id}`);
    }
    encounter.combatants.push(structuredClone(command.combatant));
  } else if (command.kind === "remove-combatant") {
    requireCombatant(encounter, command.combatantId);
    encounter.combatants = encounter.combatants.filter((combatant) => combatant.id !== command.combatantId);
    if (encounter.activeCombatantId === command.combatantId) encounter.activeCombatantId = null;
  } else if (command.kind === "advance-turn" || command.kind === "previous-turn") {
    moveTurn(encounter, command.kind === "advance-turn" ? 1 : -1, effects);
  } else if (command.kind === "set-active-combatant") {
    requireCombatant(encounter, command.combatantId);
    encounter.activeCombatantId = command.combatantId;
  } else {
    const combatant = requireCombatant(encounter, command.combatantId);
    if (command.kind === "set-initiative") {
      if (command.initiative !== null && !Number.isSafeInteger(command.initiative)) {
        throw new Error("INVALID_INITIATIVE");
      }
      combatant.initiative = command.initiative;
    } else if (command.kind === "set-visibility") {
      combatant.visibleToPlayers = command.visibleToPlayers;
    } else if (command.kind === "add-condition") {
      if (combatant.conditions.some((condition) => condition.key === command.condition.key)) {
        throw new Error(`CONDITION_ALREADY_EXISTS:${command.condition.key}`);
      }
      combatant.conditions.push(structuredClone(command.condition));
    } else if (command.kind === "remove-condition") {
      if (!combatant.conditions.some((condition) => condition.id === command.conditionId)) {
        throw new Error(`CONDITION_NOT_FOUND:${command.conditionId}`);
      }
      combatant.conditions = combatant.conditions.filter((condition) => condition.id !== command.conditionId);
    } else if (command.kind === "update-combatant-stats") {
      combatant.name = command.name;
      combatant.armorClass = command.armorClass;
      combatant.hitPoints = structuredClone(command.hitPoints);
      combatant.conditions = structuredClone(command.conditions);
    } else {
      applyHitPointCommand(combatant, command, effects);
    }
  }

  encounter.revision += 1;
  encounter.metadata.updatedAt = options.updatedAt;
  return { encounter, effects };
}

function requireCombatant(encounter: Encounter, combatantId: string): EncounterCombatant {
  const combatant = encounter.combatants.find((candidate) => candidate.id === combatantId);
  if (!combatant) throw new Error(`COMBATANT_NOT_FOUND:${combatantId}`);
  return combatant;
}

function moveTurn(
  encounter: Encounter,
  direction: 1 | -1,
  effects: EncounterCommandResult["effects"],
): void {
  const ordered = orderedCombatants(encounter);
  if (!ordered.length) {
    encounter.activeCombatantId = null;
    return;
  }
  const currentIndex = ordered.findIndex((combatant) => combatant.id === encounter.activeCombatantId);
  if (currentIndex < 0) {
    encounter.activeCombatantId = ordered[direction === 1 ? 0 : ordered.length - 1]!.id;
    return;
  }
  let nextIndex = currentIndex + direction;
  if (nextIndex >= ordered.length) {
    nextIndex = 0;
    encounter.round += 1;
    effects.roundChangedBy = 1;
  } else if (nextIndex < 0) {
    nextIndex = ordered.length - 1;
    if (encounter.round > 1) {
      encounter.round -= 1;
      effects.roundChangedBy = -1;
    }
  }
  encounter.activeCombatantId = ordered[nextIndex]!.id;
}

function applyHitPointCommand(
  combatant: EncounterCombatant,
  command: Extract<EncounterCommand, { kind: "damage" | "heal" | "grant-temporary-hit-points" }>,
  effects: EncounterCommandResult["effects"],
): void {
  if (!Number.isSafeInteger(command.amount) || command.amount < 0) throw new Error("INVALID_HIT_POINT_AMOUNT");
  const beforeCurrent = combatant.hitPoints.current;
  const beforeTemporary = combatant.hitPoints.temporary;
  if (command.kind === "damage") {
    const absorbed = Math.min(combatant.hitPoints.temporary, command.amount);
    combatant.hitPoints.temporary -= absorbed;
    combatant.hitPoints.current = Math.max(0, combatant.hitPoints.current - (command.amount - absorbed));
  } else if (command.kind === "heal") {
    combatant.hitPoints.current = Math.min(
      combatant.hitPoints.maximum,
      combatant.hitPoints.current + command.amount,
    );
  } else {
    combatant.hitPoints.temporary = Math.max(combatant.hitPoints.temporary, command.amount);
  }
  effects.hitPointsChangedBy = combatant.hitPoints.current - beforeCurrent;
  effects.temporaryHitPointsChangedBy = combatant.hitPoints.temporary - beforeTemporary;
}
