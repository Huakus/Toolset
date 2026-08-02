import { describe, expect, it } from "vitest";
import { CampaignApplication } from "../../src/application/campaign/campaign-application";
import { InMemoryCampaignRepository } from "../../src/infrastructure/persistence/in-memory-campaign-repository";
import { convertDndBeyondCharacter } from "../../src/application/import/dnd-beyond";

const migratedAt = "2026-07-25T21:00:00.000Z";

describe("character lifecycle", () => {
  it("starts a native empty campaign before the first character exists", async () => {
    const application = new CampaignApplication(new InMemoryCampaignRepository());
    const created = await application.createCampaign(migratedAt);
    expect(created.campaign.metadata.migratedFrom).toBe("native");
    expect(created.campaign.characters).toEqual({});
  });

  it("creates, imports and deletes characters without replacing the campaign", async () => {
    const repository = new InMemoryCampaignRepository();
    const application = new CampaignApplication(repository);
    const importedCampaign = await application.importCampaign({
      input: { characters: { Original: { characterLevel: "2" } } },
      campaignId: "lifecycle",
      migratedAt,
    });
    const created = await application.createCharacter({
      name: "New Hero",
      expectedCampaignChecksum: importedCampaign.snapshot.checksum,
      createdAt: "2026-07-25T21:01:00.000Z",
    });
    const newHero = Object.values(created.campaign.characters).find((character) => character.name === "New Hero")!;
    expect(newHero.metadata.migratedFrom).toBe("native");
    expect(newHero.identity.level).toBe(1);

    const imported = await application.importCharacter({
      input: { Imported: { playerClass: "Wizard", characterLevel: "3", intelligenceScore: "16" } },
      fallbackName: "Imported",
      expectedCampaignChecksum: created.checksum,
      importedAt: "2026-07-25T21:02:00.000Z",
    });
    expect(Object.values(imported.campaign.characters).some((character) => character.name === "Imported")).toBe(true);

    const deleted = await application.deleteCharacter({
      characterId: newHero.id,
      expectedCampaignChecksum: imported.checksum,
      updatedAt: "2026-07-25T21:03:00.000Z",
    });
    expect(deleted.campaign.characters[newHero.id]).toBeUndefined();
    expect(Object.keys(deleted.campaign.characters)).toHaveLength(2);
  });
});

describe("D&D Beyond conversion", () => {
  it("converts core statistics, proficiencies, inventory and spell slots into the migration contract", async () => {
    const ddb = {
      data: {
        name: "Beyond Hero",
        stats: [{ value: 10 }, { value: 14 }, { value: 12 }, { value: 16 }, { value: 10 }, { value: 8 }],
        bonusStats: Array.from({ length: 6 }, () => ({ value: 0 })),
        overrideStats: Array.from({ length: 6 }, () => ({ value: null })),
        classes: [{
          level: 3,
          definition: { name: "Wizard", hitDice: 6, canCastSpells: true, spellCastingAbilityId: 4, spellRules: { multiClassSpellSlotDivisor: 1 } },
          classFeatures: [],
        }],
        baseHitPoints: 12,
        removedHitPoints: 2,
        modifiers: { class: [
          { type: "proficiency", subType: "arcana", friendlySubtypeName: "Arcana" },
          { type: "proficiency", subType: "dagger", friendlySubtypeName: "Dagger" },
        ] },
        classSpells: [{ spells: [{ definition: { name: "Acid Arrow", level: 2 }, prepared: true }] }],
        spellSlots: [{ level: 1, used: 1 }],
        inventory: [{ id: 7, quantity: 1, equipped: true, containerEntityTypeId: 1581111423, definition: { name: "Dagger", weight: 1, filterType: "Weapon" } }],
        currencies: { gp: 20 },
      },
    };
    const repository = new InMemoryCampaignRepository();
    const application = new CampaignApplication(repository);
    const campaign = await application.importCampaign({
      input: convertDndBeyondCharacter(ddb), campaignId: "ddb", migratedAt,
    });
    const character = Object.values(campaign.snapshot.campaign.characters)[0]!;
    expect(character.name).toBe("Beyond Hero");
    expect(character.identity).toMatchObject({ className: "Wizard", level: 3 });
    expect(character.abilities.intelligence).toBe(16);
    expect(character.checks.skills.arcana.proficiency).toBe(1);
    expect(character.inventory[0]?.name).toBe("Dagger");
    expect(character.spellcasting.spells[0]?.name).toBe("Acid Arrow");
    expect(character.spellcasting.slots["1"]).toEqual({ maximum: 4, used: 1 });
  });
});
