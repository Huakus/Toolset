import {
  BlobStoreReadError,
  BlobStoreWriteError,
  type StringBlobStore,
} from "../persistence/string-blob-store";

export interface TaleSpireBlobApi {
  getBlob(): Promise<string | null | undefined>;
  setBlob(value: string): Promise<void>;
}

export interface TaleSpireApiSubset {
  localStorage: {
    campaign: TaleSpireBlobApi;
    global?: TaleSpireBlobApi;
  };
  dice?: {
    putDiceInTray(
      rolls: { name: string; roll: string }[],
      clearBeforeAdding: boolean,
    ): Promise<unknown>;
    evaluateDiceResultsGroup?(group: unknown): Promise<number>;
    sendDiceResult?(groups: unknown[], rollId: string): Promise<unknown>;
  };
  creatures?: {
    getSelectedCreatures(): Promise<unknown>;
    getMoreInfo(ids: string[]): Promise<unknown>;
  };
  contentPacks?: {
    getContentPacks(): Promise<unknown>;
    getMoreInfo(fragments: unknown): Promise<unknown>;
    findBoardObjectInPacks(boardAssetId: string, packs: unknown): Promise<unknown>;
    createThumbnailElementForBoardObject(boardObject: unknown, size: number): Promise<unknown>;
  };
  sync?: {
    send(message: string, target: string): Promise<unknown>;
    getClientsConnected?(): Promise<unknown>;
  };
  clients?: {
    whoAmI(): Promise<unknown>;
    getClientsInThisBoard(): Promise<unknown>;
    getMoreInfo(clients: unknown[]): Promise<unknown>;
    isMe?(clientId: string): Promise<boolean>;
  };
}

export class TaleSpireCampaignBlobStore implements StringBlobStore {
  constructor(private readonly api: TaleSpireBlobApi) {}

  async getBlob(): Promise<string | null> {
    try {
      const value = await this.api.getBlob();
      return typeof value === "string" && value.length > 0 ? value : null;
    } catch (error) {
      throw new BlobStoreReadError(
        "TaleSpire could not read the campaign storage blob",
        { cause: error },
      );
    }
  }

  async setBlob(value: string): Promise<void> {
    try {
      await this.api.setBlob(value);
    } catch (error) {
      throw new BlobStoreWriteError(
        "TaleSpire could not write the campaign storage blob",
        { cause: error },
      );
    }
  }
}

export function detectTaleSpireApi(value: unknown): TaleSpireApiSubset | null {
  if (value === null || typeof value !== "object") return null;
  const localStorage = Reflect.get(value, "localStorage");
  if (localStorage === null || typeof localStorage !== "object") return null;
  const campaign = Reflect.get(localStorage, "campaign");
  if (campaign === null || typeof campaign !== "object") return null;
  if (
    typeof Reflect.get(campaign, "getBlob") !== "function" ||
    typeof Reflect.get(campaign, "setBlob") !== "function"
  ) {
    return null;
  }
  return value as TaleSpireApiSubset;
}
