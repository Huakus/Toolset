import { z } from "zod";
import type {
  CampaignRepository,
  CampaignSnapshot,
  SaveExpectation,
} from "../../application/ports/campaign-repository";
import {
  CampaignRepositoryCorruptionError,
} from "../../application/ports/campaign-repository";
import type { CampaignV2 } from "../../domain/character/character-v2";
import { cloneJson, JsonObjectSchema, type JsonObject } from "../../shared/json";
import {
  assertSaveExpectation,
  CampaignEnvelopeSchema,
  createCampaignSnapshot,
  decodeCampaignEnvelope,
  encodeCampaignEnvelope,
} from "./campaign-snapshot";
import {
  defaultExclusiveLock,
  type ExclusiveLock,
} from "./exclusive-lock";
import type { StringBlobStore } from "./string-blob-store";

export const TALESPIRE_CAMPAIGN_STORAGE_LIMIT_BYTES = 5_000_000;
export const V2_CAMPAIGN_BLOB_PROPERTY = "__talespire5eToolsetV2";

const textEncoder = new TextEncoder();

export class CampaignStorageCapacityError extends Error {
  constructor(
    readonly attemptedBytes: number,
    readonly maximumBytes: number,
  ) {
    super(
      `Campaign storage requires ${attemptedBytes} bytes, exceeding the ${maximumBytes} byte limit`,
    );
    this.name = "CampaignStorageCapacityError";
  }
}

export class CampaignStorageVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignStorageVerificationError";
  }
}

export interface CampaignStorageUsage {
  usedBytes: number;
  maximumBytes: number;
}

function parseBlobRoot(raw: string | null): JsonObject {
  if (raw === null) return {};
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    throw new CampaignRepositoryCorruptionError(
      "The TaleSpire campaign blob is not valid JSON",
      { cause: error },
    );
  }

  const parsed = JsonObjectSchema.safeParse(input);
  if (!parsed.success) {
    throw new CampaignRepositoryCorruptionError(
      "The TaleSpire campaign blob root must be a JSON object",
    );
  }
  return parsed.data;
}

async function snapshotFromRoot(root: JsonObject): Promise<CampaignSnapshot | null> {
  const embedded = root[V2_CAMPAIGN_BLOB_PROPERTY];
  if (embedded === undefined) return null;

  const parsed = CampaignEnvelopeSchema.safeParse(embedded);
  if (!parsed.success) {
    throw new CampaignRepositoryCorruptionError(
      `The embedded v2 campaign is invalid: ${parsed.error.issues[0]?.message ?? "unknown error"}`,
    );
  }
  return decodeCampaignEnvelope(JSON.stringify(parsed.data));
}

export class BlobCampaignRepository implements CampaignRepository {
  constructor(
    private readonly store: StringBlobStore,
    private readonly maximumBytes = TALESPIRE_CAMPAIGN_STORAGE_LIMIT_BYTES,
    private readonly exclusiveLock: ExclusiveLock = defaultExclusiveLock,
  ) {}

  async load(): Promise<CampaignSnapshot | null> {
    return snapshotFromRoot(parseBlobRoot(await this.store.getBlob()));
  }

  async readLegacySource(): Promise<JsonObject> {
    const root = cloneJson(parseBlobRoot(await this.store.getBlob()));
    delete root[V2_CAMPAIGN_BLOB_PROPERTY];
    return root;
  }

  async getStorageUsage(): Promise<CampaignStorageUsage> {
    const raw = await this.store.getBlob();
    return {
      usedBytes: raw === null ? 0 : textEncoder.encode(raw).byteLength,
      maximumBytes: this.maximumBytes,
    };
  }

  async save(
    campaign: CampaignV2,
    expectation: SaveExpectation,
  ): Promise<CampaignSnapshot> {
    return this.exclusiveLock.run("talespire-campaign-blob", async () => {
      const root = parseBlobRoot(await this.store.getBlob());
      const current = await snapshotFromRoot(root);
      assertSaveExpectation(expectation, current);

      const snapshot = await createCampaignSnapshot(campaign);
      root[V2_CAMPAIGN_BLOB_PROPERTY] = JSON.parse(
        encodeCampaignEnvelope(snapshot),
      ) as z.infer<typeof CampaignEnvelopeSchema>;
      const serialized = JSON.stringify(root);
      const byteLength = textEncoder.encode(serialized).byteLength;
      if (byteLength > this.maximumBytes) {
        throw new CampaignStorageCapacityError(byteLength, this.maximumBytes);
      }

      await this.store.setBlob(serialized);

      // TaleSpire's API does not provide compare-and-swap. Immediate read-back
      // catches failed, truncated and most externally overwritten writes. Full
      // cross-process reconciliation remains a distributed-protocol concern.
      const verified = await this.load();
      if (verified?.checksum !== snapshot.checksum) {
        throw new CampaignStorageVerificationError(
          `Campaign write verification failed: expected ${snapshot.checksum}, found ${verified?.checksum ?? "empty"}`,
        );
      }
      return verified;
    });
  }
}
