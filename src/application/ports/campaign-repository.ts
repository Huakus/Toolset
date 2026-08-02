import type { CampaignV2 } from "../../domain/character/character-v2";

export interface CampaignSnapshot {
  campaign: CampaignV2;
  checksum: string;
}

export type SaveExpectation =
  | { kind: "empty" }
  | { kind: "checksum"; checksum: string };

export interface CampaignRepository {
  load(): Promise<CampaignSnapshot | null>;
  save(
    campaign: CampaignV2,
    expectation: SaveExpectation,
  ): Promise<CampaignSnapshot>;
}

export class CampaignRepositoryConflictError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string | null,
  ) {
    super(
      `Campaign persistence conflict: expected ${expected}, found ${actual ?? "empty"}`,
    );
    this.name = "CampaignRepositoryConflictError";
  }
}

export class CampaignRepositoryCorruptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CampaignRepositoryCorruptionError";
  }
}
