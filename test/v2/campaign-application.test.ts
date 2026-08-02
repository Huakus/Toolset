import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  CampaignAlreadyExistsError,
  CampaignApplication,
} from "../../src/application/campaign/campaign-application";
import { CampaignRepositoryConflictError } from "../../src/application/ports/campaign-repository";
import { CharacterRevisionConflictError } from "../../src/domain/character/edit-character";
import { currencyFromCopper, currencyTotalInCopper } from "../../src/domain/character/character-currency";
import { InMemoryCampaignRepository } from "../../src/infrastructure/persistence/in-memory-campaign-repository";

const fixtureUrl = new URL(
  "../fixtures/legacy/campaign-storage-v1.anonymized.json",
  import.meta.url,
);

async function legacyFixture(): Promise<unknown> {
  return JSON.parse(await readFile(fixtureUrl, "utf8"));
}

async function importedApplication(): Promise<{
  application: CampaignApplication;
  repository: InMemoryCampaignRepository;
}> {
  const repository = new InMemoryCampaignRepository();
  const application = new CampaignApplication(repository);
  await application.importCampaign({
    input: await legacyFixture(),
    campaignId: "test-campaign",
    migratedAt: "2026-07-25T12:00:00.000Z",
  });
  return { application, repository };
}

describe("CampaignApplication vertical slice", () => {
  it("imports, loads, edits and persists one character", async () => {
    const { application } = await importedApplication();
    const before = await application.loadCampaign();
    expect(before).not.toBeNull();
    if (before === null) return;

    const character = Object.values(before.campaign.characters)[0];
    expect(character).toBeDefined();
    if (character === undefined) return;

    const after = await application.editCharacter({
      characterId: character.id,
      expectedCharacterRevision: character.revision,
      expectedCampaignChecksum: before.checksum,
      updatedAt: "2026-07-25T12:01:00.000Z",
      patch: {
        name: "Nombre editado",
        combat: { hitPoints: { current: 17 } },
        currency: { gold: 42 },
      },
    });

    const edited = after.campaign.characters[character.id];
    expect(after.checksum).not.toBe(before.checksum);
    expect(after.campaign.revision).toBe(before.campaign.revision + 1);
    expect(edited?.revision).toBe(character.revision + 1);
    expect(edited?.name).toBe("Nombre editado");
    expect(edited?.combat.hitPoints.current).toBe(17);
    expect(edited?.currency.gold).toBe(42);
    expect(edited?.metadata.updatedAt).toBe("2026-07-25T12:01:00.000Z");

    const reloaded = await application.loadCampaign();
    expect(reloaded).toEqual(after);
  });

  it("rejects a stale campaign checksum without losing the winning edit", async () => {
    const { application } = await importedApplication();
    const sharedSnapshot = await application.loadCampaign();
    if (sharedSnapshot === null) throw new Error("fixture was not imported");
    const character = Object.values(sharedSnapshot.campaign.characters)[0];
    if (character === undefined) throw new Error("fixture has no characters");

    const winner = await application.editCharacter({
      characterId: character.id,
      expectedCharacterRevision: character.revision,
      expectedCampaignChecksum: sharedSnapshot.checksum,
      updatedAt: "2026-07-25T12:01:00.000Z",
      patch: { name: "Primera edición" },
    });

    await expect(
      application.editCharacter({
        characterId: character.id,
        expectedCharacterRevision: character.revision,
        expectedCampaignChecksum: sharedSnapshot.checksum,
        updatedAt: "2026-07-25T12:02:00.000Z",
        patch: { name: "Edición obsoleta" },
      }),
    ).rejects.toBeInstanceOf(CampaignRepositoryConflictError);

    expect(await application.loadCampaign()).toEqual(winner);
  });

  it("rejects a stale character revision", async () => {
    const { application } = await importedApplication();
    const snapshot = await application.loadCampaign();
    if (snapshot === null) throw new Error("fixture was not imported");
    const character = Object.values(snapshot.campaign.characters)[0];
    if (character === undefined) throw new Error("fixture has no characters");

    await expect(
      application.editCharacter({
        characterId: character.id,
        expectedCharacterRevision: character.revision + 1,
        expectedCampaignChecksum: snapshot.checksum,
        patch: { name: "No debe guardarse" },
      }),
    ).rejects.toBeInstanceOf(CharacterRevisionConflictError);
  });

  it("requires explicit replacement when a campaign exists", async () => {
    const { application } = await importedApplication();
    await expect(
      application.importCampaign({
        input: await legacyFixture(),
        campaignId: "replacement",
      }),
    ).rejects.toBeInstanceOf(CampaignAlreadyExistsError);
  });

  it("persists resource commands through the same optimistic boundary", async () => {
    const { application } = await importedApplication();
    const before = await application.loadCampaign();
    if (!before) throw new Error("fixture was not imported");
    const character = Object.values(before.campaign.characters)[0];
    if (!character) throw new Error("fixture has no characters");

    const result = await application.applyCharacterResource({
      characterId: character.id,
      expectedCharacterRevision: character.revision,
      expectedCampaignChecksum: before.checksum,
      updatedAt: "2026-07-25T12:03:00.000Z",
      action: { kind: "damage", amount: 5 },
    });
    const persisted = result.snapshot.campaign.characters[character.id];

    expect(result.snapshot.campaign.revision).toBe(before.campaign.revision + 1);
    expect(persisted?.revision).toBe(character.revision + 1);
    expect(persisted?.combat.hitPoints.temporary).toBe(0);
    expect(persisted?.combat.hitPoints.current).toBe(
      character.combat.hitPoints.current - 3,
    );
    expect(await application.loadCampaign()).toEqual(result.snapshot);
  });

  it("persists normalized currency adjustments through the optimistic boundary", async () => {
    const { application } = await importedApplication();
    const before = await application.loadCampaign();
    if (!before) throw new Error("fixture was not imported");
    const character = Object.values(before.campaign.characters)[0];
    if (!character) throw new Error("fixture has no characters");

    const result = await application.applyCharacterResource({
      characterId: character.id,
      expectedCharacterRevision: character.revision,
      expectedCampaignChecksum: before.checksum,
      updatedAt: "2026-07-25T12:04:00.000Z",
      action: { kind: "adjust-currency", denomination: "silver", quantity: 1 },
    });
    const persisted = result.snapshot.campaign.characters[character.id];
    expect(persisted?.currency).toEqual(currencyFromCopper(currencyTotalInCopper(character.currency) + 10));
    expect(persisted?.revision).toBe(character.revision + 1);
    expect(await application.loadCampaign()).toEqual(result.snapshot);
  });

  it("restores a previous character state without rolling revisions backwards", async () => {
    const { application } = await importedApplication();
    const before = await application.loadCampaign();
    if (!before) throw new Error("fixture was not imported");
    const character = Object.values(before.campaign.characters)[0];
    if (!character) throw new Error("fixture has no characters");

    const edited = await application.editCharacter({
      characterId: character.id,
      expectedCharacterRevision: character.revision,
      expectedCampaignChecksum: before.checksum,
      patch: { name: "Estado posterior", combat: { hitPoints: { current: 1 } } },
    });
    const current = edited.campaign.characters[character.id]!;
    const restored = await application.restoreCharacterState({
      characterId: character.id,
      character,
      expectedCharacterRevision: current.revision,
      expectedCampaignChecksum: edited.checksum,
      updatedAt: "2026-07-25T12:05:00.000Z",
    });
    const result = restored.campaign.characters[character.id]!;

    expect(result.name).toBe(character.name);
    expect(result.combat.hitPoints.current).toBe(character.combat.hitPoints.current);
    expect(result.revision).toBe(current.revision + 1);
    expect(restored.campaign.revision).toBe(edited.campaign.revision + 1);
    expect(await application.loadCampaign()).toEqual(restored);
  });

  it("transfers currency and inventory atomically between two characters", async () => {
    const { application } = await importedApplication();
    const initial = await application.loadCampaign();
    if (!initial) throw new Error("fixture was not imported");
    const originalSource = Object.values(initial.campaign.characters)[0];
    if (!originalSource) throw new Error("fixture has no characters");

    const withTarget = await application.createCharacter({
      name: "Receptor",
      expectedCampaignChecksum: initial.checksum,
      createdAt: "2026-07-25T12:06:00.000Z",
    });
    const target = Object.values(withTarget.campaign.characters).find((character) => character.id !== originalSource.id);
    if (!target) throw new Error("target was not created");
    const source = withTarget.campaign.characters[originalSource.id]!;
    const funded = await application.editCharacter({
      characterId: source.id,
      expectedCharacterRevision: source.revision,
      expectedCampaignChecksum: withTarget.checksum,
      patch: { currency: { platinum: 0, gold: 10, electrum: 0, silver: 0, copper: 0 } },
      updatedAt: "2026-07-25T12:07:00.000Z",
    });
    const fundedSource = funded.campaign.characters[source.id]!;
    const fundedTarget = funded.campaign.characters[target.id]!;
    const currencyTransfer = await application.transferCurrency({
      sourceCharacterId: fundedSource.id,
      targetCharacterId: fundedTarget.id,
      denomination: "gold",
      quantity: 3,
      expectedSourceRevision: fundedSource.revision,
      expectedTargetRevision: fundedTarget.revision,
      expectedCampaignChecksum: funded.checksum,
      updatedAt: "2026-07-25T12:08:00.000Z",
    });
    expect(currencyTotalInCopper(currencyTransfer.campaign.characters[source.id]!.currency)).toBe(700);
    expect(currencyTotalInCopper(currencyTransfer.campaign.characters[target.id]!.currency)).toBe(300);
    expect(currencyTransfer.campaign.revision).toBe(funded.campaign.revision + 1);

    const sourceAfterCurrency = currencyTransfer.campaign.characters[source.id]!;
    const targetAfterCurrency = currencyTransfer.campaign.characters[target.id]!;
    const item = sourceAfterCurrency.inventory[0];
    if (!item) throw new Error("fixture has no inventory item");
    const beforeItemTransfer = { source: sourceAfterCurrency, target: targetAfterCurrency };
    const itemTransfer = await application.transferInventoryItem({
      sourceCharacterId: sourceAfterCurrency.id,
      targetCharacterId: targetAfterCurrency.id,
      itemId: item.id,
      quantity: item.quantity,
      expectedSourceRevision: sourceAfterCurrency.revision,
      expectedTargetRevision: targetAfterCurrency.revision,
      expectedCampaignChecksum: currencyTransfer.checksum,
      updatedAt: "2026-07-25T12:09:00.000Z",
    });
    const transferredSource = itemTransfer.campaign.characters[source.id]!;
    const transferredTarget = itemTransfer.campaign.characters[target.id]!;
    expect(transferredSource.inventory.some((entry) => entry.id === item.id)).toBe(false);
    const received = transferredTarget.inventory.find((entry) => entry.name === item.name);
    expect(received).toMatchObject({ quantity: item.quantity, equipped: false, attuned: false });
    expect(received?.id).not.toBe(item.id);

    const restored = await application.restoreCharacterStates({
      expectedCampaignChecksum: itemTransfer.checksum,
      characters: [
        { characterId: source.id, expectedCharacterRevision: transferredSource.revision, character: beforeItemTransfer.source },
        { characterId: target.id, expectedCharacterRevision: transferredTarget.revision, character: beforeItemTransfer.target },
      ],
      updatedAt: "2026-07-25T12:10:00.000Z",
    });
    expect(restored.campaign.characters[source.id]!.inventory.some((entry) => entry.id === item.id)).toBe(true);
    expect(restored.campaign.characters[target.id]!.inventory.some((entry) => entry.name === item.name)).toBe(false);
    expect(restored.campaign.characters[source.id]!.revision).toBe(transferredSource.revision + 1);
    expect(restored.campaign.characters[target.id]!.revision).toBe(transferredTarget.revision + 1);
  });
});
