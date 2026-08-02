import { CampaignV2Schema } from "../../domain/character/character-v2";
import { GmWorkspaceSchema, type GmWorkspace } from "../../domain/gm/gm-workspace";
import type { CampaignRepository, CampaignSnapshot } from "../ports/campaign-repository";
import { CampaignRepositoryConflictError } from "../ports/campaign-repository";

export class GmWorkspaceApplication {
  constructor(private readonly repository: CampaignRepository) {}

  async save(workspaceInput: GmWorkspace, expectedChecksum: string, updatedAt = new Date().toISOString()): Promise<CampaignSnapshot> {
    const current = await this.repository.load();
    if (!current) throw new Error("CAMPAIGN_NOT_FOUND");
    if (current.checksum !== expectedChecksum) {
      throw new CampaignRepositoryConflictError(expectedChecksum, current.checksum);
    }
    const campaign = CampaignV2Schema.parse({
      ...current.campaign,
      revision: current.campaign.revision + 1,
      gm: GmWorkspaceSchema.parse(workspaceInput),
      metadata: { ...current.campaign.metadata, updatedAt },
    });
    return this.repository.save(campaign, { kind: "checksum", checksum: expectedChecksum });
  }
}
