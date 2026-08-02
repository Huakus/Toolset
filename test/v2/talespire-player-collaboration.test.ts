import { describe, expect, it } from "vitest";
import { TaleSpirePlayerCollaboration } from "../../src/infrastructure/talespire/talespire-player-collaboration";
import { createGmProtocolMessage } from "../../src/domain/encounter/encounter-protocol";
import { EncounterSchema } from "../../src/domain/encounter/encounter-model";
import { buildEncounterTransfer } from "../../src/infrastructure/talespire/encounter-transfer";

describe("TaleSpire player collaboration", () => {
  it("notifies the sheet when the GM requests a modern character summary", async () => {
    const collaboration = new TaleSpirePlayerCollaboration({
      sync: { send: async () => undefined },
      clients: {
        whoAmI: async () => ({ id: "player" }),
        getClientsInThisBoard: async () => [{ id: "player" }, { id: "gm" }],
        getMoreInfo: async () => [{ id: "gm", clientMode: "gm" }],
      },
    });
    await collaboration.initialize();
    const requests: unknown[] = [];
    collaboration.subscribeCharacterSummaryRequests((request) => requests.push(request));
    const message = createGmProtocolMessage({ type: "gm/request-character-summary", requestId: "msg_1111111111111111" });
    await collaboration.handleSyncEvent({ payload: { fromClient: { id: "gm" }, str: JSON.stringify(message) } });
    expect(requests).toEqual([{ kind: "modern", requestId: "msg_1111111111111111" }]);
  });

  it("requests, validates and acknowledges a changed encounter snapshot", async () => {
    const sent: { message: string; target: string }[] = [];
    const collaboration = new TaleSpirePlayerCollaboration({
      sync: { send: async (message, target) => { sent.push({ message, target }); } },
      clients: {
        whoAmI: async () => ({ id: "player" }),
        getClientsInThisBoard: async () => [{ id: "player" }, { id: "gm" }],
        getMoreInfo: async () => [{ id: "gm", clientMode: "gm" }],
      },
    });
    await collaboration.initialize();
    const encounter = EncounterSchema.parse({
      schemaVersion: 1,
      id: "enc_11111111111111111111111111111111",
      revision: 4,
      name: "Oculto para jugadores",
      round: 2,
      activeCombatantId: "cmb_22222222222222222222222222222222",
      combatants: [{
        kind: "monster",
        id: "cmb_22222222222222222222222222222222",
        name: "Dragón secreto",
        initiative: 18,
        order: 0,
        armorClass: 20,
        hitPoints: { current: 100, maximum: 200, temporary: 0 },
        conditions: [],
        visibleToPlayers: true,
        monsterDefinitionId: "dragon",
      }],
      metadata: { createdAt: "2026-08-01T12:00:00.000Z", updatedAt: "2026-08-01T12:01:00.000Z" },
    });
    const transfer = await buildEncounterTransfer(encounter);
    const syncStates: unknown[] = [];
    const initiatives: unknown[] = [];
    collaboration.subscribeEncounterSync((state) => syncStates.push(state));
    collaboration.subscribe((state) => initiatives.push(state));
    const changed = createGmProtocolMessage({
      type: "gm/encounter-changed",
      encounterId: encounter.id,
      revision: encounter.revision,
      checksum: transfer.checksum,
    });
    await collaboration.handleSyncEvent({ payload: { fromClient: { id: "gm" }, str: JSON.stringify(changed) } });
    expect(JSON.parse(sent[0]!.message)).toMatchObject({ t: "req", e: encounter.id, r: null, c: null });
    for (const message of transfer.messages) {
      await collaboration.handleSyncEvent({ payload: { fromClient: { id: "gm" }, str: message } });
    }
    expect(syncStates.at(-1)).toMatchObject({ status: "synchronized", revision: 4, checksum: transfer.checksum });
    expect(initiatives.at(-1)).toMatchObject({ round: 2, activeTurn: 0, entries: [{ name: "", player: false, visible: true, bloodied: true }] });
    expect(JSON.parse(sent.at(-1)!.message)).toMatchObject({ t: "ack", e: encounter.id, r: 4, c: transfer.checksum });
  });

  it("discovers the GM, sends legacy-compatible requests and receives initiative state", async () => {
    const sent: { message: string; target: string }[] = [];
    const collaboration = new TaleSpirePlayerCollaboration({
      sync: { send: async (message, target) => { sent.push({ message, target }); } },
      clients: {
        whoAmI: async () => ({ id: "player" }),
        getClientsInThisBoard: async () => [{ id: "player" }, { id: "gm" }],
        getMoreInfo: async () => [{ id: "gm", clientMode: "gm" }],
      },
    });
    await collaboration.initialize();
    await collaboration.requestInitiativeList();
    expect(sent[0]?.target).toBe("gm");
    expect(JSON.parse(sent[0]!.message)).toMatchObject({
      type: "request-init-list",
      playerId: { id: "player" },
    });

    const observed: unknown[] = [];
    collaboration.subscribe((state) => observed.push(state));
    await collaboration.handleSyncEvent({
      payload: {
        fromClient: { id: "gm" },
        str: JSON.stringify({ type: "player-init-list", data: [{ n: "Hero", p: 1, v: 1, b: 0 }] }),
      },
    });
    await collaboration.handleSyncEvent({
      payload: { fromClient: { id: "gm" }, str: JSON.stringify({ type: "player-init-round", data: 3 }) },
    });
    expect(observed.at(-1)).toMatchObject({ round: 3, entries: [{ name: "Hero", player: true }] });
  });

  it("discovers peers and confirms the exact payload size with a targeted acknowledgement", async () => {
    const sent: { message: string; target: string }[] = [];
    const collaboration = new TaleSpirePlayerCollaboration({
      sync: {
        send: async (message, target) => { sent.push({ message, target }); },
        getClientsConnected: async () => [{ id: "local" }, { id: "remote" }],
      },
      clients: {
        whoAmI: async () => ({ id: "local" }),
        getClientsInThisBoard: async () => { throw new Error("Debe preferir los clientes conectados al sync."); },
        getMoreInfo: async () => [{ id: "remote", name: "Ana", clientMode: "player" }],
      },
    });
    const observed: unknown[] = [];
    collaboration.subscribeTransportDiagnostics((state) => observed.push(state));
    await collaboration.initialize();
    await collaboration.runTransportProbe(500);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.target).toBe("remote");
    expect(sent[0]!.message).toHaveLength(500);
    const outbound = JSON.parse(sent[0]!.message);
    await collaboration.handleSyncEvent({
      payload: {
        fromClient: { id: "remote" },
        str: JSON.stringify({
          type: "toolset-sync-probe-ack",
          protocol: "talespire-5e-toolset-sync",
          version: 2,
          data: { probeId: outbound.data.probeId, receivedCharacters: 500 },
        }),
      },
    });

    expect(observed.at(-1)).toMatchObject({
      ownClientId: "local",
      peers: [{ id: "remote", label: "Ana", clientMode: "player" }],
      probes: [{
        probeId: outbound.data.probeId,
        targetClientId: "remote",
        requestedCharacters: 500,
        sentCharacters: 500,
        receivedCharacters: 500,
        status: "received",
      }],
    });
  });

  it("answers a valid incoming probe only to its sender", async () => {
    const sent: { message: string; target: string }[] = [];
    const collaboration = new TaleSpirePlayerCollaboration({
      sync: { send: async (message, target) => { sent.push({ message, target }); } },
      clients: {
        whoAmI: async () => ({ id: "local" }),
        getClientsInThisBoard: async () => [{ id: "local" }, { id: "remote" }],
        getMoreInfo: async () => [{ id: "remote", clientMode: "player" }],
      },
    });
    await collaboration.initialize();
    const incoming = JSON.stringify({
      type: "toolset-sync-probe",
      protocol: "talespire-5e-toolset-sync",
      version: 2,
      data: { probeId: "probe_remote", requestedCharacters: 480, sentAt: new Date().toISOString(), padding: "x" },
    });
    await collaboration.handleSyncEvent({ payload: { fromClient: { id: "remote" }, str: incoming } });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.target).toBe("remote");
    expect(JSON.parse(sent[0]!.message)).toMatchObject({
      type: "toolset-sync-probe-ack",
      protocol: "talespire-5e-toolset-sync",
      version: 2,
      data: {
        probeId: "probe_remote",
        receivedCharacters: incoming.length,
      },
    });
  });
});
