import { describe, expect, it } from "vitest";
import { CampaignApplication } from "../../src/application/campaign/campaign-application";
import { previewCampaignMigration } from "../../src/application/migration/migrate-campaign-v1";
import { InMemoryCampaignRepository } from "../../src/infrastructure/persistence/in-memory-campaign-repository";

const migratedAt = "2026-07-25T20:00:00.000Z";
const legacy = {
  characters: {
    Hero: {
      groupTraitData: [{
        "group-title": "Class Features",
        "group-chevron": false,
        traits: [{
          traitName: "Second Wind",
          traitDescription: "Recover hit points.",
          checkboxStates: [true],
          numberOfUses: "1",
          resetType: "short rest",
          adjustmentCategory: "None",
        }],
      }],
      groupNotesData: [{
        "group-title": "Clues",
        "group-chevron": true,
        notes: [{ noteTitle: "Door", noteContent: "Blue sigil", tags: ["dungeon"] }],
      }],
      extrasData: [{ name: "Wolf", currentHp: "5", maxHp: "11", tempHp: "3" }],
    },
  },
};

describe("character free-form content", () => {
  it("migrates trait uses, notes and extra hit points", async () => {
    const preview = await previewCampaignMigration(legacy, {
      campaignId: "content-migration",
      migratedAt,
    });
    if (!preview.ok) throw new Error(preview.issues.join("; "));
    const character = Object.values(preview.data.characters)[0]!;
    expect(character.traits[0]?.traits[0]).toMatchObject({
      name: "Second Wind",
      uses: { maximum: 1, used: 1, reset: "short-rest" },
    });
    expect(character.notes[0]?.notes[0]).toMatchObject({
      title: "Door",
      content: "Blue sigil",
      tags: ["dungeon"],
    });
    expect(character.extras[0]?.hitPoints).toEqual({ current: 5, maximum: 11, temporary: 3 });
  });

  it("resets short-rest traits and applies extra damage through checked commands", async () => {
    const repository = new InMemoryCampaignRepository();
    const application = new CampaignApplication(repository);
    const imported = await application.importCampaign({ input: legacy, campaignId: "content-commands", migratedAt });
    const character = Object.values(imported.snapshot.campaign.characters)[0]!;
    const extra = character.extras[0]!;

    const damaged = await application.applyExtraHitPoints({
      characterId: character.id,
      extraId: extra.id,
      action: { kind: "damage", amount: 6 },
      expectedCharacterRevision: character.revision,
      expectedCampaignChecksum: imported.snapshot.checksum,
      updatedAt: "2026-07-25T20:01:00.000Z",
    });
    const afterDamage = damaged.campaign.characters[character.id]!;
    expect(afterDamage.extras[0]?.hitPoints).toEqual({ current: 2, maximum: 11, temporary: 0 });

    const rested = await application.applyCharacterResource({
      characterId: character.id,
      action: { kind: "short-rest" },
      expectedCharacterRevision: afterDamage.revision,
      expectedCampaignChecksum: damaged.checksum,
      updatedAt: "2026-07-25T20:02:00.000Z",
    });
    expect(rested.snapshot.campaign.characters[character.id]?.traits[0]?.traits[0]?.uses.used).toBe(0);
  });
});
