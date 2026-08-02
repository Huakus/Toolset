import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CampaignV2Schema } from "../../src/domain/character/character-v2";
import { previewCampaignMigration } from "../../src/application/migration/migrate-campaign-v1";
import type { JsonObject } from "../../src/shared/json";

const fixtureUrl = new URL(
  "../fixtures/legacy/campaign-storage-v1.anonymized.json",
  import.meta.url,
);
const migrationTime = "2026-07-25T18:30:12.345Z";

async function loadFixture(): Promise<JsonObject> {
  return JSON.parse(await readFile(fixtureUrl, "utf8")) as JsonObject;
}

describe("v1 campaign migration preview", () => {
  it("creates a validated v2 campaign without mutating the source", async () => {
    const source = await loadFixture();
    const before = structuredClone(source);

    const preview = await previewCampaignMigration(source, {
      campaignId: "fixture-campaign",
      migratedAt: migrationTime,
    });

    expect(preview.ok).toBe(true);
    expect(source).toEqual(before);
    if (!preview.ok) return;

    expect(CampaignV2Schema.safeParse(preview.data).success).toBe(true);
    expect(preview.data.schemaVersion).toBe(2);
    expect(preview.data.metadata.createdAt).toBe(migrationTime);
    expect(preview.report.migratedCharacters).toBe(1);
    expect(preview.report.generatedEntityIds).toBeGreaterThan(5);
    expect(preview.report.sourceChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.report.resultChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.report.warnings).toContain("LEGACY_EMPTY_PROPERTY_PRESERVED");
  });

  it("maps core values and assigns IDs to all mutable collections", async () => {
    const preview = await previewCampaignMigration(await loadFixture(), {
      campaignId: "fixture-campaign",
      migratedAt: migrationTime,
    });
    if (!preview.ok) throw new Error(preview.issues.join("\n"));

    const [character] = Object.values(preview.data.characters);
    expect(character).toBeDefined();
    if (!character) return;

    expect(character.name).toBe("Personaje Alfa");
    expect(character.identity).toEqual({
      className: "Clase ficticia",
      level: 3,
      experience: 900,
      alignment: "Neutral",
    });
    expect(character.abilities.intelligence).toBe(16);
    expect(character.combat.hitPoints).toEqual({
      current: 17,
      maximum: 24,
      temporary: 2,
    });
    expect(character.currency.gold).toBe(12);
    expect(character.legacy.unmapped[""]).toBe(0);
    expect(character.checks.skills.acrobatics).toEqual({
      proficiency: 1,
      bonus: -2,
      rollMode: "normal",
    });
    expect(character.checks.skills.arcana).toEqual({
      proficiency: 1,
      bonus: 0,
      rollMode: "normal",
    });
    expect(character.checks.skills.stealth).toEqual({
      proficiency: 1,
      bonus: 0,
      rollMode: "normal",
    });
    expect(character.checks.initiative.bonus).toBe(0);

    const collectionIds = [
      ...character.collections.actions,
      ...character.collections.spells,
      ...character.collections.inventory,
      ...character.collections.extras,
      ...character.collections.traits.flatMap((group) => [group, ...group.items]),
      ...character.collections.notes.flatMap((group) => [group, ...group.items]),
    ].map((entry) => entry.id);

    expect(collectionIds.length).toBeGreaterThan(0);
    expect(new Set(collectionIds).size).toBe(collectionIds.length);
    expect(character.collections.inventory[0]?.legacyId).toBe("item-fixture-001");
  });

  it("is deterministic for the same source and migration timestamp", async () => {
    const source = await loadFixture();
    const options = {
      campaignId: "fixture-campaign",
      migratedAt: migrationTime,
    };

    const first = await previewCampaignMigration(source, options);
    const second = await previewCampaignMigration(source, options);

    expect(first).toEqual(second);
  });

  it("migrates grouped GM notes into the typed workspace", async () => {
    const source = await loadFixture();
    source.DmNotes = { groupNotesData: [{ "group-title": "Trama", notes: [{ noteTitle: "Secreto", noteContent: "La puerta está al norte." }] }] };
    const preview = await previewCampaignMigration(source, { campaignId: "fixture-campaign", migratedAt: migrationTime });
    if (!preview.ok) throw new Error(preview.issues.join("\n"));
    expect(preview.data.gm.noteGroups).toHaveLength(1);
    expect(preview.data.gm.noteGroups[0]).toMatchObject({ title: "Trama", notes: [{ title: "Secreto", content: "La puerta está al norte." }] });
    expect(preview.data.gm.noteGroups[0]?.id).toMatch(/^gmg_/);
    expect(preview.data.gm.noteGroups[0]?.notes[0]?.id).toMatch(/^gmn_/);
  });

  it("treats an already-v2 campaign as an idempotent no-op", async () => {
    const first = await previewCampaignMigration(await loadFixture(), {
      campaignId: "fixture-campaign",
      migratedAt: migrationTime,
    });
    if (!first.ok) throw new Error(first.issues.join("\n"));

    const second = await previewCampaignMigration(first.data, {
      campaignId: "ignored-for-v2",
    });
    if (!second.ok) throw new Error(second.issues.join("\n"));

    expect(second.data).toEqual(first.data);
    expect(second.report.sourceVersion).toBe(2);
    expect(second.report.migratedCharacters).toBe(0);
    expect(second.report.warnings).toEqual(["ALREADY_V2"]);
  });

  it("preserves unknown root and character fields", async () => {
    const source = await loadFixture();
    source.futureRootField = { enabled: true };
    const characters = source.characters as JsonObject;
    const legacyCharacter = characters["Personaje Alfa"] as JsonObject;
    legacyCharacter.futureCharacterField = { nested: [1, 2, 3] };

    const preview = await previewCampaignMigration(source, {
      campaignId: "fixture-campaign",
      migratedAt: migrationTime,
    });
    if (!preview.ok) throw new Error(preview.issues.join("\n"));

    const [character] = Object.values(preview.data.characters);
    expect(preview.data.legacy.unmapped.futureRootField).toEqual({ enabled: true });
    expect(character?.legacy.unmapped.futureCharacterField).toEqual({
      nested: [1, 2, 3],
    });
  });

  it("returns validation issues instead of throwing for invalid input", async () => {
    const preview = await previewCampaignMigration(
      { DmNotes: {} },
      { campaignId: "fixture-campaign", migratedAt: migrationTime },
    );

    expect(preview.ok).toBe(false);
    if (preview.ok) return;
    expect(preview.issues.some((issue) => issue.startsWith("characters:"))).toBe(
      true,
    );
  });

  it("rejects missing campaign identity and invalid timestamps", async () => {
    const source = await loadFixture();
    const missingCampaign = await previewCampaignMigration(source, {
      campaignId: " ",
      migratedAt: migrationTime,
    });
    const invalidTime = await previewCampaignMigration(source, {
      campaignId: "fixture-campaign",
      migratedAt: "not-a-date",
    });

    expect(missingCampaign).toEqual({
      ok: false,
      issues: ["campaignId: Required"],
    });
    expect(invalidTime).toEqual({
      ok: false,
      issues: ["migratedAt: Invalid ISO timestamp"],
    });
  });
});
