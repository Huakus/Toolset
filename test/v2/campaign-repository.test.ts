import { describe, expect, it } from "vitest";
import {
  CampaignRepositoryConflictError,
  CampaignRepositoryCorruptionError,
} from "../../src/application/ports/campaign-repository";
import { previewCampaignMigration } from "../../src/application/migration/migrate-campaign-v1";
import { LocalStorageCampaignRepository } from "../../src/infrastructure/persistence/local-storage-campaign-repository";
import { checksumJson } from "../../src/shared/hash";
import { characterColorForId } from "../../src/domain/character/create-character";

class FakeStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

async function campaignFixture() {
  const preview = await previewCampaignMigration(
    { characters: { Test: {} } },
    {
      campaignId: "repository-test",
      migratedAt: "2026-07-25T12:00:00.000Z",
    },
  );
  if (!preview.ok) throw new Error(preview.issues.join("; "));
  return preview.data;
}

describe("LocalStorageCampaignRepository", () => {
  it("round-trips a validated campaign envelope", async () => {
    const storage = new FakeStorage();
    const repository = new LocalStorageCampaignRepository(storage, "test-key");
    const saved = await repository.save(await campaignFixture(), { kind: "empty" });

    expect(await repository.load()).toEqual(saved);
    expect(JSON.parse(storage.values.get("test-key") ?? "{}").format).toBe(
      "talespire-toolset-campaign-v2",
    );
  });

  it("detects payload tampering through the checksum", async () => {
    const storage = new FakeStorage();
    const repository = new LocalStorageCampaignRepository(storage, "test-key");
    await repository.save(await campaignFixture(), { kind: "empty" });

    const envelope = JSON.parse(storage.values.get("test-key") ?? "{}");
    envelope.campaign.revision = 99;
    storage.values.set("test-key", JSON.stringify(envelope));

    await expect(repository.load()).rejects.toBeInstanceOf(
      CampaignRepositoryCorruptionError,
    );
  });

  it("does not expose mutable internal campaign references", async () => {
    const storage = new FakeStorage();
    const repository = new LocalStorageCampaignRepository(storage, "test-key");
    const saved = await repository.save(await campaignFixture(), { kind: "empty" });
    saved.campaign.revision = 100;

    expect((await repository.load())?.campaign.revision).toBe(0);
  });

  it("serializes simultaneous compare-and-save operations", async () => {
    const storage = new FakeStorage();
    const repository = new LocalStorageCampaignRepository(storage, "test-key");
    const initial = await repository.save(await campaignFixture(), { kind: "empty" });
    const firstCandidate = { ...initial.campaign, revision: 1 };
    const secondCandidate = { ...initial.campaign, revision: 2 };

    const results = await Promise.allSettled([
      repository.save(firstCandidate, {
        kind: "checksum",
        checksum: initial.checksum,
      }),
      repository.save(secondCandidate, {
        kind: "checksum",
        checksum: initial.checksum,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected");
    expect(rejection).toMatchObject({
      status: "rejected",
      reason: expect.any(CampaignRepositoryConflictError),
    });
  });

  it("normalizes envelopes written before resource fields were introduced", async () => {
    const storage = new FakeStorage();
    const campaign = await campaignFixture();
    const character = Object.values(campaign.characters)[0];
    if (!character) throw new Error("fixture has no character");
    const oldCampaign = structuredClone(campaign);
    const mutableOldCampaign = oldCampaign as unknown as {
      characters: Record<string, { combat: Record<string, unknown> }>;
    };
    const oldCharacter = Object.values(mutableOldCampaign.characters)[0];
    if (!oldCharacter) throw new Error("fixture has no old character");
    const hitDice = oldCharacter.combat.hitDice as Record<string, unknown>;
    delete hitDice.remaining;
    delete hitDice.maximum;
    delete hitDice.dieSize;
    delete oldCharacter.combat.deathSaves;
    delete oldCharacter.combat.conditions;
    delete (oldCharacter as { checks?: unknown }).checks;
    delete (oldCharacter as { color?: unknown }).color;
    const oldChecksum = await checksumJson(oldCampaign);
    storage.setItem(
      "test-key",
      JSON.stringify({
        format: "talespire-toolset-campaign-v2",
        checksum: oldChecksum,
        campaign: oldCampaign,
      }),
    );

    const repository = new LocalStorageCampaignRepository(storage, "test-key");
    const loaded = await repository.load();
    const normalized = loaded
      ? Object.values(loaded.campaign.characters)[0]
      : undefined;
    expect(normalized?.combat.deathSaves).toEqual({ successes: 0, failures: 0 });
    expect(normalized?.combat.conditions).toEqual([]);
    expect(normalized?.combat.hitDice.dieSize).toBe(8);
    expect(normalized?.checks.skills.perception).toEqual({
      proficiency: 0,
      bonus: 0,
      rollMode: "normal",
    });
    expect(normalized?.color).toBe(characterColorForId(character.id));
    expect(loaded?.checksum).not.toBe(oldChecksum);
  });
});
