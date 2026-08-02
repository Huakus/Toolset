import { z } from "zod";
import {
  CharacterV2Schema,
  IsoTimestampSchema,
  StableIdSchema,
  type CharacterV2,
} from "./character-v2";
import { CharacterRevisionConflictError } from "./edit-character";
import { resetTraitsByRest } from "./character-content";
import {
  adjustCurrency,
  CurrencyDenominationSchema,
} from "./character-currency";

const PositiveAmountSchema = z.number().int().positive();

export const CharacterResourceCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("damage"), amount: PositiveAmountSchema }),
  z.object({ kind: z.literal("heal"), amount: PositiveAmountSchema }),
  z.object({
    kind: z.literal("grant-temporary-hit-points"),
    amount: PositiveAmountSchema,
  }),
  z.object({
    kind: z.literal("set-death-saves"),
    successes: z.number().int().min(0).max(3),
    failures: z.number().int().min(0).max(3),
  }),
  z.object({ kind: z.literal("toggle-inspiration") }),
  z.object({
    kind: z.literal("set-exhaustion"),
    level: z.number().int().min(0).max(6),
  }),
  z.object({
    kind: z.literal("spend-hit-dice"),
    dice: PositiveAmountSchema,
    healing: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal("long-rest") }),
  z.object({ kind: z.literal("short-rest") }),
  z.object({
    kind: z.literal("adjust-currency"),
    denomination: CurrencyDenominationSchema,
    quantity: z.number().int().refine((value) => value !== 0),
  }),
  z.object({
    kind: z.literal("add-condition"),
    conditionId: StableIdSchema,
    key: z.string().min(1),
    label: z.string().min(1),
    level: z.number().int().positive().nullable(),
    addedAt: IsoTimestampSchema,
  }),
  z.object({
    kind: z.literal("remove-condition"),
    conditionId: StableIdSchema,
  }),
]);

export type CharacterResourceCommand = z.infer<
  typeof CharacterResourceCommandSchema
>;

export class InsufficientHitDiceError extends Error {
  constructor(readonly requested: number, readonly available: number) {
    super(`Cannot spend ${requested} hit dice; only ${available} remain`);
    this.name = "InsufficientHitDiceError";
  }
}

export interface ResourceCommandEffects {
  concentrationCheckDc: number | null;
  hitPointsChangedBy: number;
  temporaryHitPointsChangedBy: number;
  hitDiceRecovered: number;
  deferredResets: ("spell-slots" | "traits")[];
}

export interface ApplyResourceCommandOptions {
  expectedRevision: number;
  updatedAt: string;
}

export interface ResourceCommandResult {
  character: CharacterV2;
  effects: ResourceCommandEffects;
}

