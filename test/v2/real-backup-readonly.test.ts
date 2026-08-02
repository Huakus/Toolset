import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { previewCampaignMigration } from "../../src/application/migration/migrate-campaign-v1";
import {
  BlobCampaignRepository,
  TALESPIRE_CAMPAIGN_STORAGE_LIMIT_BYTES,
  V2_CAMPAIGN_BLOB_PROPERTY,
} from "../../src/infrastructure/persistence/blob-campaign-repository";
import type { StringBlobStore } from "../../src/infrastructure/persistence/string-blob-store";

const storageDirectory = path.resolve(import.meta.dirname, "../../.localstorage");
const fixedPreviewTime = "2026-07-25T18:30:12.345Z";

describe("real backup migration preview", () => {
  it("validates every discovered character blob without writing it", async () => {
    const entries = await readdir(storageDirectory, { withFileTypes: true });
    let discoveredCharacterBlobs = 0;

    for (const entry of entries) {
      if (!entry.isFile() || entry.name === "global" || path.extname(entry.name)) {
        continue;
      }

      const filePath = path.join(storageDirectory, entry.name);
      const before = await stat(filePath);
      const sourceText = await readFile(filePath, "utf8");
      const parsed = JSON.parse(sourceText) as unknown;

      if (
        parsed === null ||
        typeof parsed !== "object" ||
        !("characters" in parsed)
      ) {
        continue;
      }

      discoveredCharacterBlobs += 1;
      const preview = await previewCampaignMigration(parsed, {
        campaignId: entry.name,
        migratedAt: fixedPreviewTime,
      });
      const after = await stat(filePath);

      expect(preview.ok, preview.ok ? undefined : preview.issues.join("\n")).toBe(
        true,
      );
      if (preview.ok) {
        const simulatedRoot = JSON.parse(sourceText) as Record<string, unknown>;
        delete simulatedRoot[V2_CAMPAIGN_BLOB_PROPERTY];
        let simulatedBlob = JSON.stringify(simulatedRoot);
        const memoryStore: StringBlobStore = {
          getBlob: async () => simulatedBlob,
          setBlob: async (value) => {
            simulatedBlob = value;
          },
        };
        const repository = new BlobCampaignRepository(memoryStore);
        await repository.save(preview.data, { kind: "empty" });
        const usage = await repository.getStorageUsage();
        expect(usage.usedBytes).toBeLessThanOrEqual(
          TALESPIRE_CAMPAIGN_STORAGE_LIMIT_BYTES,
        );
      }
      expect(after.size).toBe(before.size);
      expect(after.mtimeMs).toBe(before.mtimeMs);
    }

    expect(discoveredCharacterBlobs).toBeGreaterThan(0);
  });
});
