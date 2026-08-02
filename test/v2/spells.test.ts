import { describe, expect, it } from "vitest";
import { CampaignApplication } from "../../src/application/campaign/campaign-application";
import { previewCampaignMigration } from "../../src/application/migration/migrate-campaign-v1";
import {
  projectSpellcasting,
  projectSpellDamageExpression,
} from "../../src/domain/character/character-projection";
import { InMemoryCampaignRepository } from "../../src/infrastructure/persistence/in-memory-campaign-repository";

const migratedAt = "2026-07-25T19:00:00.000Z";
const legacy = {
  characters: {
    Mage: {
      characterLevel: "5",
      intelligenceScore: "18",
      spellData: {
        spellcastingModifier: "INT",
        spelllevelselected: "3",
        Cantrip: {
          spells: [{ name: "Acid Splash", prepared: "false" }],
          slots: [],
        },
        "1st-level": {
          spells: [{ name: "Absorb Elements*", prepared: "1" }],
          slots: [true, false, false],
        },
        "2nd-level": {
          spells: [{ name: "Acid Arrow", prepared: "true" }],
          slots: [false, false],
        },
      },
      upcastToggle: 1,
    },
  },
};

describe("spells", () => {
  it("migrates known/prepared spells and slot usage into typed state", async () => {
    const preview = await previewCampaignMigration(legacy, {
      campaignId: "spells-migration",
      migratedAt,
    });
    if (!preview.ok) throw new Error(preview.issues.join("; "));
    const character = Object.values(preview.data.characters)[0]!;
    expect(character.spellcasting.showUpcast).toBe(true);
    expect(character.spellcasting.slots["1"]).toEqual({ maximum: 3, used: 1 });
    expect(character.spellcasting.spells).toHaveLength(3);
    expect(character.spellcasting.spells.find((spell) => spell.name === "Acid Arrow")).toMatchObject({
      level: 2,
      prepared: true,
      source: "bundled",
    });
    expect(projectSpellcasting(character)).toEqual({
      ability: "intelligence",
      attackModifier: 7,
      saveDc: 15,
    });
    const cantrip = character.spellcasting.spells.find((spell) => spell.name === "Acid Splash")!;
    expect(projectSpellDamageExpression(character, cantrip)).toBe("2d6");
  });

  it("casts with an upcast slot, tracks concentration and resets slots on long rest", async () => {
    const repository = new InMemoryCampaignRepository();
    const application = new CampaignApplication(repository);
    const imported = await application.importCampaign({
      input: legacy,
      campaignId: "spell-commands",
      migratedAt,
    });
    const character = Object.values(imported.snapshot.campaign.characters)[0]!;
    const absorb = character.spellcasting.spells.find((spell) => spell.name === "Absorb Elements*")!;

    const cast = await application.castCharacterSpell({
      characterId: character.id,
      spellId: absorb.id,
      slotLevel: 2,
      expectedCharacterRevision: character.revision,
      expectedCampaignChecksum: imported.snapshot.checksum,
      updatedAt: "2026-07-25T19:01:00.000Z",
    });
    const afterCast = cast.campaign.characters[character.id]!;
    expect(afterCast.spellcasting.slots["2"]?.used).toBe(1);

    const rested = await application.applyCharacterResource({
      characterId: character.id,
      expectedCharacterRevision: afterCast.revision,
      expectedCampaignChecksum: cast.checksum,
      action: { kind: "long-rest" },
      updatedAt: "2026-07-25T19:02:00.000Z",
    });
    expect(rested.snapshot.campaign.characters[character.id]?.spellcasting.slots["1"]?.used).toBe(0);
    expect(rested.snapshot.campaign.characters[character.id]?.spellcasting.slots["2"]?.used).toBe(0);
    expect(rested.effects.deferredResets).toEqual([]);
  });

  it("persists favorites independently from the known spell list", async () => {
    const repository = new InMemoryCampaignRepository();
    const application = new CampaignApplication(repository);
    const imported = await application.importCampaign({
      input: legacy,
      campaignId: "spell-favorites",
      migratedAt,
    });
    const character = Object.values(imported.snapshot.campaign.characters)[0]!;

    const favorite = await application.setCharacterSpellFavorite({
      characterId: character.id,
      spellName: "Un conjuro todavía desconocido",
      favorite: true,
      expectedCharacterRevision: character.revision,
      expectedCampaignChecksum: imported.snapshot.checksum,
      updatedAt: "2026-07-25T19:03:00.000Z",
    });
    const updated = favorite.campaign.characters[character.id]!;

    expect(updated.spellcasting.favoriteSpells).toEqual(["Un conjuro todavía desconocido"]);
    expect(updated.spellcasting.spells).toHaveLength(character.spellcasting.spells.length);
  });
});
