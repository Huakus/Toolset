import type { CampaignRepository, CampaignSnapshot } from "../ports/campaign-repository";
import { CampaignRepositoryConflictError } from "../ports/campaign-repository";
import { CampaignV2Schema } from "../../domain/character/character-v2";
import { EncounterSchema, type Encounter, type EncounterCombatant } from "../../domain/encounter/encounter-model";
import { applyEncounterCommand, type EncounterCommand, type EncounterCommandResult } from "../../domain/encounter/encounter";
import { createRandomId } from "../../shared/id";
import { migrateLegacyEncounters } from "../migration/migrate-encounters-v1";
import { createDeterministicId } from "../../shared/id";
import type { CharacterSummary } from "../../domain/encounter/encounter-protocol";
import { GmWorkspaceSchema, type GmWorkspace } from "../../domain/gm/gm-workspace";

export class EncounterNotFoundError extends Error {
  constructor(readonly encounterId: string) {
    super(`ENCOUNTER_NOT_FOUND:${encounterId}`);
    this.name = "EncounterNotFoundError";
  }
}

export interface EncounterMutationCommand {
  encounterId: string;
  expectedEncounterRevision: number;
  expectedCampaignChecksum: string;
  action: EncounterCommand;
  updatedAt?: string;
}

export interface RestoreGmControlStateCommand {
  expectedCampaignChecksum: string;
  encounters: Record<string, Encounter>;
  workspace: GmWorkspace;
  updatedAt?: string;
}

export class EncounterApplication {
  constructor(private readonly repository: CampaignRepository) {}

  loadCampaign(): Promise<CampaignSnapshot | null> {
    return this.repository.load();
  }

  async migratePreservedLegacyEncounters(migratedAt = new Date().toISOString()): Promise<CampaignSnapshot | null> {
    const current = await this.repository.load();
    if (!current || Object.keys(current.campaign.encounters).length > 0 || current.campaign.legacy.encounterData === null) return current;
    const encounters = await migrateLegacyEncounters(current.campaign.id, current.campaign.legacy.encounterData, migratedAt);
    if (!Object.keys(encounters).length) return current;
    const campaign = CampaignV2Schema.parse({
      ...current.campaign,
      revision: current.campaign.revision + 1,
      encounters,
      metadata: { ...current.campaign.metadata, updatedAt: migratedAt },
    });
    return this.repository.save(campaign, { kind: "checksum", checksum: current.checksum });
  }

  async createEncounter(name: string, expectedCampaignChecksum: string, createdAt = new Date().toISOString()): Promise<CampaignSnapshot> {
    const current = await this.requireCurrent(expectedCampaignChecksum);
    const encounter = EncounterSchema.parse({
      schemaVersion: 1,
      id: await createRandomId("enc"),
      revision: 0,
      name: name.trim(),
      round: 1,
      activeCombatantId: null,
      combatants: [],
      metadata: { createdAt, updatedAt: createdAt },
    });
    return this.persist(current, { ...current.campaign.encounters, [encounter.id]: encounter }, createdAt);
  }

  async deleteEncounter(encounterId: string, expectedCampaignChecksum: string, updatedAt = new Date().toISOString()): Promise<CampaignSnapshot> {
    const current = await this.requireCurrent(expectedCampaignChecksum);
    if (!current.campaign.encounters[encounterId]) throw new EncounterNotFoundError(encounterId);
    const encounters = { ...current.campaign.encounters };
    delete encounters[encounterId];
    return this.persist(current, encounters, updatedAt);
  }

  async restoreGmControlState(command: RestoreGmControlStateCommand): Promise<CampaignSnapshot> {
    const current = await this.requireCurrent(command.expectedCampaignChecksum);
    const updatedAt = command.updatedAt ?? new Date().toISOString();
    const encounters = Object.fromEntries(
      Object.entries(command.encounters).map(([id, encounter]) => [id, EncounterSchema.parse(encounter)]),
    );
    const campaign = CampaignV2Schema.parse({
      ...current.campaign,
      revision: current.campaign.revision + 1,
      encounters,
      gm: GmWorkspaceSchema.parse(command.workspace),
      metadata: { ...current.campaign.metadata, updatedAt },
    });
    return this.repository.save(campaign, { kind: "checksum", checksum: current.checksum });
  }

