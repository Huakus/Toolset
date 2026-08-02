import { describe, expect, it } from "vitest";
import { EncounterSchema, type Encounter } from "../../src/domain/encounter/encounter-model";
import {
  buildEncounterTransfer,
  EncounterTransferAssembler,
  parseEncounterTransferMessage,
  projectPublicEncounter,
  TALESPIRE_MESSAGE_CHARACTER_LIMIT,
} from "../../src/infrastructure/talespire/encounter-transfer";

function encounterFixture(count = 24): Encounter {
  return EncounterSchema.parse({
    schemaVersion: 1,
    id: "enc_11111111111111111111111111111111",
    revision: 7,
    name: "Encuentro grande",
    round: 4,
    activeCombatantId: "cmb_00000000000000000000000000000000",
    combatants: Array.from({ length: count }, (_, index) => ({
      kind: index % 2 ? "monster" : "player",
      id: `cmb_${index.toString(16).padStart(32, "0")}`,
      name: index % 2 ? `Monstruo secreto ${index}` : `Jugador con nombre único ${index}`,
      initiative: 30 - index,
      order: index,
      armorClass: 10 + index,
      hitPoints: { current: index + 1, maximum: 50, temporary: index % 3 },
      conditions: [],
      visibleToPlayers: index % 4 !== 1,
      ...(index % 2
        ? { monsterDefinitionId: `monster-${index}` }
        : { characterId: null, taleSpireClientId: `client-${index}` }),
    })),
    metadata: { createdAt: "2026-08-01T12:00:00.000Z", updatedAt: "2026-08-01T12:01:00.000Z" },
  });
}

describe("fragmented encounter transfer", () => {
  it("removes secret GM data from the player projection", () => {
    const source = encounterFixture(2);
    const projection = projectPublicEncounter(source);
    expect(projection.combatants[1]).toMatchObject({ name: "", player: false, visible: false });
    expect(JSON.stringify(projection)).not.toContain("Monstruo secreto");
    expect(JSON.stringify(projection)).not.toContain("armorClass");
  });

  it("compresses, fragments and reconstructs a snapshot under TaleSpire's limit", async () => {
    const transfer = await buildEncounterTransfer(encounterFixture());
    expect(transfer.messages.length).toBeGreaterThan(2);
    expect(transfer.messages.every((message) => message.length <= TALESPIRE_MESSAGE_CHARACTER_LIMIT)).toBe(true);
    const parsed = transfer.messages.map(parseEncounterTransferMessage);
    expect(parsed.every(Boolean)).toBe(true);
    const start = parsed[0]!;
    const end = parsed.at(-1)!;
    const chunks = parsed.slice(1, -1).reverse();
    const assembler = new EncounterTransferAssembler();
    await assembler.accept(start);
    for (const chunk of chunks) await assembler.accept(chunk!);
    const result = await assembler.accept(end);
    expect(result).toMatchObject({
      kind: "complete",
      checksum: transfer.checksum,
      encounter: { id: transfer.encounterId, revision: transfer.revision, round: 4 },
    });
  });

  it("rejects an incomplete transfer instead of applying partial state", async () => {
    const transfer = await buildEncounterTransfer(encounterFixture());
    const parsed = transfer.messages.map(parseEncounterTransferMessage);
    const assembler = new EncounterTransferAssembler();
    await assembler.accept(parsed[0]!);
    for (const chunk of parsed.slice(1, -2)) await assembler.accept(chunk!);
    const result = await assembler.accept(parsed.at(-1)!);
    expect(result).toMatchObject({ kind: "rejected", reason: expect.stringContaining("Faltan fragmentos") });
  });
});
