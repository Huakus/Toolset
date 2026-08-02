import {
  CampaignV2Schema,
  CharacterV2Schema,
  type CampaignV2,
  type CharacterV2,
} from "../../domain/character/character-v2";
import {
  CharacterCorePatchSchema,
  CharacterRevisionConflictError,
  editCharacterCore,
  type CharacterCorePatch,
} from "../../domain/character/edit-character";
import {
  applyCharacterResourceCommand,
  type CharacterResourceCommand,
  type ResourceCommandEffects,
} from "../../domain/character/character-resources";
import { createRandomId } from "../../shared/id";
import {
  CharacterActionDraftSchema,
  removeCharacterAction,
  upsertCharacterAction,
  type CharacterActionDraft,
} from "../../domain/character/character-actions";
import {
  CharacterInventoryItemDraftSchema,
  inventoryItemsCanStack,
  removeInventoryItem,
  resetInventoryCharges,
  setInventoryItemAttuned,
  setInventoryItemEquipped,
  upsertInventoryItem,
  useInventoryItem,
  type CharacterInventoryItemDraft,
  type CharacterInventoryItemV2,
} from "../../domain/character/character-inventory";
import { abilityModifier, projectInventory } from "../../domain/character/character-projection";
import {
  adjustCurrency,
  type CurrencyDenomination,
} from "../../domain/character/character-currency";
import { createCharacter } from "../../domain/character/create-character";
import { cloneJson } from "../../shared/json";
import {
  CharacterSpellDraftSchema,
  castCharacterSpell,
  removeCharacterSpell,
  setCharacterSpellFavorite,
  setCharacterSpellPrepared,
  setSpellcastingSettings,
  setSpellSlots,
  upsertCharacterSpell,
  type CharacterSpellDraft,
} from "../../domain/character/character-spells";
import {
  CharacterExtraDraftSchema,
  CharacterNoteDraftSchema,
  CharacterNoteGroupDraftSchema,
  CharacterTraitDraftSchema,
  CharacterTraitGroupDraftSchema,
  applyExtraHitPoints,
  addExtraCondition,
  removeExtra,
  removeExtraCondition,
  removeNote,
  removeNoteGroup,
  removeTrait,
  removeTraitGroup,
  setTraitUsed,
  upsertExtra,
  upsertNote,
  upsertNoteGroup,
  upsertTrait,
  upsertTraitGroup,
  type CharacterExtraDraft,
  type CharacterNoteDraft,
  type CharacterNoteGroupDraft,
  type CharacterTraitDraft,
  type CharacterTraitGroupDraft,
} from "../../domain/character/character-content";
import {
  previewCampaignMigration,
  type MigrationReport,
} from "../migration/migrate-campaign-v1";
import type {
  CampaignRepository,
  CampaignSnapshot,
  SaveExpectation,
} from "../ports/campaign-repository";
import { CampaignRepositoryConflictError } from "../ports/campaign-repository";

export class CampaignNotFoundError extends Error {
  constructor() {
    super("No campaign is currently stored");
    this.name = "CampaignNotFoundError";
  }
}

export class CharacterNotFoundError extends Error {
  constructor(readonly characterId: string) {
    super(`Character ${characterId} was not found`);
    this.name = "CharacterNotFoundError";
  }
}

export class CampaignAlreadyExistsError extends Error {
  constructor() {
    super("A campaign already exists; replacement must be explicit");
    this.name = "CampaignAlreadyExistsError";
  }
}

export class CampaignImportError extends Error {
  constructor(readonly issues: string[]) {
    super(`Campaign import failed: ${issues.join("; ")}`);
    this.name = "CampaignImportError";
  }
}

export interface ImportCampaignCommand {
  input: unknown;
  campaignId: string;
  migratedAt?: string;
  replaceExisting?: boolean;
}

export interface ImportCampaignResult {
  snapshot: CampaignSnapshot;
  report: MigrationReport;
}

export interface EditCharacterCommand {
  characterId: string;
  expectedCharacterRevision: number;
  expectedCampaignChecksum: string;
  patch: CharacterCorePatch;
  updatedAt?: string;
}

export interface RestoreCharacterStateCommand {
  characterId: string;
  expectedCharacterRevision: number;
  expectedCampaignChecksum: string;
  character: CharacterV2;
  updatedAt?: string;
}

export interface RestoreCharacterStatesCommand {
  expectedCampaignChecksum: string;
  characters: {
    characterId: string;
    expectedCharacterRevision: number;
    character: CharacterV2;
  }[];
  updatedAt?: string;
}

export type CharacterResourceAction =
  | Exclude<CharacterResourceCommand, { kind: "add-condition" }>
  | {
      kind: "add-condition";
      key: string;
      label: string;
      level: number | null;
    };

export interface ApplyCharacterResourceCommand {
  characterId: string;
  expectedCharacterRevision: number;
  expectedCampaignChecksum: string;
  action: CharacterResourceAction;
  updatedAt?: string;
}

export interface ApplyCharacterResourceResult {
  snapshot: CampaignSnapshot;
  effects: ResourceCommandEffects;
}

export interface UpsertCharacterActionCommand {
  characterId: string;
  actionId?: string;
  expectedCharacterRevision: number;
  expectedCampaignChecksum: string;
  action: CharacterActionDraft;
  updatedAt?: string;
}

export interface RemoveCharacterActionCommand {
  characterId: string;
  actionId: string;
  expectedCharacterRevision: number;
  expectedCampaignChecksum: string;
  updatedAt?: string;
}

export interface UpsertInventoryItemCommand {
  characterId: string;
  itemId?: string;
  expectedCharacterRevision: number;
  expectedCampaignChecksum: string;
  item: CharacterInventoryItemDraft;
  updatedAt?: string;
}

export interface InventoryItemCommand {
  characterId: string;
  itemId: string;
  expectedCharacterRevision: number;
  expectedCampaignChecksum: string;
  updatedAt?: string;
}

