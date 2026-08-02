import type {
  CampaignRepository,
  CampaignSnapshot,
  SaveExpectation,
} from "../../application/ports/campaign-repository";
import type { CampaignV2 } from "../../domain/character/character-v2";
import {
  assertSaveExpectation,
  createCampaignSnapshot,
  decodeCampaignEnvelope,
  encodeCampaignEnvelope,
} from "./campaign-snapshot";
import {
  defaultExclusiveLock,
  type ExclusiveLock,
} from "./exclusive-lock";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_CAMPAIGN_STORAGE_KEY =
  "talespire-5e-toolset:v2:campaign";

export class LocalStorageCampaignRepository implements CampaignRepository {
  constructor(
    private readonly storage: KeyValueStorage,
    readonly storageKey = DEFAULT_CAMPAIGN_STORAGE_KEY,
    private readonly exclusiveLock: ExclusiveLock = defaultExclusiveLock,
  ) {}

  async load(): Promise<CampaignSnapshot | null> {
    const raw = this.storage.getItem(this.storageKey);
    return raw === null ? null : decodeCampaignEnvelope(raw);
  }

  async save(
    campaign: CampaignV2,
    expectation: SaveExpectation,
  ): Promise<CampaignSnapshot> {
    return this.exclusiveLock.run(`campaign-storage:${this.storageKey}`, async () => {
      // Both the comparison and write must happen under the same lock. An
      // optimistic check outside this boundary still permits two writers to
      // observe the same checksum and overwrite each other.
      const current = await this.load();
      assertSaveExpectation(expectation, current);

      const snapshot = await createCampaignSnapshot(campaign);
      this.storage.setItem(this.storageKey, encodeCampaignEnvelope(snapshot));
      return createCampaignSnapshot(snapshot.campaign);
    });
  }
}
