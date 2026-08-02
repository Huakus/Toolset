import { describe, expect, it } from "vitest";
import { CampaignApplication } from "../../src/application/campaign/campaign-application";
import { previewCampaignMigration } from "../../src/application/migration/migrate-campaign-v1";
import { projectInventory } from "../../src/domain/character/character-projection";
import { InMemoryCampaignRepository } from "../../src/infrastructure/persistence/in-memory-campaign-repository";

const migratedAt = "2026-07-25T18:00:00.000Z";
const legacy = {
  characters: {
    Hero: {
      characterLevel: "4",
      strengthScore: "10",
      dexterityScore: "16",
      playerWeaponProficiency: ["Simple"],
      inventoryData: {
        equipment: [
          {
            name: "Dagger",
            uniqueId: "legacy-dagger",
            quantity: 2,
            weight: 2,
            cost: "2 gp",
            equipped: false,
            equipment_category: { index: "weapon" },
            weapon_category: "Simple",
            weapon_range: "Melee",
            damage: {
              damage_dice: "1d4",
              damage_type: { name: "Piercing" },
            },
            range: { normal: 5 },
            properties: [{ index: "finesse", name: "Finesse" }],
          },
          {
            name: "Ring",
            uniqueId: "legacy-ring",
            quantity: 1,
            weight: 0.2,
            cost: { quantity: 50, unit: "gp" },
            equipped: true,
            attuned: true,
            equipment_category: { index: "wondrous-item" },
            properties: [{ index: "attunement" }],
            hasCharges: true,
            currentCharges: 2,
            chargesOptions: { maxCharges: 3, chargeReset: "long-rest" },
          },
        ],
        backpack: [],
      },
    },
  },
};

describe("inventory", () => {
  it("migrates unit weight, costs, equipment metadata and charges", async () => {
    const preview = await previewCampaignMigration(legacy, {
      campaignId: "inventory-migration",
      migratedAt,
    });
    if (!preview.ok) throw new Error(preview.issues.join("; "));
    const character = Object.values(preview.data.characters)[0]!;
    const dagger = character.inventory.find((item) => item.name === "Dagger")!;
    const ring = character.inventory.find((item) => item.name === "Ring")!;

    expect(dagger.unitWeight).toBe(1);
    expect(dagger.cost).toEqual({ quantity: 2, unit: "gp" });
    expect(dagger.weapon?.damageExpression).toBe("1d4");
    expect(ring.requiresAttunement).toBe(true);
    expect(ring.charges).toEqual({ current: 2, maximum: 3, reset: "long-rest" });
    expect(projectInventory(character)).toMatchObject({
      totalWeight: 2.2,
      carryingCapacity: 150,
      overCapacity: false,
      attuned: 1,
    });
  });

  it("supports CRUD, use, attunement and weapon action linkage atomically", async () => {
    const repository = new InMemoryCampaignRepository();
    const application = new CampaignApplication(repository);
    const imported = await application.importCampaign({
      input: legacy,
      campaignId: "inventory-commands",
      migratedAt,
    });
    const character = Object.values(imported.snapshot.campaign.characters)[0]!;
    const dagger = character.inventory.find((item) => item.name === "Dagger")!;
    const ring = character.inventory.find((item) => item.name === "Ring")!;

    const equipped = await application.setInventoryItemEquipped({
      characterId: character.id,
      itemId: dagger.id,
      value: true,
      expectedCharacterRevision: character.revision,
      expectedCampaignChecksum: imported.snapshot.checksum,
      updatedAt: "2026-07-25T18:01:00.000Z",
    });
    const afterEquip = equipped.campaign.characters[character.id]!;
    expect(afterEquip.inventory.find((item) => item.id === dagger.id)?.equipped).toBe(true);
    expect(afterEquip.inventory.filter((item) => item.name === "Dagger")).toMatchObject([
      { quantity: 1, equipped: true },
      { quantity: 1, equipped: false },
    ]);
    expect(afterEquip.actions.find((action) => action.inventoryItemId === dagger.id)).toMatchObject({
      name: "Dagger",
      ability: "dexterity",
      proficient: true,
      damageBonus: 3,
    });

    const secondDagger = afterEquip.inventory.find((item) => item.name === "Dagger" && !item.equipped)!;
    const dualWielded = await application.setInventoryItemEquipped({
      characterId: character.id,
      itemId: secondDagger.id,
      value: true,
      expectedCharacterRevision: afterEquip.revision,
      expectedCampaignChecksum: equipped.checksum,
      updatedAt: "2026-07-25T18:01:30.000Z",
    });
    const afterDualWield = dualWielded.campaign.characters[character.id]!;
    expect(afterDualWield.inventory.filter((item) => item.name === "Dagger" && item.equipped)).toHaveLength(2);

    const quantityAdded = await application.adjustInventoryItemQuantity({
      characterId: character.id,
      itemId: dagger.id,
      delta: 1,
      expectedCharacterRevision: afterDualWield.revision,
      expectedCampaignChecksum: dualWielded.checksum,
      updatedAt: "2026-07-25T18:01:40.000Z",
    });
    const afterQuantity = quantityAdded.campaign.characters[character.id]!;
    const thirdDagger = afterQuantity.inventory.find((item) => item.name === "Dagger" && !item.equipped)!;
    await expect(application.setInventoryItemEquipped({
      characterId: character.id,
      itemId: thirdDagger.id,
      value: true,
      expectedCharacterRevision: afterQuantity.revision,
      expectedCampaignChecksum: quantityAdded.checksum,
      updatedAt: "2026-07-25T18:01:50.000Z",
    })).rejects.toThrow("No hay manos libres");

    const used = await application.useInventoryItem({
      characterId: character.id,
      itemId: ring.id,
      expectedCharacterRevision: afterQuantity.revision,
      expectedCampaignChecksum: quantityAdded.checksum,
      updatedAt: "2026-07-25T18:02:00.000Z",
    });
    const afterUse = used.campaign.characters[character.id]!;
    expect(afterUse.inventory.find((item) => item.id === ring.id)?.charges?.current).toBe(1);

    const reset = await application.resetInventoryCharges({
      characterId: character.id,
      reset: "long-rest",
      expectedCharacterRevision: afterUse.revision,
      expectedCampaignChecksum: used.checksum,
      updatedAt: "2026-07-25T18:03:00.000Z",
    });
    expect(reset.campaign.characters[character.id]?.inventory.find(
      (item) => item.id === ring.id,
    )?.charges?.current).toBe(3);
  });

  it("only uses non-consumable objects while they are equipped", async () => {
    const repository = new InMemoryCampaignRepository();
    const application = new CampaignApplication(repository);
    const imported = await application.importCampaign({ input: legacy, campaignId: "inventory-use", migratedAt });
    const character = Object.values(imported.snapshot.campaign.characters)[0]!;
    const ring = character.inventory.find((item) => item.name === "Ring")!;
    const unequipped = await application.setInventoryItemEquipped({
      characterId: character.id,
      itemId: ring.id,
      value: false,
      expectedCharacterRevision: character.revision,
      expectedCampaignChecksum: imported.snapshot.checksum,
      updatedAt: "2026-07-25T18:04:00.000Z",
    });
    const current = unequipped.campaign.characters[character.id]!;

    await expect(application.useInventoryItem({
      characterId: character.id,
      itemId: ring.id,
      expectedCharacterRevision: current.revision,
      expectedCampaignChecksum: unequipped.checksum,
      updatedAt: "2026-07-25T18:05:00.000Z",
    })).rejects.toThrow("debe estar equipado");
  });
});