export interface SetInventoryItemStateCommand extends InventoryItemCommand {
  value: boolean;
}

export interface AdjustInventoryItemQuantityCommand extends InventoryItemCommand {
  delta: -1 | 1;
}

export interface ResetInventoryChargesCommand {
  characterId: string;
  reset: string;
  expectedCharacterRevision: number;
  expectedCampaignChecksum: string;
  updatedAt?: string;
}

export interface TransferCurrencyCommand {
  sourceCharacterId: string;
  targetCharacterId: string;
  denomination: CurrencyDenomination;
  quantity: number;
  expectedSourceRevision: number;
  expectedTargetRevision: number;
  expectedCampaignChecksum: string;
  updatedAt?: string;
}

export interface TransferInventoryItemCommand {
  sourceCharacterId: string;
  targetCharacterId: string;
  itemId: string;
  quantity: number;
  expectedSourceRevision: number;
  expectedTargetRevision: number;
  expectedCampaignChecksum: string;
  updatedAt?: string;
}

export interface UpsertCharacterSpellCommand {
  characterId: string;
  spellId?: string;
  expectedCharacterRevision: number;
  expectedCampaignChecksum: string;
  spell: CharacterSpellDraft;
  updatedAt?: string;
}

export interface CharacterSpellCommand {
  characterId: string;
  spellId: string;
  expectedCharacterRevision: number;
  expectedCampaignChecksum: string;
  updatedAt?: string;
}

export interface SetCharacterSpellPreparedCommand extends CharacterSpellCommand {
  prepared: boolean;
}

export interface SetCharacterSpellFavoriteCommand {
  characterId: string;
  spellName: string;
  favorite: boolean;
  expectedCharacterRevision: number;
  expectedCampaignChecksum: string;
  updatedAt?: string;
}

export interface SetSpellSlotsCommand {
  characterId: string;
  level: number;
  maximum: number;
  used: number;
  expectedCharacterRevision: number;
  expectedCampaignChecksum: string;
  updatedAt?: string;
}

export interface CastCharacterSpellCommand extends CharacterSpellCommand {
  slotLevel: number;
}

export interface SetSpellcastingSettingsCommand {
  characterId: string;
  settings: Pick<CampaignV2["characters"][string]["spellcasting"], "ability" | "selectedLevel" | "showUpcast" | "attackBonus" | "saveDcBonus">;
  expectedCharacterRevision: number;
  expectedCampaignChecksum: string;
  updatedAt?: string;
}

export interface CharacterContentCommandBase {
  characterId: string;
  expectedCharacterRevision: number;
  expectedCampaignChecksum: string;
  updatedAt?: string;
}

export interface UpsertTraitGroupCommand extends CharacterContentCommandBase {
  groupId?: string;
  group: CharacterTraitGroupDraft;
}
export interface TraitGroupCommand extends CharacterContentCommandBase { groupId: string }
export interface UpsertTraitCommand extends TraitGroupCommand { traitId?: string; trait: CharacterTraitDraft }
export interface TraitCommand extends TraitGroupCommand { traitId: string }
export interface SetTraitUsedCommand extends TraitCommand { used: number }
export interface UpsertNoteGroupCommand extends CharacterContentCommandBase { groupId?: string; group: CharacterNoteGroupDraft }
export interface NoteGroupCommand extends CharacterContentCommandBase { groupId: string }
export interface UpsertNoteCommand extends NoteGroupCommand { noteId?: string; note: CharacterNoteDraft }
export interface NoteCommand extends NoteGroupCommand { noteId: string }
export interface UpsertExtraCommand extends CharacterContentCommandBase { extraId?: string; extra: CharacterExtraDraft }
export interface ExtraCommand extends CharacterContentCommandBase { extraId: string }
export interface ApplyExtraHitPointsCommand extends ExtraCommand { action: { kind: "damage" | "heal" | "temporary"; amount: number } }
export interface AddExtraConditionCommand extends ExtraCommand { key: string; label: string; level: number | null }
export interface RemoveExtraConditionCommand extends ExtraCommand { conditionId: string }

export interface CreateCharacterCommand {
  name: string;
  expectedCampaignChecksum: string;
  createdAt?: string;
}

export interface DeleteCharacterCommand {
  characterId: string;
  expectedCampaignChecksum: string;
  updatedAt?: string;
}

export interface ImportCharacterCommand {
  input: unknown;
  fallbackName: string;
  expectedCampaignChecksum: string;
  importedAt?: string;
}

export interface LinkCharacterMiniatureCommand extends CharacterContentCommandBase {
  miniature: CampaignV2["characters"][string]["taleSpire"];
}

export class CampaignApplication {
  constructor(private readonly repository: CampaignRepository) {}

  loadCampaign(): Promise<CampaignSnapshot | null> {
    return this.repository.load();
  }

  async createCampaign(createdAt = new Date().toISOString()): Promise<CampaignSnapshot> {
    if (await this.repository.load()) throw new CampaignAlreadyExistsError();
    const campaign = CampaignV2Schema.parse({
      schemaVersion: 2,
      id: await createRandomId("cmp"),
      revision: 0,
      characters: {},
      legacy: { dmNotes: null, encounterData: null, unmapped: {} },
      metadata: { createdAt, updatedAt: createdAt, migratedFrom: "native" },
    });
    return this.repository.save(campaign, { kind: "empty" });
  }

  async createCharacter(command: CreateCharacterCommand): Promise<CampaignSnapshot> {
    const current = await this.repository.load();
    if (!current) throw new CampaignNotFoundError();
    this.assertCurrentChecksum(current, command.expectedCampaignChecksum);
    const createdAt = command.createdAt ?? new Date().toISOString();
    const character = createCharacter(await createRandomId("chr"), command.name, createdAt);
    return this.persistUpdatedCharacter(current, character, command.expectedCampaignChecksum, createdAt);
  }

