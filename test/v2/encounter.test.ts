import { describe, expect, it } from "vitest";
import { applyEncounterCommand, EncounterRevisionConflictError, isBloodied, orderedCombatants } from "../../src/domain/encounter/encounter";
import { EncounterSchema, type Encounter } from "../../src/domain/encounter/encounter-model";
import { GM_PROTOCOL, GmProtocolMessageSchema, parseGmProtocolMessage } from "../../src/domain/encounter/encounter-protocol";

const now = "2026-08-01T12:00:00.000Z";
const encounterId = "enc_11111111111111111111111111111111";
const heroId = "cmb_22222222222222222222222222222222";
const goblinId = "cmb_33333333333333333333333333333333";
const characterId = "chr_44444444444444444444444444444444";

function fixture(): Encounter {
  return EncounterSchema.parse({
    schemaVersion: 1,
    id: encounterId,
    revision: 0,
    name: "Emboscada",
    round: 1,
    activeCombatantId: heroId,
    combatants: [
      {
        kind: "player",
        id: heroId,
        name: "Heroína",
        initiative: 18,
        order: 0,
        armorClass: 16,
        hitPoints: { current: 20, maximum: 20, temporary: 5 },
        conditions: [],
        visibleToPlayers: true,
        characterId,
        taleSpireClientId: "client-player",
      },
      {
        kind: "monster",
        id: goblinId,
        name: "Goblin",
        initiative: 12,
        order: 1,
        armorClass: 15,
        hitPoints: { current: 3, maximum: 7, temporary: 0 },
        conditions: [],
        visibleToPlayers: false,
        monsterDefinitionId: "goblin",
      },
    ],
    metadata: { createdAt: now, updatedAt: now },
  });
}

describe("encounter domain", () => {
  it("validates stable combatant identity and active turn references", () => {
    const encounter = fixture();
    expect(EncounterSchema.safeParse({ ...encounter, activeCombatantId: "cmb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }).success).toBe(false);
    expect(EncounterSchema.safeParse({ ...encounter, combatants: [...encounter.combatants, encounter.combatants[0]] }).success).toBe(false);
  });

  it("orders rolled initiatives first and uses insertion order to break ties", () => {
    const encounter = fixture();
    encounter.combatants[1]!.initiative = 18;
    expect(orderedCombatants(encounter).map((combatant) => combatant.id)).toEqual([heroId, goblinId]);
    encounter.combatants[0]!.initiative = null;
    expect(orderedCombatants(encounter).map((combatant) => combatant.id)).toEqual([goblinId, heroId]);
  });

  it("advances and reverses rounds while preserving the active combatant by id", () => {
    const advanced = applyEncounterCommand(fixture(), { kind: "advance-turn" }, { expectedRevision: 0, updatedAt: now }).encounter;
    expect(advanced.activeCombatantId).toBe(goblinId);
    const wrapped = applyEncounterCommand(advanced, { kind: "advance-turn" }, { expectedRevision: 1, updatedAt: now }).encounter;
    expect(wrapped).toMatchObject({ round: 2, activeCombatantId: heroId, revision: 2 });
    const reversed = applyEncounterCommand(wrapped, { kind: "previous-turn" }, { expectedRevision: 2, updatedAt: now }).encounter;
    expect(reversed).toMatchObject({ round: 1, activeCombatantId: goblinId });
  });

  it("spends temporary hit points before current hit points", () => {
    const result = applyEncounterCommand(fixture(), { kind: "damage", combatantId: heroId, amount: 8 }, { expectedRevision: 0, updatedAt: now });
    expect(result.encounter.combatants[0]!.hitPoints).toEqual({ current: 17, maximum: 20, temporary: 0 });
    expect(result.effects).toMatchObject({ hitPointsChangedBy: -3, temporaryHitPointsChangedBy: -5 });
  });

  it("derives bloodied and rejects stale commands", () => {
    expect(isBloodied(fixture().combatants[1]!)).toBe(true);
    expect(() => applyEncounterCommand(fixture(), { kind: "advance-turn" }, { expectedRevision: 4, updatedAt: now })).toThrow(EncounterRevisionConflictError);
  });

  it("controls visibility and stable combat conditions", () => {
    const hidden = applyEncounterCommand(
      fixture(),
      { kind: "set-visibility", combatantId: goblinId, visibleToPlayers: false },
      { expectedRevision: 0, updatedAt: now },
    ).encounter;
    const conditionId = "cnd_55555555555555555555555555555555";
    const conditioned = applyEncounterCommand(
      hidden,
      {
        kind: "add-condition",
        combatantId: goblinId,
        condition: { id: conditionId, key: "poisoned", label: "Envenenado", level: null, addedAt: now },
      },
      { expectedRevision: 1, updatedAt: now },
    ).encounter;
    expect(conditioned.combatants[1]).toMatchObject({
      visibleToPlayers: false,
      conditions: [{ id: conditionId, key: "poisoned" }],
    });
    expect(() => applyEncounterCommand(
      conditioned,
      {
        kind: "add-condition",
        combatantId: goblinId,
        condition: { id: "cnd_66666666666666666666666666666666", key: "poisoned", label: "Veneno", level: null, addedAt: now },
      },
      { expectedRevision: 2, updatedAt: now },
    )).toThrow("CONDITION_ALREADY_EXISTS");
    const removed = applyEncounterCommand(
      conditioned,
      { kind: "remove-condition", combatantId: goblinId, conditionId },
      { expectedRevision: 2, updatedAt: now },
    ).encounter;
    expect(removed.combatants[1]?.conditions).toEqual([]);
  });
});

describe("GM collaboration protocol", () => {
  it("accepts a versioned message and rejects malformed or unknown messages", () => {
    const message = {
      protocol: GM_PROTOCOL,
      version: 1,
      messageId: "msg_1111111111111111",
      sentAt: now,
      payload: { type: "player/request-encounter", knownRevision: 3 },
    };
    expect(GmProtocolMessageSchema.parse(message)).toEqual(message);
    expect(parseGmProtocolMessage(JSON.stringify(message))).toEqual(message);
    expect(parseGmProtocolMessage(JSON.stringify({ ...message, version: 99 }))).toBeNull();
    expect(parseGmProtocolMessage("not-json")).toBeNull();
  });
});
