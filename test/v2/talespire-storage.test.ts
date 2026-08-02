import { describe, expect, it } from "vitest";
import { CampaignApplication } from "../../src/application/campaign/campaign-application";
import { CampaignRepositoryConflictError } from "../../src/application/ports/campaign-repository";
import {
  BlobCampaignRepository,
  CampaignStorageCapacityError,
  CampaignStorageVerificationError,
  V2_CAMPAIGN_BLOB_PROPERTY,
} from "../../src/infrastructure/persistence/blob-campaign-repository";
import type { StringBlobStore } from "../../src/infrastructure/persistence/string-blob-store";
import {
  detectTaleSpireApi,
  TaleSpireCampaignBlobStore,
} from "../../src/infrastructure/talespire/talespire-campaign-blob-store";

class MemoryBlobStore implements StringBlobStore {
  writes = 0;

  constructor(
    public raw: string | null,
    private readonly keepWrites = true,
  ) {}

  async getBlob(): Promise<string | null> {
    return this.raw;
  }

  async setBlob(value: string): Promise<void> {
    this.writes += 1;
    if (this.keepWrites) this.raw = value;
  }
}

const legacyCampaign = {
  characters: {
    Hero: {
      playerClass: "Wizard",
      characterLevel: "3",
      currentCharacterHP: "12",
      maxCharacterHP: "18",
    },
  },
  DmNotes: { chapter: "legacy note" },
  "Encounter Data": { bridge: { round: 2 } },
};

describe("BlobCampaignRepository", () => {
  it("migrates from the current blob and preserves every legacy root", async () => {
    const store = new MemoryBlobStore(JSON.stringify(legacyCampaign));
    const repository = new BlobCampaignRepository(store);
    const application = new CampaignApplication(repository);

    expect(await repository.load()).toBeNull();
    const result = await application.importCampaign({
      input: await repository.readLegacySource(),
      campaignId: "talespire-campaign",
      migratedAt: "2026-07-25T15:00:00.000Z",
    });

    expect(result.report.migratedCharacters).toBe(1);
    expect(await repository.load()).toEqual(result.snapshot);
    const persisted = JSON.parse(store.raw ?? "{}");
    expect(persisted.characters).toEqual(legacyCampaign.characters);
    expect(persisted.DmNotes).toEqual(legacyCampaign.DmNotes);
    expect(persisted["Encounter Data"]).toEqual(legacyCampaign["Encounter Data"]);
    expect(persisted[V2_CAMPAIGN_BLOB_PROPERTY].checksum).toBe(
      result.snapshot.checksum,
    );
    expect(await repository.getStorageUsage()).toEqual({
      usedBytes: new TextEncoder().encode(store.raw ?? "").byteLength,
      maximumBytes: 5_000_000,
    });
  });

  it("applies checksum expectations to the embedded v2 document", async () => {
    const store = new MemoryBlobStore(JSON.stringify(legacyCampaign));
    const repository = new BlobCampaignRepository(store);
    const application = new CampaignApplication(repository);
    const imported = await application.importCampaign({
      input: legacyCampaign,
      campaignId: "conflict-test",
      migratedAt: "2026-07-25T15:00:00.000Z",
    });

    await expect(
      repository.save(imported.snapshot.campaign, {
        kind: "checksum",
        checksum: "0".repeat(64),
      }),
    ).rejects.toBeInstanceOf(CampaignRepositoryConflictError);
  });

  it("rejects oversized blobs before calling TaleSpire", async () => {
    const store = new MemoryBlobStore(JSON.stringify(legacyCampaign));
    const repository = new BlobCampaignRepository(store, 100);
    const application = new CampaignApplication(repository);

    await expect(
      application.importCampaign({
        input: legacyCampaign,
        campaignId: "capacity-test",
        migratedAt: "2026-07-25T15:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(CampaignStorageCapacityError);
    expect(store.writes).toBe(0);
  });

  it("fails when immediate read-back does not contain the written snapshot", async () => {
    const store = new MemoryBlobStore(JSON.stringify(legacyCampaign), false);
    const repository = new BlobCampaignRepository(store);
    const application = new CampaignApplication(repository);

    await expect(
      application.importCampaign({
        input: legacyCampaign,
        campaignId: "verification-test",
        migratedAt: "2026-07-25T15:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(CampaignStorageVerificationError);
  });
});

describe("TaleSpireCampaignBlobStore", () => {
  it("detects and delegates the injected API surface", async () => {
    let raw = "initial";
    const candidate = {
      localStorage: {
        campaign: {
          getBlob: async () => raw,
          setBlob: async (value: string) => {
            raw = value;
          },
        },
      },
    };
    const detected = detectTaleSpireApi(candidate);
    expect(detected).not.toBeNull();
    if (detected === null) return;

    const store = new TaleSpireCampaignBlobStore(detected.localStorage.campaign);
    await store.setBlob("updated");
    expect(await store.getBlob()).toBe("updated");
  });

  it("rejects objects without the required TaleSpire calls", () => {
    expect(detectTaleSpireApi(undefined)).toBeNull();
    expect(detectTaleSpireApi({ localStorage: { campaign: {} } })).toBeNull();
  });
});