  async deleteCharacter(command: DeleteCharacterCommand): Promise<CampaignSnapshot> {
    const current = await this.repository.load();
    if (!current) throw new CampaignNotFoundError();
    this.assertCurrentChecksum(current, command.expectedCampaignChecksum);
    if (!current.campaign.characters[command.characterId]) throw new CharacterNotFoundError(command.characterId);
    const updatedAt = command.updatedAt ?? new Date().toISOString();
    const characters = { ...current.campaign.characters };
    delete characters[command.characterId];
    const campaign = CampaignV2Schema.parse({
      ...current.campaign,
      revision: current.campaign.revision + 1,
      characters,
      metadata: { ...current.campaign.metadata, updatedAt },
    });
    return this.repository.save(campaign, { kind: "checksum", checksum: command.expectedCampaignChecksum });
  }

  async importCharacter(command: ImportCharacterCommand): Promise<CampaignSnapshot> {
    const current = await this.repository.load();
    if (!current) throw new CampaignNotFoundError();
    this.assertCurrentChecksum(current, command.expectedCampaignChecksum);
    const importedAt = command.importedAt ?? new Date().toISOString();
    const direct = CampaignV2Schema.shape.characters.valueType.safeParse(command.input);
    let character: CampaignV2["characters"][string];
    if (direct.success) {
      character = CampaignV2Schema.shape.characters.valueType.parse({
        ...cloneJson(direct.data),
        id: await createRandomId("chr"),
        revision: 0,
        metadata: { createdAt: importedAt, updatedAt: importedAt, migratedFrom: "native" },
      });
    } else {
      const input = command.input !== null && typeof command.input === "object" &&
        Object.hasOwn(command.input, "characters")
        ? command.input
        : command.input !== null && typeof command.input === "object" &&
            Object.values(command.input).some((value) => value !== null && typeof value === "object") &&
            !Object.hasOwn(command.input, "playerClass")
          ? { characters: command.input }
          : { characters: { [command.fallbackName || "Personaje importado"]: command.input } };
      const preview = await previewCampaignMigration(input, {
        campaignId: `character-import-${await createRandomId("src")}`,
        migratedAt: importedAt,
      });
      if (!preview.ok) throw new CampaignImportError(preview.issues);
      const migrated = Object.values(preview.data.characters)[0];
      if (!migrated) throw new CampaignImportError(["No character was found in the imported document"]);
      character = { ...migrated, id: await createRandomId("chr") };
    }
    return this.persistUpdatedCharacter(current, character, command.expectedCampaignChecksum, importedAt);
  }

  async linkCharacterMiniature(command: LinkCharacterMiniatureCommand): Promise<CampaignSnapshot> {
    return this.applyCharacterMutation(command, (character, updatedAt) => {
      if (character.revision !== command.expectedCharacterRevision) {
        throw new CharacterRevisionConflictError(command.expectedCharacterRevision, character.revision);
      }
      return CampaignV2Schema.shape.characters.valueType.parse({
        ...character,
        taleSpire: command.miniature,
        revision: character.revision + 1,
        metadata: { ...character.metadata, updatedAt },
      });
    });
  }

  async importCampaign(
    command: ImportCampaignCommand,
  ): Promise<ImportCampaignResult> {
    const current = await this.repository.load();
    if (current !== null && command.replaceExisting !== true) {
      throw new CampaignAlreadyExistsError();
    }

    const migrationOptions =
      command.migratedAt === undefined
        ? { campaignId: command.campaignId }
        : {
            campaignId: command.campaignId,
            migratedAt: command.migratedAt,
          };
    const preview = await previewCampaignMigration(command.input, migrationOptions);
    if (!preview.ok) {
      throw new CampaignImportError(preview.issues);
    }

    const expectation: SaveExpectation =
      current === null
        ? { kind: "empty" }
        : { kind: "checksum", checksum: current.checksum };
    const snapshot = await this.repository.save(preview.data, expectation);
    return { snapshot, report: preview.report };
  }

  async editCharacter(
    command: EditCharacterCommand,
  ): Promise<CampaignSnapshot> {
    const current = await this.repository.load();
    if (current === null) {
      throw new CampaignNotFoundError();
    }

    // The repository repeats this check during save. Checking here avoids doing
    // domain work against a snapshot that is already known to be obsolete.
    if (current.checksum !== command.expectedCampaignChecksum) {
      throw new CampaignRepositoryConflictError(
        command.expectedCampaignChecksum,
        current.checksum,
      );
    }

    const character = current.campaign.characters[command.characterId];
    if (character === undefined) {
      throw new CharacterNotFoundError(command.characterId);
    }

    const patch = CharacterCorePatchSchema.parse(command.patch);
    const updatedAt = command.updatedAt ?? new Date().toISOString();
    const updatedCharacter = editCharacterCore(character, patch, {
      expectedRevision: command.expectedCharacterRevision,
      updatedAt,
    });
    const campaign: CampaignV2 = CampaignV2Schema.parse({
      ...current.campaign,
      revision: current.campaign.revision + 1,
      characters: {
        ...current.campaign.characters,
        [updatedCharacter.id]: updatedCharacter,
      },
      metadata: {
        ...current.campaign.metadata,
        updatedAt,
      },
    });

    return this.repository.save(campaign, {
      kind: "checksum",
      checksum: command.expectedCampaignChecksum,
    });
  }