  async addCombatant(
    command: Omit<EncounterMutationCommand, "action"> & {
      combatant: Omit<EncounterCombatant, "id" | "order">;
    },
  ): Promise<CampaignSnapshot> {
    const current = await this.requireCurrent(command.expectedCampaignChecksum);
    const encounter = this.requireEncounter(current, command.encounterId);
    const combatant = {
      ...command.combatant,
      id: await createRandomId("cmb"),
      order: encounter.combatants.reduce((maximum, entry) => Math.max(maximum, entry.order), -1) + 1,
    } as EncounterCombatant;
    return (await this.apply({ ...command, action: { kind: "add-combatant", combatant } })).snapshot;
  }

  async apply(command: EncounterMutationCommand): Promise<{ snapshot: CampaignSnapshot; effects: EncounterCommandResult["effects"] }> {
    const current = await this.requireCurrent(command.expectedCampaignChecksum);
    const encounter = this.requireEncounter(current, command.encounterId);
    const updatedAt = command.updatedAt ?? new Date().toISOString();
    const result = applyEncounterCommand(encounter, command.action, {
      expectedRevision: command.expectedEncounterRevision,
      updatedAt,
    });
    const snapshot = await this.persist(
      current,
      { ...current.campaign.encounters, [result.encounter.id]: result.encounter },
      updatedAt,
    );
    return { snapshot, effects: result.effects };
  }

  async updateConnectedPlayer(
    command: Omit<EncounterMutationCommand, "action"> & { combatantId: string; summary: CharacterSummary },
  ): Promise<CampaignSnapshot> {
    const conditions = await Promise.all(command.summary.conditionKeys.map(async (key) => ({
      id: await createDeterministicId("cnd", command.combatantId, key),
      key,
      label: key,
      level: null,
      addedAt: command.updatedAt ?? new Date().toISOString(),
    })));
    return (await this.apply({
      encounterId: command.encounterId,
      expectedEncounterRevision: command.expectedEncounterRevision,
      expectedCampaignChecksum: command.expectedCampaignChecksum,
      ...(command.updatedAt === undefined ? {} : { updatedAt: command.updatedAt }),
      action: {
        kind: "update-combatant-stats",
        combatantId: command.combatantId,
        name: command.summary.name,
        armorClass: command.summary.armorClass,
        hitPoints: {
          current: Math.min(command.summary.currentHitPoints, command.summary.maximumHitPoints),
          maximum: command.summary.maximumHitPoints,
          temporary: command.summary.temporaryHitPoints,
        },
        conditions,
      },
    })).snapshot;
  }

  async addCondition(
    command: Omit<EncounterMutationCommand, "action"> & { combatantId: string; key: string; label: string; level?: number | null },
  ): Promise<CampaignSnapshot> {
    const addedAt = command.updatedAt ?? new Date().toISOString();
    return (await this.apply({
      encounterId: command.encounterId,
      expectedEncounterRevision: command.expectedEncounterRevision,
      expectedCampaignChecksum: command.expectedCampaignChecksum,
      ...(command.updatedAt === undefined ? {} : { updatedAt: command.updatedAt }),
      action: {
        kind: "add-condition",
        combatantId: command.combatantId,
        condition: {
          id: await createRandomId("cnd"),
          key: command.key,
          label: command.label,
          level: command.level ?? null,
          addedAt,
        },
      },
    })).snapshot;
  }

  private async requireCurrent(expectedChecksum: string): Promise<CampaignSnapshot> {
    const current = await this.repository.load();
    if (!current) throw new Error("CAMPAIGN_NOT_FOUND");
    if (current.checksum !== expectedChecksum) throw new CampaignRepositoryConflictError(expectedChecksum, current.checksum);
    return current;
  }

  private requireEncounter(snapshot: CampaignSnapshot, encounterId: string): Encounter {
    const encounter = snapshot.campaign.encounters[encounterId];
    if (!encounter) throw new EncounterNotFoundError(encounterId);
    return encounter;
  }

  private async persist(current: CampaignSnapshot, encounters: Record<string, Encounter>, updatedAt: string): Promise<CampaignSnapshot> {
    const campaign = CampaignV2Schema.parse({
      ...current.campaign,
      revision: current.campaign.revision + 1,
      encounters,
      metadata: { ...current.campaign.metadata, updatedAt },
    });
    return this.repository.save(campaign, { kind: "checksum", checksum: current.checksum });
  }
}