export function applyCharacterResourceCommand(
  input: CharacterV2,
  commandInput: CharacterResourceCommand,
  options: ApplyResourceCommandOptions,
): ResourceCommandResult {
  const character = CharacterV2Schema.parse(input);
  const command = CharacterResourceCommandSchema.parse(commandInput);
  const updatedAt = IsoTimestampSchema.parse(options.updatedAt);
  if (character.revision !== options.expectedRevision) {
    throw new CharacterRevisionConflictError(
      options.expectedRevision,
      character.revision,
    );
  }

  const combat = structuredClone(character.combat);
  let inventory = character.inventory;
  let spellcasting = character.spellcasting;
  let traits = character.traits;
  let currency = character.currency;
  const effects: ResourceCommandEffects = {
    concentrationCheckDc: null,
    hitPointsChangedBy: 0,
    temporaryHitPointsChangedBy: 0,
    hitDiceRecovered: 0,
    deferredResets: [],
  };

  switch (command.kind) {
    case "damage": {
      const absorbed = Math.min(combat.hitPoints.temporary, command.amount);
      const remainingDamage = command.amount - absorbed;
      const previousHp = combat.hitPoints.current;
      combat.hitPoints.temporary -= absorbed;
      combat.hitPoints.current = Math.max(0, previousHp - remainingDamage);
      effects.temporaryHitPointsChangedBy = -absorbed;
      effects.hitPointsChangedBy = combat.hitPoints.current - previousHp;
      if (combat.conditions.some((condition) => condition.key === "concentration")) {
        effects.concentrationCheckDc = Math.max(10, Math.ceil(command.amount / 2));
      }
      break;
    }
    case "heal": {
      const previousHp = combat.hitPoints.current;
      combat.hitPoints.current = Math.min(
        combat.hitPoints.maximum,
        previousHp + command.amount,
      );
      effects.hitPointsChangedBy = combat.hitPoints.current - previousHp;
      if (combat.hitPoints.current > 0) {
        combat.deathSaves = { successes: 0, failures: 0 };
      }
      break;
    }
    case "grant-temporary-hit-points": {
      const previous = combat.hitPoints.temporary;
      combat.hitPoints.temporary = Math.max(previous, command.amount);
      effects.temporaryHitPointsChangedBy = combat.hitPoints.temporary - previous;
      break;
    }
    case "set-death-saves":
      combat.deathSaves = {
        successes: command.successes,
        failures: command.failures,
      };
      break;
    case "toggle-inspiration":
      combat.inspiration = !combat.inspiration;
      break;
    case "set-exhaustion":
      combat.exhaustion = command.level;
      break;
    case "spend-hit-dice": {
      if (command.dice > combat.hitDice.remaining) {
        throw new InsufficientHitDiceError(
          command.dice,
          combat.hitDice.remaining,
        );
      }
      combat.hitDice.remaining -= command.dice;
      combat.hitDice.current = String(combat.hitDice.remaining);
      const previousHp = combat.hitPoints.current;
      combat.hitPoints.current = Math.min(
        combat.hitPoints.maximum,
        previousHp + command.healing,
      );
      effects.hitPointsChangedBy = combat.hitPoints.current - previousHp;
      break;
    }
    case "long-rest": {
      const previousHp = combat.hitPoints.current;
      const previousTemporary = combat.hitPoints.temporary;
      const previousDice = combat.hitDice.remaining;
      const recoveredDice = Math.max(Math.floor(combat.hitDice.maximum / 2), 1);
      combat.hitPoints.current = combat.hitPoints.maximum;
      combat.hitPoints.temporary = 0;
      combat.deathSaves = { successes: 0, failures: 0 };
      combat.exhaustion = Math.max(0, combat.exhaustion - 1);
      combat.hitDice.remaining = Math.min(
        combat.hitDice.maximum,
        previousDice + recoveredDice,
      );
      combat.hitDice.current = String(combat.hitDice.remaining);
      effects.hitPointsChangedBy = combat.hitPoints.current - previousHp;
      effects.temporaryHitPointsChangedBy = -previousTemporary;
      effects.hitDiceRecovered = combat.hitDice.remaining - previousDice;
      inventory = character.inventory.map((item) =>
        item.charges !== null && item.charges.reset === "long-rest"
          ? { ...item, charges: { ...item.charges, current: item.charges.maximum } }
          : item,
      );
      spellcasting = {
        ...character.spellcasting,
        slots: Object.fromEntries(
          Object.entries(character.spellcasting.slots).map(([level, state]) => [
            level,
            { ...state, used: 0 },
          ]),
        ),
      };
      traits = resetTraitsByRest(character, "long-rest");
      effects.deferredResets = [];
      break;
    }
    case "short-rest": {
      inventory = character.inventory.map((item) =>
        item.charges !== null && item.charges.reset === "short-rest"
          ? { ...item, charges: { ...item.charges, current: item.charges.maximum } }
          : item,
      );
      traits = resetTraitsByRest(character, "short-rest");
      break;
    }
    case "adjust-currency":
      currency = adjustCurrency(currency, command.denomination, command.quantity);
      break;
    case "add-condition":
      combat.conditions = [
        ...combat.conditions.filter((condition) => condition.key !== command.key),
        {
          id: command.conditionId,
          key: command.key,
          label: command.label,
          level: command.level,
          addedAt: command.addedAt,
        },
      ];
      break;
    case "remove-condition":
      combat.conditions = combat.conditions.filter(
        (condition) => condition.id !== command.conditionId,
      );
      break;
  }

  return {
    character: CharacterV2Schema.parse({
      ...character,
      combat,
      inventory,
      spellcasting,
      traits,
      currency,
      revision: character.revision + 1,
      metadata: { ...character.metadata, updatedAt },
    }),
    effects,
  };
}