  async applyCharacterResource(
    command: ApplyCharacterResourceCommand,
  ): Promise<ApplyCharacterResourceResult> {
    const current = await this.repository.load();
    if (current === null) throw new CampaignNotFoundError();
    if (current.checksum !== command.expectedCampaignChecksum) {
      throw new CampaignRepositoryConflictError(
        command.expectedCampaignChecksum,
        current.checksum,
      );
    }

    const character = current.campaign.characters[command.characterId];
    if (character === undefined) {
      throw new CharacterNotFoundError(command.characterId);
    }

    const updatedAt = command.updatedAt ?? new Date().toISOString();
    const resourceCommand: CharacterResourceCommand =
      command.action.kind === "add-condition"
        ? {
            ...command.action,
            conditionId: await createRandomId("cnd"),
            addedAt: updatedAt,
          }
        : command.action;
    const result = applyCharacterResourceCommand(character, resourceCommand, {
      expectedRevision: command.expectedCharacterRevision,
      updatedAt,
    });
    const campaign = CampaignV2Schema.parse({
      ...current.campaign,
      revision: current.campaign.revision + 1,
      characters: {
        ...current.campaign.characters,
        [result.character.id]: result.character,
      },
      metadata: { ...current.campaign.metadata, updatedAt },
    });
    const snapshot = await this.repository.save(campaign, {
      kind: "checksum",
      checksum: command.expectedCampaignChecksum,
    });
    return { snapshot, effects: result.effects };
  }

  async restoreCharacterState(command: RestoreCharacterStateCommand): Promise<CampaignSnapshot> {
    const current = await this.repository.load();
    if (current === null) throw new CampaignNotFoundError();
    this.assertCurrentChecksum(current, command.expectedCampaignChecksum);
    const currentCharacter = current.campaign.characters[command.characterId];
    if (!currentCharacter) throw new CharacterNotFoundError(command.characterId);
    if (currentCharacter.revision !== command.expectedCharacterRevision) {
      throw new CharacterRevisionConflictError(command.expectedCharacterRevision, currentCharacter.revision);
    }
    if (command.character.id !== command.characterId) {
      throw new Error("The restored character id does not match the target character");
    }
    const updatedAt = command.updatedAt ?? new Date().toISOString();
    const restoredCharacter = CharacterV2Schema.parse({
      ...cloneJson(command.character),
      revision: currentCharacter.revision + 1,
      metadata: { ...command.character.metadata, updatedAt },
    });
    return this.persistUpdatedCharacter(
      current,
      restoredCharacter,
      command.expectedCampaignChecksum,
      updatedAt,
    );
  }

  async restoreCharacterStates(command: RestoreCharacterStatesCommand): Promise<CampaignSnapshot> {
    const current = await this.repository.load();
    if (current === null) throw new CampaignNotFoundError();
    this.assertCurrentChecksum(current, command.expectedCampaignChecksum);
    if (!command.characters.length) throw new Error("At least one character state is required");
    const uniqueIds = new Set(command.characters.map((entry) => entry.characterId));
    if (uniqueIds.size !== command.characters.length) throw new Error("Character states must be unique");
    const updatedAt = command.updatedAt ?? new Date().toISOString();
    const restored = command.characters.map((entry) => {
      const currentCharacter = current.campaign.characters[entry.characterId];
      if (!currentCharacter) throw new CharacterNotFoundError(entry.characterId);
      if (currentCharacter.revision !== entry.expectedCharacterRevision) {
        throw new CharacterRevisionConflictError(entry.expectedCharacterRevision, currentCharacter.revision);
      }
      if (entry.character.id !== entry.characterId) {
        throw new Error("The restored character id does not match the target character");
      }
      return CharacterV2Schema.parse({
        ...cloneJson(entry.character),
        revision: currentCharacter.revision + 1,
        metadata: { ...entry.character.metadata, updatedAt },
      });
    });
    return this.persistUpdatedCharacters(
      current,
      restored,
      command.expectedCampaignChecksum,
      updatedAt,
    );
  }

  async upsertCharacterAction(
    command: UpsertCharacterActionCommand,
  ): Promise<CampaignSnapshot> {
    const current = await this.repository.load();
    if (current === null) throw new CampaignNotFoundError();
    this.assertCurrentChecksum(current, command.expectedCampaignChecksum);
    const character = current.campaign.characters[command.characterId];
    if (!character) throw new CharacterNotFoundError(command.characterId);
    const updatedAt = command.updatedAt ?? new Date().toISOString();
    const draft = CharacterActionDraftSchema.parse(command.action);
    const updatedCharacter = upsertCharacterAction(
      character,
      {
        ...draft,
        id: command.actionId ?? await createRandomId("act"),
      },
      { expectedRevision: command.expectedCharacterRevision, updatedAt },
    );
    return this.persistUpdatedCharacter(
      current,
      updatedCharacter,
      command.expectedCampaignChecksum,
      updatedAt,
    );
  }

  async removeCharacterAction(
    command: RemoveCharacterActionCommand,
  ): Promise<CampaignSnapshot> {
    const current = await this.repository.load();
    if (current === null) throw new CampaignNotFoundError();
    this.assertCurrentChecksum(current, command.expectedCampaignChecksum);
    const character = current.campaign.characters[command.characterId];
    if (!character) throw new CharacterNotFoundError(command.characterId);
    const updatedAt = command.updatedAt ?? new Date().toISOString();
    const updatedCharacter = removeCharacterAction(
      character,
      command.actionId,
      { expectedRevision: command.expectedCharacterRevision, updatedAt },
    );
    return this.persistUpdatedCharacter(
      current,
      updatedCharacter,
      command.expectedCampaignChecksum,
      updatedAt,
    );
  }

  async upsertInventoryItem(
    command: UpsertInventoryItemCommand,
  ): Promise<CampaignSnapshot> {
    const current = await this.loadCurrentForCharacter(
      command.characterId,
      command.expectedCampaignChecksum,
    );
    const character = current.campaign.characters[command.characterId]!;
    const updatedAt = command.updatedAt ?? new Date().toISOString();
    const draft = CharacterInventoryItemDraftSchema.parse(command.item);
    const inventoryCharacter = upsertInventoryItem(
      character,
      { ...draft, id: command.itemId ?? await createRandomId("inv") },
      { expectedRevision: command.expectedCharacterRevision, updatedAt },
    );
    const updatedCharacter = this.itemAffectsArmorClass(draft)
      ? this.withProjectedArmorClass(inventoryCharacter)
      : inventoryCharacter;
    return this.persistUpdatedCharacter(
      current,
      updatedCharacter,
      command.expectedCampaignChecksum,
      updatedAt,
    );
  }

