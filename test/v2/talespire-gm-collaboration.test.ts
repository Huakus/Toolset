import { describe, expect, it } from "vitest";
import { TaleSpireGmCollaboration } from "../../src/infrastructure/talespire/talespire-gm-collaboration";
import { createGmProtocolMessage } from "../../src/domain/encounter/encounter-protocol";
import { EncounterSchema } from "../../src/domain/encounter/encounter-model";
import { encounterTransferRequest, parseEncounterTransferMessage, serializeEncounterTransferMessage, ENCOUNTER_TRANSFER_PROTOCOL, ENCOUNTER_TRANSFER_VERSION } from "../../src/infrastructure/talespire/encounter-transfer";

function collaborationFixture(sent: { message: string; target: string }[]) {
  return new TaleSpireGmCollaboration({
    sync: {
      send: async (message, target) => { sent.push({ message, target }); },
      getClientsConnected: async () => [{ id: "gm" }, { id: "player-1" }],
    },
    clients: {
      whoAmI: async () => ({ id: "gm" }),
      getClientsInThisBoard: async () => [],
      getMoreInfo: async () => [{ id: "player-1", displayName: "Ana", clientMode: "player" }],
    },
  });
}

describe("TaleSpire GM collaboration", () => {
  it("discovers players and requests summaries with targeted versioned messages", async () => {
    const sent: { message: string; target: string }[] = [];
    const collaboration = collaborationFixture(sent);
    const observed: unknown[] = [];
    collaboration.subscribePlayers((players) => observed.push(players));
    await collaboration.initialize();
    await collaboration.requestCharacterSummaries();
    expect(observed.at(-1)).toEqual([{ id: "player-1", label: "Ana" }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.target).toBe("player-1");
    expect(JSON.parse(sent[0]!.message)).toMatchObject({
      protocol: "talespire-5e-toolset-gm",
      version: 1,
      payload: { type: "gm/request-character-summary" },
    });
  });

  it("receives modern character summaries and legacy initiative updates", async () => {
    const sent: { message: string; target: string }[] = [];
    const collaboration = collaborationFixture(sent);
    await collaboration.initialize();
    const summaries: unknown[] = [];
    const initiatives: unknown[] = [];
    collaboration.subscribeCharacterSummaries((summary) => summaries.push(summary));
    collaboration.subscribeInitiative((clientId, initiative) => initiatives.push({ clientId, initiative }));
    const message = createGmProtocolMessage({
      type: "player/character-summary",
      requestId: null,
      summary: {
        characterId: "chr_11111111111111111111111111111111",
        name: "Heroína",
        currentHitPoints: 12,
        maximumHitPoints: 20,
        temporaryHitPoints: 3,
        armorClass: 16,
        passivePerception: 14,
        spellSaveDc: 13,
        conditionKeys: ["bless"],
      },
    });
    await collaboration.handleSyncEvent({ payload: { fromClient: { id: "player-1" }, str: JSON.stringify(message) } });
    await collaboration.handleSyncEvent({ payload: { fromClient: { id: "player-1" }, str: JSON.stringify({ type: "update-init", data: { Initiative: 17 } }) } });
    expect(summaries).toEqual([expect.objectContaining({ clientId: "player-1", summary: expect.objectContaining({ name: "Heroína" }) })]);
    expect(initiatives).toEqual([{ clientId: "player-1", initiative: 17 }]);
  });

  it("publishes the initiative view and a checksummed change notification", async () => {
    const sent: { message: string; target: string }[] = [];
    const collaboration = collaborationFixture(sent);
    await collaboration.initialize();
    sent.length = 0;
    const encounter = EncounterSchema.parse({
      schemaVersion: 1,
      id: "enc_11111111111111111111111111111111",
      revision: 2,
      name: "Prueba",
      round: 3,
      activeCombatantId: "cmb_22222222222222222222222222222222",
      combatants: [{
        kind: "player",
        id: "cmb_22222222222222222222222222222222",
        name: "Heroína",
        initiative: 17,
        order: 0,
        armorClass: 16,
        hitPoints: { current: 12, maximum: 20, temporary: 0 },
        conditions: [],
        visibleToPlayers: true,
        characterId: "chr_11111111111111111111111111111111",
        taleSpireClientId: "player-1",
      }],
      metadata: { createdAt: "2026-08-01T12:00:00.000Z", updatedAt: "2026-08-01T12:01:00.000Z" },
    });
    await collaboration.publishEncounter(encounter);
    expect(sent).toHaveLength(4);
    expect(sent.every((entry) => entry.target === "board")).toBe(true);
    expect(sent.map((entry) => JSON.parse(entry.message).type)).toContain("player-init-list");
    expect(sent.map((entry) => JSON.parse(entry.message).payload?.type)).toContain("gm/encounter-changed");
  });

  it("retries a rejected snapshot and records its acknowledgement", async () => {
    const sent: { message: string; target: string }[] = [];
    const collaboration = collaborationFixture(sent);
    await collaboration.initialize();
    const encounter = EncounterSchema.parse({
      schemaVersion: 1,
      id: "enc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      revision: 1,
      name: "Sincronización",
      round: 1,
      activeCombatantId: null,
      combatants: [],
      metadata: { createdAt: "2026-08-01T12:00:00.000Z", updatedAt: "2026-08-01T12:00:00.000Z" },
    });
    await collaboration.publishEncounter(encounter);
    sent.length = 0;
    const statuses: unknown[] = [];
    collaboration.subscribeTransferStatus((status) => statuses.push(status));
    await collaboration.handleSyncEvent({ payload: {
      fromClient: { id: "player-1" },
      str: encounterTransferRequest(encounter.id, null, null),
    } });
    expect(sent.length).toBeGreaterThanOrEqual(3);
    expect(sent.every((entry) => entry.target === "player-1")).toBe(true);
    const start = parseEncounterTransferMessage(sent[0]!.message);
    expect(start?.t).toBe("start");
    if (!start || start.t !== "start") throw new Error("missing transfer start");
    const firstTransferMessageCount = sent.length;
    await collaboration.handleSyncEvent({ payload: {
      fromClient: { id: "player-1" },
      str: serializeEncounterTransferMessage({
        p: ENCOUNTER_TRANSFER_PROTOCOL, v: ENCOUNTER_TRANSFER_VERSION,
        t: "reject", x: start.x, reason: "Falta un fragmento",
      }),
    } });
    const retryStart = parseEncounterTransferMessage(sent[firstTransferMessageCount]!.message);
    expect(retryStart?.t).toBe("start");
    if (!retryStart || retryStart.t !== "start") throw new Error("missing retry start");
    await collaboration.handleSyncEvent({ payload: {
      fromClient: { id: "player-1" },
      str: serializeEncounterTransferMessage({
        p: ENCOUNTER_TRANSFER_PROTOCOL, v: ENCOUNTER_TRANSFER_VERSION,
        t: "ack", x: retryStart.x, e: retryStart.e, r: retryStart.r, c: retryStart.c,
      }),
    } });
    expect(statuses).toContainEqual(expect.objectContaining({ clientId: "player-1", attempt: 2, status: "retrying" }));
    expect(statuses.at(-1)).toMatchObject({ clientId: "player-1", transferId: retryStart.x, attempt: 2, status: "confirmed" });
  });
});
