import { describe, expect, it } from "vitest";
import { CampaignApplication } from "../../src/application/campaign/campaign-application";
import { EncounterApplication } from "../../src/application/encounter/encounter-application";
import { InMemoryCampaignRepository } from "../../src/infrastructure/persistence/in-memory-campaign-repository";

const time = "2026-08-01T12:00:00.000Z";

describe("EncounterApplication", () => {
  it("migrates legacy encounter cards into typed encounters during campaign import", async () => {
    const repository = new InMemoryCampaignRepository();
    const campaigns = new CampaignApplication(repository);
    const result = await campaigns.importCampaign({
      campaignId: "legacy-encounters",
      migratedAt: time,
      input: {
        characters: {},
        "Encounter Data": {
          "Puente en ruinas": [
            { isMonster: 1, name: "Goblin", init: "14", currentHp: "3", maxHp: "7", tempHp: "2", conditions: ["Bloodied"], isClosed: 1 },
            { isMonster: 0, isCustom: true, name: "Aliado", init: "11", hp: { current: 8, max: 10 }, ac: 13 },
          ],
        },
      },
    });

    const encounter = Object.values(result.snapshot.campaign.encounters)[0];
    expect(encounter).toMatchObject({ name: "Puente en ruinas", round: 1, activeCombatantId: null });
    expect(encounter?.combatants[0]).toMatchObject({
      kind: "monster",
      name: "Goblin",
      initiative: 14,
      hitPoints: { current: 3, maximum: 7, temporary: 2 },
      visibleToPlayers: false,
    });
    expect(encounter?.combatants[0]?.conditions[0]).toMatchObject({ key: "bloodied", label: "Bloodied" });
    expect(encounter?.combatants[1]).toMatchObject({ kind: "custom", name: "Aliado" });
    expect(result.snapshot.campaign.legacy.encounterData).not.toBeNull();
  });

  it("creates, mutates and deletes persisted encounters with checksum expectations", async () => {
    const repository = new InMemoryCampaignRepository();
    const campaigns = new CampaignApplication(repository);
    const encounters = new EncounterApplication(repository);
    const empty = await campaigns.createCampaign(time);
    const created = await encounters.createEncounter("Prueba", empty.checksum, time);
    const encounter = Object.values(created.campaign.encounters)[0]!;
    const withCombatant = await encounters.addCombatant({
      encounterId: encounter.id,
      expectedEncounterRevision: encounter.revision,
      expectedCampaignChecksum: created.checksum,
      updatedAt: time,
      combatant: {
        kind: "custom",
        name: "Objetivo",
        initiative: 10,
        armorClass: 12,
        hitPoints: { current: 5, maximum: 5, temporary: 0 },
        conditions: [],
        visibleToPlayers: true,
      },
    });
    const updatedEncounter = withCombatant.campaign.encounters[encounter.id]!;
    const combatantId = updatedEncounter.combatants[0]!.id;
    const damaged = await encounters.apply({
      encounterId: encounter.id,
      expectedEncounterRevision: updatedEncounter.revision,
      expectedCampaignChecksum: withCombatant.checksum,
      updatedAt: time,
      action: { kind: "damage", combatantId, amount: 3 },
    });
    expect(damaged.snapshot.campaign.encounters[encounter.id]?.combatants[0]?.hitPoints.current).toBe(2);
    const damagedEncounter = damaged.snapshot.campaign.encounters[encounter.id]!;
    const conditioned = await encounters.addCondition({
      encounterId: encounter.id,
      combatantId,
      key: "prone",
      label: "Derribado",
      expectedEncounterRevision: damagedEncounter.revision,
      expectedCampaignChecksum: damaged.snapshot.checksum,
      updatedAt: time,
    });
    expect(conditioned.campaign.encounters[encounter.id]?.combatants[0]?.conditions[0]).toMatchObject({ key: "prone", label: "Derribado" });
    const deleted = await encounters.deleteEncounter(encounter.id, conditioned.checksum, time);
    expect(deleted.campaign.encounters).toEqual({});
  });

  it("upgrades preserved legacy encounters in an existing v2 campaign only once", async () => {
    const repository = new InMemoryCampaignRepository();
    const campaigns = new CampaignApplication(repository);
    const imported = await campaigns.importCampaign({
      campaignId: "upgrade",
      migratedAt: time,
      input: { characters: {}, "Encounter Data": { Viejo: [{ isMonster: 1, name: "Ogro", currentHp: 20, maxHp: 20 }] } },
    });
    const encounter = Object.values(imported.snapshot.campaign.encounters)[0]!;
    const campaignWithoutTypedEncounters = { ...imported.snapshot.campaign, encounters: {} };
    await repository.save(campaignWithoutTypedEncounters, { kind: "checksum", checksum: imported.snapshot.checksum });
    const application = new EncounterApplication(repository);
    const upgraded = await application.migratePreservedLegacyEncounters(time);
    expect(Object.values(upgraded!.campaign.encounters)[0]?.name).toBe("Viejo");
    const repeated = await application.migratePreservedLegacyEncounters(time);
    expect(repeated?.checksum).toBe(upgraded?.checksum);
    expect(Object.values(repeated!.campaign.encounters)[0]?.id).toBe(encounter.id);
  });

  it("restores encounter and GM workspace state for GM undo/redo", async () => {
    const repository = new InMemoryCampaignRepository();
    const campaigns = new CampaignApplication(repository);
    const application = new EncounterApplication(repository);
    const empty = await campaigns.createCampaign(time);
    const created = await application.createEncounter("Reversible", empty.checksum, time);
    const encounterId = Object.keys(created.campaign.encounters)[0]!;
    const restored = await application.restoreGmControlState({
      expectedCampaignChecksum: created.checksum,
      encounters: {},
      workspace: {
        noteGroups: [{ id: "gmg_11111111111111111111111111111111", title: "Log", notes: [] }],
        randomTables: [],
        googleDocsUrl: "",
      },
      updatedAt: time,
    });
    expect(restored.campaign.encounters[encounterId]).toBeUndefined();
    expect(restored.campaign.gm.noteGroups[0]?.title).toBe("Log");
    expect(restored.campaign.revision).toBe(created.campaign.revision + 1);
  });
});