  async removeInventoryItem(
    command: InventoryItemCommand,
  ): Promise<CampaignSnapshot> {
    const current = await this.loadCurrentForCharacter(
      command.characterId,
      command.expectedCampaignChecksum,
    );
    const character = current.campaign.characters[command.characterId]!;
    const removedItem = character.inventory.find((item) => item.id === command.itemId);
    const updatedAt = command.updatedAt ?? new Date().toISOString();
    const inventoryCharacter = removeInventoryItem(character, command.itemId, {
      expectedRevision: command.expectedCharacterRevision,
      updatedAt,
    });
    const updatedCharacter = removedItem && this.itemAffectsArmorClass(removedItem)
      ? this.withProjectedArmorClass(inventoryCharacter)
      : inventoryCharacter;
    return this.persistUpdatedCharacter(
      current,
      updatedCharacter,
      command.expectedCampaignChecksum,
      updatedAt,
    );
  }

  async setInventoryItemEquipped(
    command: SetInventoryItemStateCommand,
  ): Promise<CampaignSnapshot> {
    const current = await this.loadCurrentForCharacter(
      command.characterId,
      command.expectedCampaignChecksum,
    );
    const character = current.campaign.characters[command.characterId]!;
    const item = character.inventory.find((entry) => entry.id === command.itemId);
    const updatedAt = command.updatedAt ?? new Date().toISOString();
    let updatedCharacter = setInventoryItemEquipped(
      character,
      command.itemId,
      command.value,
      {
        expectedRevision: command.expectedCharacterRevision,
        updatedAt,
        ...(command.value && item && item.quantity > 1 ? { splitItemId: await createRandomId("inv") } : {}),
      },
    );
    if (
      command.value &&
      item?.weapon !== null && item?.weapon !== undefined &&
      !updatedCharacter.actions.some((action) => action.inventoryItemId === item.id)
    ) {
      updatedCharacter = upsertCharacterAction(
        updatedCharacter,
        this.actionFromInventoryItem(
          updatedCharacter,
          item,
          await createRandomId("act"),
        ),
        { expectedRevision: updatedCharacter.revision, updatedAt },
      );
    }
    updatedCharacter = this.withProjectedArmorClass(updatedCharacter);
    return this.persistUpdatedCharacter(
      current,
      updatedCharacter,
      command.expectedCampaignChecksum,
      updatedAt,
    );
  }

  async setInventoryItemAttuned(
    command: SetInventoryItemStateCommand,
  ): Promise<CampaignSnapshot> {
    return this.applyCharacterMutation(command, (character, updatedAt) => {
      const item = character.inventory.find((entry) => entry.id === command.itemId);
      const updated = setInventoryItemAttuned(character, command.itemId, command.value, {
        expectedRevision: command.expectedCharacterRevision,
        updatedAt,
      });
      return item && this.itemAffectsArmorClass(item) ? this.withProjectedArmorClass(updated) : updated;
    });
  }

  async useInventoryItem(
    command: InventoryItemCommand,
  ): Promise<CampaignSnapshot> {
    return this.applyCharacterMutation(command, (character, updatedAt) =>
      useInventoryItem(character, command.itemId, {
        expectedRevision: command.expectedCharacterRevision,
        updatedAt,
      }),
    );
  }

  async adjustInventoryItemQuantity(
    command: AdjustInventoryItemQuantityCommand,
  ): Promise<CampaignSnapshot> {
    const current = await this.loadCurrentForCharacter(
      command.characterId,
      command.expectedCampaignChecksum,
    );
    const character = current.campaign.characters[command.characterId]!;
    const item = character.inventory.find((entry) => entry.id === command.itemId);
    if (!item) throw new Error("El objeto ya no está en el inventario.");
    const updatedAt = command.updatedAt ?? new Date().toISOString();
    let updatedCharacter: CharacterV2;
    if (item.equipped) {
      if (command.delta < 0) throw new Error("Desequipá el objeto antes de quitar esa unidad.");
      const looseItem = { ...item, equipped: false, attuned: false };
      const stack = character.inventory.find((entry) => inventoryItemsCanStack(looseItem, entry));
      updatedCharacter = upsertInventoryItem(
        character,
        stack
          ? { ...stack, quantity: stack.quantity + 1 }
          : { ...looseItem, id: await createRandomId("inv"), order: character.inventory.length, quantity: 1 },
        { expectedRevision: character.revision, updatedAt },
      );
    } else if (item.quantity + command.delta <= 0) {
      updatedCharacter = removeInventoryItem(character, item.id, {
        expectedRevision: character.revision,
        updatedAt,
      });
    } else {
      updatedCharacter = upsertInventoryItem(character, {
        ...item,
        quantity: item.quantity + command.delta,
      }, {
        expectedRevision: character.revision,
        updatedAt,
      });
    }
    return this.persistUpdatedCharacter(
      current,
      updatedCharacter,
      command.expectedCampaignChecksum,
      updatedAt,
    );
  }

  async resetInventoryCharges(
    command: ResetInventoryChargesCommand,
  ): Promise<CampaignSnapshot> {
    return this.applyCharacterMutation(command, (character, updatedAt) =>
      resetInventoryCharges(character, command.reset, {
        expectedRevision: command.expectedCharacterRevision,
        updatedAt,
      }),
    );
  }

