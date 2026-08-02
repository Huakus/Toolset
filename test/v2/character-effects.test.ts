import { describe, expect, it } from "vitest";
import { CampaignApplication } from "../../src/application/campaign/campaign-application";
import { InMemoryCampaignRepository } from "../../src/infrastructure/persistence/in-memory-campaign-repository";

const migratedAt = "2026-07-26T12:00:00.000Z";
const legacy = {
  characters: {
    Hero: {
      spellData: {
        "1st-level": { spells: [{ name: "Absorb Elements*", prepared: true }], slots: [false] },
      },
      inventoryData: { equipment: [{ name: "Ring", quantity: 1, equipment_category: { index: "wondrous-item" } }] },
      groupTraitData: [{
        "group-title": "Features",
        traits: [{ traitName: "Aura", traitDescription: "An aura.", numberOfUses: 0 }],
      }],
    },
  },
};

describe("character colors and activatable effects", () => {
  it("persists color and independent spell, inventory and trait effects", async () => {
    const application = new CampaignApplication(new InMemoryCampaignRepository());
    const imported = await application.importCampaign({ input: legacy, campaignId: "effects", migratedAt });
    const original = Object.values(imported.snapshot.campaign.characters)[0]!;
    expect(original.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(original.spellcasting.spells[0]?.effect).toEqual({ description: "", active: false });
    expect(original.inventory[0]?.effect).toEqual({ description: "", active: false });
    expect(original.traits[0]?.traits[0]?.effect).toEqual({ description: "", active: false });

    const colored = await application.editCharacter({
      characterId: original.id,
      expectedCharacterRevision: original.revision,
      expectedCampaignChecksum: imported.snapshot.checksum,
      patch: { color: "#336699" },
      updatedAt: "2026-07-26T12:01:00.000Z",
    });
    const afterColor = colored.campaign.characters[original.id]!;
    const spell = afterColor.spellcasting.spells[0]!;
    const withSpell = await application.upsertCharacterSpell({
      characterId: original.id,
      spellId: spell.id,
      expectedCharacterRevision: afterColor.revision,
      expectedCampaignChecksum: colored.checksum,
      spell: { ...spell, effect: { description: "+1 CA", active: true } },
      updatedAt: "2026-07-26T12:02:00.000Z",
    });
    const afterSpell = withSpell.campaign.characters[original.id]!;
    const item = afterSpell.inventory[0]!;
    const withItem = await application.upsertInventoryItem({
      characterId: original.id,
      itemId: item.id,
      expectedCharacterRevision: afterSpell.revision,
      expectedCampaignChecksum: withSpell.checksum,
      item: { ...item, effect: { description: "Luz tenue", active: true } },
      updatedAt: "2026-07-26T12:03:00.000Z",
    });
    const afterItem = withItem.campaign.characters[original.id]!;
    const group = afterItem.traits[0]!;
    const trait = group.traits[0]!;
    const withTrait = await application.upsertTrait({
      characterId: original.id,
      groupId: group.id,
      traitId: trait.id,
      expectedCharacterRevision: afterItem.revision,
      expectedCampaignChecksum: withItem.checksum,
      trait: { ...trait, effect: { description: "Aliados con ventaja", active: true } },
      updatedAt: "2026-07-26T12:04:00.000Z",
    });
    const result = withTrait.campaign.characters[original.id]!;

    expect(result.color).toBe("#336699");
    expect(result.spellcasting.spells[0]?.effect).toEqual({ description: "+1 CA", active: true });
    expect(result.inventory[0]?.effect).toEqual({ description: "Luz tenue", active: true });
    expect(result.traits[0]?.traits[0]?.effect).toEqual({ description: "Aliados con ventaja", active: true });
  });
});