  async transferCurrency(command: TransferCurrencyCommand): Promise<CampaignSnapshot> {
    const current = await this.repository.load();
    if (current === null) throw new CampaignNotFoundError();
    this.assertCurrentChecksum(current, command.expectedCampaignChecksum);
    if (command.sourceCharacterId === command.targetCharacterId) {
      throw new Error("El personaje de destino debe ser distinto del personaje de origen.");
    }
    if (!Number.isSafeInteger(command.quantity) || command.quantity <= 0) {
      throw new Error("La cantidad a transferir debe ser un entero positivo.");
    }
    const source = current.campaign.characters[command.sourceCharacterId];
    const target = current.campaign.characters[command.targetCharacterId];
    if (!source) throw new CharacterNotFoundError(command.sourceCharacterId);
    if (!target) throw new CharacterNotFoundError(command.targetCharacterId);
    if (source.revision !== command.expectedSourceRevision) {
      throw new CharacterRevisionConflictError(command.expectedSourceRevision, source.revision);
    }
    if (target.revision !== command.expectedTargetRevision) {
      throw new CharacterRevisionConflictError(command.expectedTargetRevision, target.revision);
    }
    const updatedAt = command.updatedAt ?? new Date().toISOString();
    const sourceUpdated = CharacterV2Schema.parse({
      ...source,
      currency: adjustCurrency(source.currency, command.denomination, -command.quantity),
      revision: source.revision + 1,
      metadata: { ...source.metadata, updatedAt },
    });
    const targetUpdated = CharacterV2Schema.parse({
      ...target,
      currency: adjustCurrency(target.currency, command.denomination, command.quantity),
      revision: target.revision + 1,
      metadata: { ...target.metadata, updatedAt },
    });
    return this.persistUpdatedCharacters(
      current,
      [sourceUpdated, targetUpdated],
      command.expectedCampaignChecksum,
      updatedAt,
    );
  }

  async transferInventoryItem(command: TransferInventoryItemCommand): Promise<CampaignSnapshot> {
    const current = await this.repository.load();
    if (current === null) throw new CampaignNotFoundError();
    this.assertCurrentChecksum(current, command.expectedCampaignChecksum);
    if (command.sourceCharacterId === command.targetCharacterId) {
      throw new Error("El personaje de destino debe ser distinto del personaje de origen.");
    }
    if (!Number.isSafeInteger(command.quantity) || command.quantity <= 0) {
      throw new Error("La cantidad a transferir debe ser un entero positivo.");
    }
    const source = current.campaign.characters[command.sourceCharacterId];
    const target = current.campaign.characters[command.targetCharacterId];
    if (!source) throw new CharacterNotFoundError(command.sourceCharacterId);
    if (!target) throw new CharacterNotFoundError(command.targetCharacterId);
    if (source.revision !== command.expectedSourceRevision) {
      throw new CharacterRevisionConflictError(command.expectedSourceRevision, source.revision);
    }
    if (target.revision !== command.expectedTargetRevision) {
      throw new CharacterRevisionConflictError(command.expectedTargetRevision, target.revision);
    }
    const item = source.inventory.find((entry) => entry.id === command.itemId);
    if (!item) throw new Error("El objeto a transferir ya no está en el inventario.");
    if (command.quantity > item.quantity) {
      throw new Error(`Sólo hay ${item.quantity} unidad(es) disponibles de ${item.name}.`);
    }
    const updatedAt = command.updatedAt ?? new Date().toISOString();
    const sourceInventory = command.quantity === item.quantity
      ? removeInventoryItem(source, item.id, {
          expectedRevision: source.revision,
          updatedAt,
        })
      : upsertInventoryItem(source, { ...item, quantity: item.quantity - command.quantity }, {
          expectedRevision: source.revision,
          updatedAt,
        });
    const sourceUpdated = command.quantity === item.quantity && this.itemAffectsArmorClass(item)
      ? this.withProjectedArmorClass(sourceInventory)
      : sourceInventory;
    const transferredItem: CharacterInventoryItemV2 = {
      ...cloneJson(item),
      id: item.id,
      order: target.inventory.length,
      quantity: command.quantity,
      equipped: false,
      attuned: false,
    };
    const targetStack = target.inventory.find((entry) => inventoryItemsCanStack(transferredItem, entry));
    const targetUpdated = upsertInventoryItem(target, targetStack
      ? { ...targetStack, quantity: targetStack.quantity + command.quantity }
      : { ...transferredItem, id: await createRandomId("inv") }, {
      expectedRevision: target.revision,
      updatedAt,
    });
    return this.persistUpdatedCharacters(
      current,
      [sourceUpdated, targetUpdated],
      command.expectedCampaignChecksum,
      updatedAt,
    );
  }

  async upsertCharacterSpell(
    command: UpsertCharacterSpellCommand,
  ): Promise<CampaignSnapshot> {
    const current = await this.loadCurrentForCharacter(
      command.characterId,
      command.expectedCampaignChecksum,
    );
    const character = current.campaign.characters[command.characterId]!;
    const updatedAt = command.updatedAt ?? new Date().toISOString();
    const draft = CharacterSpellDraftSchema.parse(command.spell);
    const updatedCharacter = upsertCharacterSpell(
      character,
      { ...draft, id: command.spellId ?? await createRandomId("spl") },
      { expectedRevision: command.expectedCharacterRevision, updatedAt },
    );
    return this.persistUpdatedCharacter(
      current,
      updatedCharacter,
      command.expectedCampaignChecksum,
      updatedAt,
    );
  }

  async removeCharacterSpell(
    command: CharacterSpellCommand,
  ): Promise<CampaignSnapshot> {
    return this.applyCharacterMutation(command, (character, updatedAt) =>
      removeCharacterSpell(character, command.spellId, {
        expectedRevision: command.expectedCharacterRevision,
        updatedAt,
      }),
    );
  }

  async setCharacterSpellPrepared(
    command: SetCharacterSpellPreparedCommand,
  ): Promise<CampaignSnapshot> {
    return this.applyCharacterMutation(command, (character, updatedAt) =>
      setCharacterSpellPrepared(character, command.spellId, command.prepared, {
        expectedRevision: command.expectedCharacterRevision,
        updatedAt,
      }),
    );
  }

  async setCharacterSpellFavorite(
    command: SetCharacterSpellFavoriteCommand,
  ): Promise<CampaignSnapshot> {
    return this.applyCharacterMutation(command, (character, updatedAt) =>
      setCharacterSpellFavorite(character, command.spellName, command.favorite, {
        expectedRevision: command.expectedCharacterRevision,
        updatedAt,
      }),
    );
  }

  async setSpellSlots(command: SetSpellSlotsCommand): Promise<CampaignSnapshot> {
    return this.applyCharacterMutation(command, (character, updatedAt) =>
      setSpellSlots(
        character,
        command.level,
        { maximum: command.maximum, used: command.used },
        { expectedRevision: command.expectedCharacterRevision, updatedAt },
      ),
    );
  }

  async castCharacterSpell(
    command: CastCharacterSpellCommand,
  ): Promise<CampaignSnapshot> {
    const concentrationConditionId = await createRandomId("cnd");
    return this.applyCharacterMutation(command, (character, updatedAt) =>
      castCharacterSpell(character, command.spellId, command.slotLevel, {
        expectedRevision: command.expectedCharacterRevision,
        updatedAt,
        concentrationCondition: {
          id: concentrationConditionId,
          key: "concentration",
          label: "Concentración",
          level: null,
          addedAt: updatedAt,
        },
      }),
    );
  }

  async setSpellcastingSettings(
    command: SetSpellcastingSettingsCommand,
  ): Promise<CampaignSnapshot> {
    return this.applyCharacterMutation(command, (character, updatedAt) =>
      setSpellcastingSettings(character, command.settings, {
        expectedRevision: command.expectedCharacterRevision,
        updatedAt,
      }),
    );
  }

  async upsertTraitGroup(command: UpsertTraitGroupCommand): Promise<CampaignSnapshot> {
    const groupId = command.groupId ?? await createRandomId("trg");
    return this.applyCharacterMutation(command, (character, updatedAt) => {
      const draft = CharacterTraitGroupDraftSchema.parse(command.group);
      const existingTraits = character.traits.find((group) => group.id === groupId)?.traits ?? [];
      return upsertTraitGroup(character, { ...draft, id: groupId, traits: existingTraits }, {
        expectedRevision: command.expectedCharacterRevision, updatedAt,
      });
    });
  }

  async removeTraitGroup(command: TraitGroupCommand): Promise<CampaignSnapshot> {
    return this.applyCharacterMutation(command, (character, updatedAt) =>
      removeTraitGroup(character, command.groupId, { expectedRevision: command.expectedCharacterRevision, updatedAt }),
    );
  }

  async upsertTrait(command: UpsertTraitCommand): Promise<CampaignSnapshot> {
    const traitId = command.traitId ?? await createRandomId("trt");
    return this.applyCharacterMutation(command, (character, updatedAt) =>
      upsertTrait(character, command.groupId, {
        ...CharacterTraitDraftSchema.parse(command.trait), id: traitId,
      }, { expectedRevision: command.expectedCharacterRevision, updatedAt }),
    );
  }

  async removeTrait(command: TraitCommand): Promise<CampaignSnapshot> {
    return this.applyCharacterMutation(command, (character, updatedAt) =>
      removeTrait(character, command.groupId, command.traitId, { expectedRevision: command.expectedCharacterRevision, updatedAt }),
    );
  }

  async setTraitUsed(command: SetTraitUsedCommand): Promise<CampaignSnapshot> {
    return this.applyCharacterMutation(command, (character, updatedAt) =>
      setTraitUsed(character, command.groupId, command.traitId, command.used, { expectedRevision: command.expectedCharacterRevision, updatedAt }),
    );
  }

  async upsertNoteGroup(command: UpsertNoteGroupCommand): Promise<CampaignSnapshot> {
    const groupId = command.groupId ?? await createRandomId("ntg");
    return this.applyCharacterMutation(command, (character, updatedAt) => {
      const draft = CharacterNoteGroupDraftSchema.parse(command.group);
      const existingNotes = character.notes.find((group) => group.id === groupId)?.notes ?? [];
      return upsertNoteGroup(character, { ...draft, id: groupId, notes: existingNotes }, {
        expectedRevision: command.expectedCharacterRevision, updatedAt,
      });
    });
  }

  async removeNoteGroup(command: NoteGroupCommand): Promise<CampaignSnapshot> {
    return this.applyCharacterMutation(command, (character, updatedAt) =>
      removeNoteGroup(character, command.groupId, { expectedRevision: command.expectedCharacterRevision, updatedAt }),
    );
  }

  async upsertNote(command: UpsertNoteCommand): Promise<CampaignSnapshot> {
    const noteId = command.noteId ?? await createRandomId("not");
    return this.applyCharacterMutation(command, (character, updatedAt) =>
      upsertNote(character, command.groupId, {
        ...CharacterNoteDraftSchema.parse(command.note), id: noteId,
      }, { expectedRevision: command.expectedCharacterRevision, updatedAt }),
    );
  }

  async removeNote(command: NoteCommand): Promise<CampaignSnapshot> {
    return this.applyCharacterMutation(command, (character, updatedAt) =>
      removeNote(character, command.groupId, command.noteId, { expectedRevision: command.expectedCharacterRevision, updatedAt }),
    );
  }

  async upsertExtra(command: UpsertExtraCommand): Promise<CampaignSnapshot> {
    const extraId = command.extraId ?? await createRandomId("ext");
    return this.applyCharacterMutation(command, (character, updatedAt) =>
      upsertExtra(character, { ...CharacterExtraDraftSchema.parse(command.extra), id: extraId }, {
        expectedRevision: command.expectedCharacterRevision, updatedAt,
      }),
    );
  }

  async removeExtra(command: ExtraCommand): Promise<CampaignSnapshot> {
    return this.applyCharacterMutation(command, (character, updatedAt) =>
      removeExtra(character, command.extraId, { expectedRevision: command.expectedCharacterRevision, updatedAt }),
    );
  }

  async applyExtraHitPoints(command: ApplyExtraHitPointsCommand): Promise<CampaignSnapshot> {
    return this.applyCharacterMutation(command, (character, updatedAt) =>
      applyExtraHitPoints(character, command.extraId, command.action, {
        expectedRevision: command.expectedCharacterRevision, updatedAt,
      }),
    );
  }

  async addExtraCondition(command: AddExtraConditionCommand): Promise<CampaignSnapshot> {
    const conditionId = await createRandomId("cnd");
    return this.applyCharacterMutation(command, (character, updatedAt) =>
      addExtraCondition(character, command.extraId, {
        id: conditionId,
        key: command.key,
        label: command.label,
        level: command.level,
        addedAt: updatedAt,
      }, { expectedRevision: command.expectedCharacterRevision, updatedAt }),
    );
  }

  async removeExtraCondition(command: RemoveExtraConditionCommand): Promise<CampaignSnapshot> {
    return this.applyCharacterMutation(command, (character, updatedAt) =>
      removeExtraCondition(character, command.extraId, command.conditionId, {
        expectedRevision: command.expectedCharacterRevision, updatedAt,
      }),
    );
  }

  private async applyCharacterMutation(
    command: {
      characterId: string;
      expectedCampaignChecksum: string;
      updatedAt?: string;
    },
    mutate: (
      character: CampaignV2["characters"][string],
      updatedAt: string,
    ) => CampaignV2["characters"][string],
  ): Promise<CampaignSnapshot> {
    const current = await this.loadCurrentForCharacter(
      command.characterId,
      command.expectedCampaignChecksum,
    );
    const updatedAt = command.updatedAt ?? new Date().toISOString();
    const updatedCharacter = mutate(
      current.campaign.characters[command.characterId]!,
      updatedAt,
    );
    return this.persistUpdatedCharacter(
      current,
      updatedCharacter,
      command.expectedCampaignChecksum,
      updatedAt,
    );
  }

  private async loadCurrentForCharacter(
    characterId: string,
    expectedChecksum: string,
  ): Promise<CampaignSnapshot> {
    const current = await this.repository.load();
    if (current === null) throw new CampaignNotFoundError();
    this.assertCurrentChecksum(current, expectedChecksum);
    if (!current.campaign.characters[characterId]) {
      throw new CharacterNotFoundError(characterId);
    }
    return current;
  }

  private actionFromInventoryItem(
    character: CampaignV2["characters"][string],
    item: CharacterInventoryItemV2,
    actionId: string,
  ): CampaignV2["characters"][string]["actions"][number] {
    const weapon = item.weapon!;
    const finesse = item.properties.includes("finesse");
    const ranged = weapon.range.toLowerCase().includes("ranged");
    const ability = ranged
      ? "dexterity"
      : finesse && character.abilities.dexterity > character.abilities.strength
        ? "dexterity"
        : "strength";
    const proficiencyText = character.proficiencies.weapons.join(" ").toLowerCase();
    const proficient = [weapon.category, item.name]
      .filter(Boolean)
      .some((value) => proficiencyText.includes(value.toLowerCase()));
    const reach = weapon.longRange === null
      ? weapon.normalRange === null ? weapon.range : `${weapon.normalRange} ft`
      : `${weapon.normalRange ?? 0}/${weapon.longRange} ft`;
    return {
      id: actionId,
      order: character.actions.length,
      name: item.name,
      categories: ["attack", "action"],
      activation: "Acción",
      reach,
      ability,
      proficient,
      attackBonus: weapon.attackBonus,
      damageExpression: weapon.damageExpression,
      damageBonus: abilityModifier(character.abilities[ability]) + weapon.damageBonus,
      damageType: weapon.damageType,
      weaponType: weapon.category,
      properties: item.properties.join(", "),
      description: item.description,
      inventoryItemId: item.id,
      rollMode: "normal",
    };
  }

  private assertCurrentChecksum(
    current: CampaignSnapshot,
    expectedChecksum: string,
  ): void {
    if (current.checksum !== expectedChecksum) {
      throw new CampaignRepositoryConflictError(expectedChecksum, current.checksum);
    }
  }

  private withProjectedArmorClass(
    character: CampaignV2["characters"][string],
  ): CampaignV2["characters"][string] {
    return CharacterV2Schema.parse({
      ...character,
      combat: {
        ...character.combat,
        armorClass: projectInventory(character).calculatedArmorClass,
      },
    });
  }

  private itemAffectsArmorClass(item: CharacterInventoryItemDraft): boolean {
    return item.armor !== null || item.category === "armor" || item.category === "shield" ||
      item.bonuses.some((bonus) => bonus.category === "combatStats" && bonus.key === "AC");
  }

  private async persistUpdatedCharacter(
    current: CampaignSnapshot,
    character: CampaignV2["characters"][string],
    expectedChecksum: string,
    updatedAt: string,
  ): Promise<CampaignSnapshot> {
    return this.persistUpdatedCharacters(
      current,
      [character],
      expectedChecksum,
      updatedAt,
    );
  }

  private async persistUpdatedCharacters(
    current: CampaignSnapshot,
    charactersToUpdate: CampaignV2["characters"][string][],
    expectedChecksum: string,
    updatedAt: string,
  ): Promise<CampaignSnapshot> {
    const characters = { ...current.campaign.characters };
    for (const character of charactersToUpdate) characters[character.id] = character;
    const campaign = CampaignV2Schema.parse({
      ...current.campaign,
      revision: current.campaign.revision + 1,
      characters,
      metadata: { ...current.campaign.metadata, updatedAt },
    });
    return this.repository.save(campaign, {
      kind: "checksum",
      checksum: expectedChecksum,
    });
  }
}
