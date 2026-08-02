import {
  CampaignApplication,
  type CharacterResourceAction,
} from "../application/campaign/campaign-application";
import {
  CampaignRepositoryConflictError,
  type CampaignSnapshot,
} from "../application/ports/campaign-repository";
import type { CharacterV2 } from "../domain/character/character-v2";
import { CharacterRevisionConflictError } from "../domain/character/edit-character";
import {
  projectActionAttackModifier,
  projectActionDamageBonus,
  projectCharacterStatistics,
  projectInventory,
  projectSpellcasting,
  projectSpellDamageExpression,
  projectAdjustedRollMode,
} from "../domain/character/character-projection";
import type { CharacterStatisticsProjection, InventoryProjection } from "../domain/character/character-projection";
import {
  SAVE_DEFINITIONS,
  SKILL_DEFINITIONS,
  type CharacterChecks,
  type SaveKey,
  type SkillKey,
} from "../domain/character/character-checks";
import { InsufficientHitDiceError } from "../domain/character/character-resources";
import {
  CURRENCY_DENOMINATIONS,
  currencyFromCopper,
  currencyTotalInCopper,
  type CurrencyDenomination,
} from "../domain/character/character-currency";
import type {
  CharacterActionDraft,
  CharacterActionV2,
} from "../domain/character/character-action-model";
import type {
  CharacterInventoryItemDraft,
  CharacterInventoryItemV2,
} from "../domain/character/character-inventory-model";
import type {
  CharacterSpellDraft,
  CharacterSpellV2,
  SpellDefinition,
} from "../domain/character/character-spell-model";
import type {
  CharacterExtraDraft,
  CharacterNoteDraft,
  CharacterTraitDraft,
} from "../domain/character/character-content-model";
import {
  findSpellDefinitionByName,
  normalizeSpellDefinition,
  spellDefinitionsForLanguage,
} from "../domain/spells/spell-catalog";
import { allMonsterNames, findMonsterByName } from "../domain/monsters/monster-catalog";
import {
  equipmentDefinitionsForLanguage,
  findEquipmentDefinitionByName,
  normalizeEquipmentDefinition,
  type EquipmentCatalogDraft,
} from "../domain/equipment/equipment-catalog";
import { convertDndBeyondCharacter } from "../application/import/dnd-beyond";
import { CampaignStorageCapacityError } from "../infrastructure/persistence/blob-campaign-repository";
import type { CampaignStorageUsage } from "../infrastructure/persistence/blob-campaign-repository";
import type { DiceRoller } from "../application/ports/dice-roller";
import type {
  CharacterSummaryRequest,
  TaleSpireEncounterSyncState,
  TaleSpireInitiativeState,
  TaleSpireTransportDiagnostics,
} from "../infrastructure/talespire/talespire-player-collaboration";

export interface BrowserAppRuntime {
  storageLabel: string;
  storageEventKey?: string;
  loadCurrentCampaignSource?: () => Promise<unknown>;
  loadStorageUsage?: () => Promise<CampaignStorageUsage>;
  diceRoller: DiceRoller;
  selectMiniature?: () => Promise<NonNullable<CharacterV2["taleSpire"]>>;
  createMiniatureThumbnail?: (link: NonNullable<CharacterV2["taleSpire"]>) => Promise<HTMLElement | null>;
  requestInitiativeList?: () => Promise<void>;
  sendInitiative?: (value: number) => Promise<void>;
  sendCharacterSummary?: (character: CharacterV2) => Promise<void>;
  subscribeInitiative?: (listener: (state: TaleSpireInitiativeState) => void) => () => void;
  runSyncTransportProbe?: (messageCharacters: number) => Promise<void>;
  refreshSyncPeers?: () => Promise<void>;
  subscribeTransportDiagnostics?: (listener: (state: TaleSpireTransportDiagnostics) => void) => () => void;
  subscribeCharacterSummaryRequests?: (listener: (request: CharacterSummaryRequest) => void) => () => void;
  respondToCharacterSummaryRequest?: (character: CharacterV2, request: CharacterSummaryRequest) => Promise<void>;
  subscribeEncounterSync?: (listener: (state: TaleSpireEncounterSyncState) => void) => () => void;
  loadCustomContent?: () => Promise<{ spells: SpellDefinition[]; equipment: EquipmentCatalogDraft[] }>;
  saveCustomSpell?: (definition: SpellDefinition) => Promise<void>;
  saveCustomEquipment?: (definition: EquipmentCatalogDraft) => Promise<void>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function preference(key: string, fallback: string): string {
  try { return window.localStorage.getItem(`talespire-5e-toolset:v2:${key}`) ?? fallback; }
  catch { return fallback; }
}

function numberInput(name: string, label: string, value: number, min?: number): string {
  const minimum = min === undefined ? "" : ` min="${min}"`;
  return `<label>${label}<input name="${name}" type="number" step="1"${minimum} value="${value}"></label>`;
}

function textInput(name: string, label: string, value: string): string {
  return `<label>${label}<input name="${name}" value="${escapeHtml(value)}"></label>`;
}

function readInteger(data: FormData, key: string): number {
  const value = data.get(key);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key}: se requiere un número entero`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${key}: debe ser un número entero`);
  }
  return parsed;
}

function readText(data: FormData, key: string): string {
  const value = data.get(key);
  if (typeof value !== "string") throw new Error(`${key}: se requiere texto`);
  return value;
}

function formatError(error: unknown): string {
  if (error instanceof CampaignRepositoryConflictError) {
    return "La campaña cambió desde que abriste el formulario. Se recargó la versión más reciente; revisá tus cambios antes de volver a guardar.";
  }
  if (error instanceof CharacterRevisionConflictError) {
    return "El personaje cambió desde que abriste el formulario. Revisá la versión más reciente antes de volver a guardar.";
  }
  if (error instanceof CampaignStorageCapacityError) {
    const attemptedMb = (error.attemptedBytes / 1_000_000).toFixed(2);
    const maximumMb = (error.maximumBytes / 1_000_000).toFixed(2);
    return `La campaña ocuparía ${attemptedMb} MB y TaleSpire permite ${maximumMb} MB. No se escribió ningún cambio.`;
  }
  if (error instanceof InsufficientHitDiceError) {
    return `No se pueden gastar ${error.requested} dados de golpe; sólo quedan ${error.available}.`;
  }
  return error instanceof Error ? error.message : String(error);
}

const playerConditions = [
  ["blinded", "Cegado"],
  ["charmed", "Hechizado"],
  ["deafened", "Ensordecido"],
  ["frightened", "Asustado"],
  ["grappled", "Agarrado"],
  ["incapacitated", "Incapacitado"],
  ["invisible", "Invisible"],
  ["paralyzed", "Paralizado"],
  ["petrified", "Petrificado"],
  ["poisoned", "Envenenado"],
  ["prone", "Derribado"],
  ["restrained", "Apresado"],
  ["stunned", "Aturdido"],
  ["unconscious", "Inconsciente"],
  ["concentration", "Concentración"],
  ["bless", "Bendición"],
  ["bane", "Perdición"],
  ["guidance", "Guía"],
  ["haste", "Acelerar"],
  ["hex", "Maleficio"],
  ["raging", "Furia"],
] as const;

const ABILITY_ABBREVIATIONS: Record<SaveKey, string> = {
  strength: "FUE",
  dexterity: "DES",
  constitution: "CON",
  intelligence: "INT",
  wisdom: "SAB",
  charisma: "CAR",
};

type CharacterSheetMode = "play" | "edit";
type CharacterSheetTab =
  | "summary"
  | "actions"
  | "spells"
  | "inventory"
  | "traits"
  | "notes"
  | "extras"
  | "initiative";

const characterSheetTabs: readonly { id: CharacterSheetTab; label: string; shortLabel: string }[] = [
  { id: "summary", label: "Resumen", shortLabel: "Resumen" },
  { id: "actions", label: "Acciones y conjuros", shortLabel: "Acciones" },
  { id: "inventory", label: "Inventario", shortLabel: "Equipo" },
  { id: "traits", label: "Rasgos", shortLabel: "Rasgos" },
  { id: "notes", label: "Notas", shortLabel: "Notas" },
  { id: "extras", label: "Extras", shortLabel: "Extras" },
  { id: "initiative", label: "Iniciativa", shortLabel: "Iniciativa" },
];

function sheetModePreference(): CharacterSheetMode {
  return preference("sheet-mode", "play") === "edit" ? "edit" : "play";
}

function sheetTabPreference(): CharacterSheetTab {
  const stored = preference("sheet-tab", "summary");
  if (stored === "spells") return "actions";
  return characterSheetTabs.some((tab) => tab.id === stored)
    ? stored as CharacterSheetTab
    : "summary";
}

function normalizedSearchText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}

function compactCastingTime(value: string): string {
  return value
    .replace(/^1 acci[oó]n adicional$/i, "1AA")
    .replace(/^1 acci[oó]n$/i, "1A")
    .replace(/^1 reacci[oó]n$/i, "1R");
}

function spellSchoolTone(value: string): string {
  const school = normalizedSearchText(value);
  if (school.includes("abjur")) return "abjuration";
  if (school.includes("conjur")) return "conjuration";
  if (school.includes("adivin") || school.includes("divin")) return "divination";
  if (school.includes("encant") || school.includes("enchant")) return "enchantment";
  if (school.includes("evoc")) return "evocation";
  if (school.includes("ilus") || school.includes("illus")) return "illusion";
  if (school.includes("nigrom") || school.includes("necrom")) return "necromancy";
  if (school.includes("transmut")) return "transmutation";
  return "neutral";
}

function spellDamageTone(value: string): string {
  const damage = normalizedSearchText(value);
  if (damage.includes("acid") || damage.includes("acido")) return "acid";
  if (damage.includes("contund") || damage.includes("bludgeon")) return "bludgeoning";
  if (damage.includes("frio") || damage.includes("cold")) return "cold";
  if (damage.includes("fuego") || damage.includes("fire")) return "fire";
  if (damage.includes("fuerza") || damage.includes("force")) return "force";
  if (damage.includes("rayo") || damage.includes("relamp") || damage.includes("lightning")) return "lightning";
  if (damage.includes("necrot") || damage.includes("necroti")) return "necrotic";
  if (damage.includes("perfor") || damage.includes("pierc")) return "piercing";
  if (damage.includes("veneno") || damage.includes("poison")) return "poison";
  if (damage.includes("psiqu") || damage.includes("psychic")) return "psychic";
  if (damage.includes("radiante") || damage.includes("radiant")) return "radiant";
  if (damage.includes("cortante") || damage.includes("slash")) return "slashing";
  if (damage.includes("trueno") || damage.includes("thunder")) return "thunder";
  return "neutral";
}

function inventoryCategoryTone(item: Pick<CharacterInventoryItemV2, "category" | "weapon" | "armor" | "consumable">): string {
  const category = normalizedSearchText(item.category);
  if (item.weapon || category.includes("weapon") || category.includes("arma")) return "weapon";
  if (category.includes("shield") || category.includes("escudo")) return "shield";
  if (item.armor || category.includes("armor") || category.includes("armadura")) return "armor";
  if (item.consumable || category.includes("potion") || category.includes("pocion") || category.includes("scroll") || category.includes("pergamino")) return "consumable";
  if (category.includes("tool") || category.includes("herramienta")) return "tool";
  if (category.includes("mount") || category.includes("vehicle") || category.includes("montura") || category.includes("vehiculo")) return "vehicle";
  if (category.includes("wondrous") || category.includes("maravilloso")) return "wondrous";
  if (category.includes("adventuring") || category.includes("aventura")) return "gear";
  return "other";
}

function inventoryCategoryLabel(item: Pick<CharacterInventoryItemV2, "category" | "weapon" | "armor" | "consumable">): string {
  const labels: Record<string, string> = {
    weapon: "Arma",
    shield: "Escudo",
    armor: "Armadura",
    consumable: "Consumible",
    tool: "Herramienta",
    vehicle: "Montura/vehículo",
    wondrous: "Objeto maravilloso",
    gear: "Equipo",
  };
  return labels[inventoryCategoryTone(item)] ?? (item.category || "Objeto");
}

export function inspiredRollMode(mode: "normal" | "advantage" | "disadvantage"): "normal" | "advantage" {
  return mode === "disadvantage" ? "normal" : "advantage";
}

export function isValidHitPointAmount(value: string | number): boolean {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isInteger(amount) && amount > 0;
}

interface SpellViewEntry {
  spell: CharacterSpellV2;
  known: boolean;
  favorite: boolean;
}

type CombatResolutionKind = "attack" | "damage";

interface ReversibleCharacterAction {
  type: "character";
  id: number;
  label: string;
  characterId: string;
  before: CharacterV2;
  after: CharacterV2;
  relatedCharacters: {
    characterId: string;
    before: CharacterV2;
    after: CharacterV2;
  }[];
  occurredAt: string;
}

interface ReversibleCombatAction {
  type: "combat";
  id: number;
  label: string;
  characterId: string;
  executionKey: string;
  before: CombatResolutionKind[];
  after: CombatResolutionKind[];
  beforeDamage: string | null;
  afterDamage: string | null;
  occurredAt: string;
}

type ReversibleAction = ReversibleCharacterAction | ReversibleCombatAction;

interface SessionActionLogEntry {
  id: number;
  label: string;
  occurredAt: string;
  kind: "action" | "roll" | "undo" | "redo" | "system";
}

export class BrowserApp {
  private snapshot: CampaignSnapshot | null = null;
  private selectedCharacterId: string | null = null;
  private storageUsage: CampaignStorageUsage | null = null;
  private actionFilter = "all";
  private spellFilter = "all";
  private spellPropertyFilters = new Set<string>();
  private includeUnknownSpells = false;
  private spellSearch = "";
  private showSpellDescriptions = preference("spell-descriptions", "shown") !== "hidden";
  private expandedSpellDescriptions = new Set<string>();
  private armedInspirationCharacterIds = new Set<string>();
  private combatExecutions = new Map<string, Set<CombatResolutionKind>>();
  private combatExecutionDamage = new Map<string, string>();
  private undoStacks = new Map<string, ReversibleAction[]>();
  private redoStacks = new Map<string, ReversibleAction[]>();
  private actionLogs = new Map<string, SessionActionLogEntry[]>();
  private nextHistoryId = 1;
  private inventoryFilters = new Set<string>();
  private inventorySearch = "";
  private includeUnownedInventory = false;
  private showInventoryDescriptions = preference("inventory-descriptions", "shown") !== "hidden";
  private expandedInventoryDescriptions = new Set<string>();
  private autoSaveTimer: number | null = null;
  private initiativeState: TaleSpireInitiativeState = { entries: [], activeTurn: null, round: null };
  private transportDiagnostics: TaleSpireTransportDiagnostics | null = null;
  private encounterSyncState: TaleSpireEncounterSyncState | null = null;
  private customSpells: SpellDefinition[] = [];
  private customEquipment: EquipmentCatalogDraft[] = [];
  private theme: "dark" | "light" = preference("theme", "dark") as "dark" | "light";
  private sheetMode: CharacterSheetMode = sheetModePreference();
  private activeSheetTab: CharacterSheetTab = sheetTabPreference();
  private message: { kind: "success" | "error"; text: string } | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly application: CampaignApplication,
    private readonly runtime: BrowserAppRuntime,
  ) {}

  async start(): Promise<void> {
    this.runtime.subscribeCharacterSummaryRequests?.((request) => { void this.respondToCharacterSummaryRequest(request); });
    this.runtime.subscribeInitiative?.((state) => {
      this.initiativeState = state;
      this.render();
    });
    this.runtime.subscribeTransportDiagnostics?.((state) => {
      this.transportDiagnostics = state;
      this.render();
    });
    this.runtime.subscribeEncounterSync?.((state) => {
      this.encounterSyncState = state;
      this.render();
    });
    if (this.runtime.loadCustomContent) {
      try {
        const content = await this.runtime.loadCustomContent();
        this.customSpells = content.spells;
        this.customEquipment = content.equipment;
      } catch (error) {
        this.message = { kind: "error", text: `No se pudo cargar el contenido global: ${formatError(error)}` };
      }
    }
    await this.reload();
    if (this.runtime.storageEventKey !== undefined) {
      window.addEventListener("storage", (event) => {
        if (event.key === this.runtime.storageEventKey) void this.handleExternalChange();
      });
    }
  }

  private async handleExternalChange(): Promise<void> {
    this.undoStacks.clear();
    this.redoStacks.clear();
    this.actionLogs.clear();
    this.combatExecutions.clear();
    this.combatExecutionDamage.clear();
    this.appendActionLog("Historial reversible reiniciado por una actualización externa.", "system");
    this.message = {
      kind: "success",
      text: "Se detectó una actualización local y se recargó la campaña.",
    };
    await this.reload();
  }

  private async reload(): Promise<void> {
    try {
      const [snapshot, storageUsage] = await Promise.all([
        this.application.loadCampaign(),
        this.runtime.loadStorageUsage?.() ?? Promise.resolve(null),
      ]);
      this.snapshot = snapshot;
      this.storageUsage = storageUsage;
      const characters = this.snapshot ? Object.values(this.snapshot.campaign.characters) : [];
      if (
        this.selectedCharacterId === null ||
        !this.snapshot?.campaign.characters[this.selectedCharacterId]
      ) {
        this.selectedCharacterId = characters[0]?.id ?? null;
      }
    } catch (error) {
      this.snapshot = null;
      this.message = { kind: "error", text: formatError(error) };
    }
    this.render();
  }

  private render(): void {
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    const snapshot = this.snapshot;
    document.documentElement.dataset.v2Theme = this.theme;
    const selected = snapshot && this.selectedCharacterId
      ? snapshot.campaign.characters[this.selectedCharacterId] ?? null
      : null;

    this.root.innerHTML = `
      ${this.message
        ? `<p class="message ${this.message.kind}" role="status">${escapeHtml(this.message.text)}</p>`
        : ""}
      ${snapshot ? this.renderWorkspace(snapshot, selected) : `${this.renderCampaignImport(false)}${this.renderWelcome()}`}
    `;
    this.bindEvents();
    if (selected) void this.refreshMiniatureThumbnail(selected);
  }

  private spellCatalog(): readonly SpellDefinition[] {
    const unique = new Map<string, SpellDefinition>();
    for (const spell of [...this.customSpells, ...spellDefinitionsForLanguage("es")]) {
      if ((spell.year || "2014") !== "2014") continue;
      const key = normalizedSearchText(spell.name);
      if (!unique.has(key)) unique.set(key, spell);
    }
    return [...unique.values()];
  }

  private findSpell(name: string): SpellDefinition | null {
    const normalized = name.trim().toLocaleLowerCase();
    return this.customSpells.find((spell) => spell.name.toLocaleLowerCase() === normalized) ??
      findSpellDefinitionByName(name);
  }

  private equipmentCatalog(): readonly EquipmentCatalogDraft[] {
    return [...this.customEquipment, ...equipmentDefinitionsForLanguage("es")];
  }

  private findEquipment(name: string): EquipmentCatalogDraft | null {
    const normalized = name.trim().toLocaleLowerCase();
    return this.customEquipment.find((item) => item.name.toLocaleLowerCase() === normalized) ??
      findEquipmentDefinitionByName(name);
  }

  private renderStorageUsage(): string {
    if (this.storageUsage === null) return "";
    const used = (this.storageUsage.usedBytes / 1_000_000).toFixed(2);
    const maximum = (this.storageUsage.maximumBytes / 1_000_000).toFixed(2);
    return ` · ${used} / ${maximum} MB`;
  }

  private async refreshStorageUsage(): Promise<void> {
    if (this.runtime.loadStorageUsage) {
      this.storageUsage = await this.runtime.loadStorageUsage();
    }
  }

  private async refreshMiniatureThumbnail(character: CharacterV2): Promise<void> {
    if (!character.taleSpire || !this.runtime.createMiniatureThumbnail) return;
    try {
      const thumbnail = await this.runtime.createMiniatureThumbnail(character.taleSpire);
      const container = this.root.querySelector<HTMLElement>("#miniature-thumbnail");
      if (thumbnail && container && this.selectedCharacterId === character.id) {
        container.replaceChildren(thumbnail);
      }
    } catch {
      // The persisted creature link remains useful if a content pack is not
      // currently available, so thumbnail failures are intentionally nonfatal.
    }
  }

  private async linkSelectedMiniature(): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId || !this.runtime.selectMiniature) return;
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    if (!character) return;
    try {
      const miniature = await this.runtime.selectMiniature();
      this.acceptCharacterSnapshot(await this.application.linkCharacterMiniature({
        characterId: character.id,
        expectedCharacterRevision: character.revision,
        expectedCampaignChecksum: this.snapshot.checksum,
        miniature,
      }), "Vincular miniatura");
      this.message = { kind: "success", text: "Miniatura vinculada al personaje." };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private async createCharacter(): Promise<void> {
    if (!this.snapshot) return;
    const input = this.root.querySelector<HTMLInputElement>("#new-character-name");
    try {
      const previousIds = new Set(Object.keys(this.snapshot.campaign.characters));
      this.snapshot = await this.application.createCharacter({
        name: input?.value ?? "",
        expectedCampaignChecksum: this.snapshot.checksum,
      });
      const created = Object.values(this.snapshot.campaign.characters).find((character) => !previousIds.has(character.id));
      this.selectedCharacterId = created?.id ?? this.selectedCharacterId;
      this.message = { kind: "success", text: "Personaje creado." };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private exportCharacter(): void {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    if (!character) return;
    const blob = new Blob([JSON.stringify(character, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${character.name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "character"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private async deleteCharacter(): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    if (!character || !window.confirm(`¿Eliminar a ${character.name}? Esta operación no se puede deshacer desde la hoja.`)) return;
    try {
      this.snapshot = await this.application.deleteCharacter({
        characterId: character.id,
        expectedCampaignChecksum: this.snapshot.checksum,
      });
      this.selectedCharacterId = Object.values(this.snapshot.campaign.characters)[0]?.id ?? null;
      this.message = { kind: "success", text: "Personaje eliminado." };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private async importCharacterFile(event: Event, fromDndBeyond: boolean): Promise<void> {
    if (!this.snapshot) return;
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
    try {
      const raw = JSON.parse(await input.files[0].text()) as unknown;
      const source = fromDndBeyond ? convertDndBeyondCharacter(raw) : raw;
      const previousIds = new Set(Object.keys(this.snapshot.campaign.characters));
      this.snapshot = await this.application.importCharacter({
        input: source,
        fallbackName: input.files[0].name.replace(/\.[^.]+$/, "") || "Personaje importado",
        expectedCampaignChecksum: this.snapshot.checksum,
      });
      const imported = Object.values(this.snapshot.campaign.characters).find((character) => !previousIds.has(character.id));
      this.selectedCharacterId = imported?.id ?? this.selectedCharacterId;
      this.message = { kind: "success", text: fromDndBeyond ? "Personaje de D&D Beyond convertido e importado." : "Personaje importado." };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private async importCharacterClipboard(): Promise<void> {
    if (!this.snapshot) return;
    try {
      const source = JSON.parse(await navigator.clipboard.readText()) as unknown;
      const previousIds = new Set(Object.keys(this.snapshot.campaign.characters));
      this.snapshot = await this.application.importCharacter({
        input: source,
        fallbackName: "Personaje del creador",
        expectedCampaignChecksum: this.snapshot.checksum,
      });
      const imported = Object.values(this.snapshot.campaign.characters).find((character) => !previousIds.has(character.id));
      this.selectedCharacterId = imported?.id ?? this.selectedCharacterId;
      this.message = { kind: "success", text: "Personaje importado desde el portapapeles." };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: `No se pudo importar el portapapeles: ${formatError(error)}` };
      this.render();
    }
  }

  private renderWelcome(): string {
    return `<section class="welcome"><h2>La aplicación está vacía</h2><p>Podés comenzar una campaña nueva o importar una copia JSON del almacenamiento legado.</p><button type="button" id="create-empty-campaign">Crear campaña nueva</button></section>`;
  }

  private renderCampaignImport(replacing: boolean): string {
    return `<details class="import-panel" ${replacing ? "" : "open"}>
      <summary>${replacing ? "Reemplazar campaña" : "Importar backup legado"}</summary>
      <form id="import-form" class="import-form">
        ${textInput("campaignId", "Identificador", "campaña-local")}
        <label>Archivo JSON<input name="campaignFile" type="file" required></label>
        ${replacing ? '<label class="checkbox"><input name="replaceExisting" type="checkbox"> Confirmo el reemplazo</label>' : ""}
        <button type="submit">Importar</button>
        ${this.runtime.loadCurrentCampaignSource ? '<button id="import-current-campaign" class="secondary-button" type="button">Migrar campaña actual</button>' : ""}
      </form>
    </details>`;
  }

  private renderWorkspace(snapshot: CampaignSnapshot, selected: CharacterV2 | null): string {
    return `<main class="editor">${selected ? this.renderCharacterForm(selected) : `<div class="sheet-empty"><p>No hay personajes.</p>${this.renderCharacterManagement()}</div>`}</main>`;
  }

  private renderCharacterManagement(): string {
    return `<div class="character-management">
      <label>Nuevo personaje<input id="new-character-name" placeholder="Nombre"></label>
      <button type="button" class="secondary-button" id="create-character">Crear</button>
      <label>Importar personaje<input id="import-character-file" type="file" accept="application/json,.json"></label>
      <label>Importar D&D Beyond<input id="import-ddb-file" type="file" accept="application/json,.json"></label>
      <button type="button" class="secondary-button" id="import-character-clipboard">Pegar JSON</button>
      <a class="secondary-button" href="CharacterCreator/CharacterCreator.html">Creador guiado</a>
    </div>`;
  }

  private renderCharacterForm(character: CharacterV2): string {
    const projection = projectCharacterStatistics(character);
    const signed = (value: number): string => value >= 0 ? `+${value}` : String(value);
    const initiativeMode = projectAdjustedRollMode(character, "skills", ["Initiative"], character.checks.initiative.rollMode);
    const characters = Object.values(this.snapshot?.campaign.characters ?? {}).sort((a, b) => a.name.localeCompare(b.name));
    const characterColors = ["#c98282", "#d09a68", "#c5ad6a", "#79a879", "#6fae9f", "#6f96c4", "#8f83bc", "#c982a6", "#9a73ad", "#9da79a"];
    return `
      <section class="character-sheet-shell" data-sheet-mode="${this.sheetMode}" style="--character-color:${character.color}">
        <header class="sheet-hero" style="border-top-color:${character.color}">
          <div id="miniature-thumbnail" class="miniature-thumbnail sheet-portrait"></div>
          <div class="sheet-identity">
            <select id="character-title-select" aria-label="Personaje seleccionado" style="border-left-color:${character.color}">${characters.map((entry) => `<option value="${entry.id}" ${entry.id === character.id ? "selected" : ""} style="color:${entry.color}">● ${escapeHtml(entry.name)}</option>`).join("")}</select>
            <span>${escapeHtml(character.identity.className || "Sin clase")} · nivel ${character.identity.level}</span>
          </div>
          <div class="hero-vitals sheet-hero-secondary" aria-label="Estadísticas rápidas">
            <div class="hero-hit-points" title="${character.combat.hitPoints.current} PG + ${character.combat.hitPoints.temporary} temporales"><span>PG total</span><strong>${character.combat.hitPoints.current + character.combat.hitPoints.temporary}<small> / ${character.combat.hitPoints.maximum}</small></strong></div>
            <div><span>CA</span><strong>${character.combat.armorClass}</strong></div>
            <button type="button" class="header-stat-button hero-initiative roll-button" data-roll-name="Iniciativa: ${escapeHtml(character.name)}" data-roll-expression="1d20${signed(projection.initiativeModifier)}" data-roll-mode="${initiativeMode}"><span>INIC</span><strong>${signed(projection.initiativeModifier)}</strong></button>
            ${this.renderInspirationButton(character)}
            ${this.renderCurrencyIndicator(character)}
            <div class="hero-rest-buttons"><button type="button" class="header-stat-button hero-rest-button" data-resource-action="short-rest" title="Descanso corto"><span>Descanso</span><strong>corto</strong></button><button type="button" class="header-stat-button hero-rest-button" data-resource-action="long-rest" title="Descanso largo"><span>Descanso</span><strong>largo</strong></button></div>
          </div>
          <div class="sheet-header-controls">
            <div class="compact-header-actions"><details class="color-picker"><summary title="Cambiar color del personaje"><span>Color</span><i style="--swatch-color:${character.color}" aria-hidden="true"></i></summary><div class="color-picker-menu"><div class="color-palette" role="group" aria-label="Colores sugeridos">${characterColors.map((color) => `<button type="button" class="color-swatch ${color.toLowerCase() === character.color.toLowerCase() ? "active" : ""}" style="--swatch-color:${color}" data-character-color-value="${color}" aria-label="Usar color ${color}" aria-pressed="${color.toLowerCase() === character.color.toLowerCase()}"></button>`).join("")}</div><div class="color-custom-row"><label><span>Hexadecimal</span><input id="character-color" type="text" value="${character.color}" maxlength="7" spellcheck="false" aria-label="Color hexadecimal" placeholder="#RRGGBB"></label><button type="button" id="apply-character-color">Aplicar</button></div></div></details>${this.renderActionHistoryControls()}<div class="mode-switch" role="group" aria-label="Modo de la hoja">
              <button type="button" data-sheet-mode-choice="play" class="${this.sheetMode === "play" ? "active" : ""}" aria-pressed="${this.sheetMode === "play"}">Juego</button>
              <button type="button" data-sheet-mode-choice="edit" class="${this.sheetMode === "edit" ? "active" : ""}" aria-pressed="${this.sheetMode === "edit"}">Edición</button>
            </div></div>
            <details class="sheet-menu"><summary>⋯</summary><div>
              <label>Tema<select id="theme"><option value="dark" ${this.theme === "dark" ? "selected" : ""}>Oscuro</option><option value="light" ${this.theme === "light" ? "selected" : ""}>Claro</option></select></label>
              ${this.runtime.selectMiniature ? '<button type="button" class="secondary-button" id="link-miniature">Vincular mini</button>' : ""}
              <button type="button" class="secondary-button" id="export-character">Exportar personaje</button>
              <button type="button" class="secondary-button danger" id="delete-character">Eliminar personaje</button>
              <details class="menu-section"><summary>Administrar personajes</summary>${this.renderCharacterManagement()}</details>
              ${this.renderTransportDiagnostics()}
              ${this.renderCampaignImport(true)}
            </div></details>
          </div>
        </header>
        <nav class="sheet-tabs" aria-label="Secciones de la hoja">
          ${characterSheetTabs.map((tab) => `<button type="button" data-sheet-tab="${tab.id}" class="sheet-tab-button ${this.activeSheetTab === tab.id ? "active" : ""}" aria-current="${this.activeSheetTab === tab.id ? "page" : "false"}"><span>${tab.label}</span><small>${tab.shortLabel}</small></button>`).join("")}
        </nav>
        <div class="sheet-panel" data-active-sheet-tab="${this.activeSheetTab}">
          ${this.renderActiveCharacterTab(character, projection)}
        </div>
      </section>`;
  }

  private renderInspirationButton(character: CharacterV2): string {
    const inspirationArmed = character.combat.inspiration && this.armedInspirationCharacterIds.has(character.id);
    const inspirationState = !character.combat.inspiration ? "inactive" : inspirationArmed ? "armed" : "available";
    const inspirationAction = !character.combat.inspiration ? "Activar" : inspirationArmed ? "Desactivar" : "Usar";
    return `<button type="button" class="inspiration-button hero-inspiration ${inspirationState}" data-resource-action="inspiration" aria-pressed="${inspirationArmed}" title="${inspirationArmed ? "La próxima tirada d20 compatible se hará con inspiración" : `${inspirationAction} inspiración`}"><span>Inspiración</span><strong>${inspirationAction}</strong>${inspirationArmed ? "<small>Próxima tirada</small>" : ""}</button>`;
  }

  private renderCurrencyIndicator(character: CharacterV2): string {
    const totalInCopper = currencyTotalInCopper(character.currency);
    const normalizedCurrency = currencyFromCopper(totalInCopper);
    const visibleCoins = CURRENCY_DENOMINATIONS
      .filter((denomination) => normalizedCurrency[denomination.key] > 0);
    const compactValue = (visibleCoins.length ? visibleCoins : [CURRENCY_DENOMINATIONS.at(-1)!])
      .map((denomination) => `<span data-coin-kind="${denomination.key}" title="${denomination.label}"><strong>${normalizedCurrency[denomination.key]}</strong><small>${denomination.abbreviation}</small></span>`)
      .join("");
    const compactLabel = (visibleCoins.length ? visibleCoins : [CURRENCY_DENOMINATIONS.at(-1)!])
      .map((denomination) => `${normalizedCurrency[denomination.key]} ${denomination.abbreviation}`)
      .join(", ");
    return `<div class="hero-currency-indicator" aria-label="Monedas: ${compactLabel}" title="${compactLabel}"><small>Monedas</small><span class="currency-compact-value">${compactValue}</span></div>`;
  }

  private renderActionHistoryControls(): string {
    const characterId = this.selectedCharacterId;
    const undoStack = characterId ? this.undoStacks.get(characterId) ?? [] : [];
    const redoStack = characterId ? this.redoStacks.get(characterId) ?? [] : [];
    const actionLog = characterId ? this.actionLogs.get(characterId) ?? [] : [];
    const entries = actionLog.slice(-20).reverse();
    return `<div class="action-history-controls" aria-label="Historial de acciones del personaje"><button type="button" data-history-action="undo" title="Deshacer última acción de este personaje" aria-label="Deshacer última acción de este personaje" ${undoStack.length ? "" : "disabled"}>↶</button><button type="button" data-history-action="redo" title="Rehacer última acción de este personaje" aria-label="Rehacer última acción de este personaje" ${redoStack.length ? "" : "disabled"}>↷</button><details class="action-log"><summary title="Ver historial de este personaje">Log${actionLog.length ? ` ${actionLog.length}` : ""}</summary><div>${entries.length ? `<ol>${entries.map((entry) => `<li data-log-kind="${entry.kind}"><time>${entry.occurredAt.slice(11, 19)}</time><span>${escapeHtml(entry.label)}</span></li>`).join("")}</ol>` : '<p>Sin acciones registradas para este personaje.</p>'}</div></details></div>`;
  }

  private renderTransportDiagnostics(): string {
    if (!this.runtime.runSyncTransportProbe || !this.runtime.subscribeTransportDiagnostics) return "";
    const diagnostics = this.transportDiagnostics;
    const probes = diagnostics?.probes.slice(-12).reverse() ?? [];
    const statusLabel = (status: TaleSpireTransportDiagnostics["probes"][number]["status"]): string => ({
      pending: "Esperando",
      received: "Recibido",
      failed: "Falló",
      timeout: "Sin respuesta",
    })[status];
    const formatCharacters = (characters: number): string => `${characters} car.`;
    return `<details class="menu-section sync-diagnostics"><summary>Diagnóstico de sincronización</summary><div>
      <p>Cliente: <strong>${escapeHtml(diagnostics?.ownClientId ?? "sin identificar")}</strong> · Pares compatibles: <strong>${diagnostics?.peers.length ?? 0}</strong></p>
      <div class="sync-peer-list">${diagnostics?.peers.length ? diagnostics.peers.map((peer) => `<span>${escapeHtml(peer.label)} <small>${escapeHtml(peer.clientMode)}</small></span>`).join("") : '<span class="muted">No hay otros clientes con este symbiote conectado. El compañero debe abrirlo o dejarlo ejecutándose en segundo plano.</span>'}</div>
      <p>Límite observado: 500 caracteres · techo recomendado: 480.</p>
      <div class="sync-probe-controls"><select id="sync-probe-size" aria-label="Caracteres del mensaje de prueba"><option value="256">256 caracteres</option><option value="384">384 caracteres</option><option value="480" selected>480 caracteres</option><option value="500">500 caracteres (límite)</option></select><button type="button" id="run-sync-probe" ${diagnostics?.peers.length ? "" : "disabled"}>Probar transporte</button><button type="button" class="secondary-button" id="refresh-sync-peers">Actualizar clientes</button></div>
      <div class="sync-probe-results">${probes.length ? probes.map((probe) => `<div data-probe-status="${probe.status}"><strong>${escapeHtml(probe.targetLabel)}</strong><span>${formatCharacters(probe.sentCharacters)} → ${probe.receivedCharacters === null ? "—" : formatCharacters(probe.receivedCharacters)}</span><span>${statusLabel(probe.status)}</span><span>${probe.roundTripMs === null ? "—" : `${probe.roundTripMs} ms`}</span>${probe.error ? `<small>${escapeHtml(probe.error)}</small>` : ""}</div>`).join("") : '<p class="muted">Todavía no se ejecutaron pruebas.</p>'}</div>
    </div></details>`;
  }

  private renderCurrencyResourceControl(character: CharacterV2): string {
    const targets = this.transferTargetOptions(character.id);
    const normalizedCurrency = currencyFromCopper(currencyTotalInCopper(character.currency));
    const currencyControls = CURRENCY_DENOMINATIONS.map((denomination) => `<div class="currency-denomination-control" data-currency-control="${denomination.key}">
      <strong data-coin-kind="${denomination.key}" title="${denomination.label}"><span>${denomination.abbreviation}</span><small>${normalizedCurrency[denomination.key]}</small></strong>
      <input data-currency-amount="${denomination.key}" type="number" min="0" step="1" value="0" aria-label="Cantidad de ${denomination.label.toLowerCase()}">
    </div>`).join("");
    return `<details class="currency-manager">
      <summary class="inventory-utility-button">Monedas</summary>
      <div class="currency-manager-popover"><header><strong>Gestor de monedas</strong><small>Completá una o más cantidades y elegí una acción.</small></header><div class="currency-denomination-grid" aria-label="Gestor de monedas">${currencyControls}</div><label class="currency-transfer-target">Destinatario<select data-currency-batch-target><option value="">Seleccionar personaje…</option>${targets}</select></label><footer><button type="button" data-currency-batch-action="add" disabled>Agregar</button><button type="button" data-currency-batch-action="remove" disabled>Quitar</button><button type="button" data-currency-batch-action="transfer" disabled>Transferir</button><button type="button" data-reset-currency-controls>Resetear</button><button type="button" data-close-currency-manager>Cerrar</button></footer></div>
      <datalist id="equipment-catalog-names">${this.equipmentCatalog().map((item) => `<option value="${escapeHtml(item.name)}"></option>`).join("")}</datalist>
    </details>`;
  }

  private renderInventoryAttunementControl(character: CharacterV2, projection: InventoryProjection): string {
    const attunedItems = character.inventory.filter((item) => item.attuned);
    const pendingItems = character.inventory.filter((item) => item.requiresAttunement && item.equipped && !item.attuned);
    const available = Math.max(0, projection.maximumAttuned - projection.attuned);
    const itemList = (items: CharacterInventoryItemV2[]) => items.length
      ? `<ul>${items.map((item) => `<li>${escapeHtml(item.name)}</li>`).join("")}</ul>`
      : '<p class="muted">Ninguno.</p>';
    return `<details class="inventory-attunement-control"><summary class="inventory-utility-button" title="${available} espacios de sintonización libres">Sintonización <strong>${projection.attuned}/${projection.maximumAttuned}</strong></summary><div><p><strong>${available}</strong> espacios libres. Equipá un objeto que la requiera y usá <em>Sintonizar</em> en su tarjeta.</p><section><strong>Sintonizados</strong>${itemList(attunedItems)}</section>${pendingItems.length ? `<section><strong>Equipados pendientes</strong>${itemList(pendingItems)}</section>` : ""}</div></details>`;
  }

  private transferTargetOptions(sourceCharacterId: string): string {
    if (!this.snapshot) return "";
    return Object.values(this.snapshot.campaign.characters)
      .filter((character) => character.id !== sourceCharacterId)
      .sort((left, right) => left.name.localeCompare(right.name, "es", { sensitivity: "base" }))
      .map((character) => `<option value="${character.id}">${escapeHtml(character.name)}</option>`)
      .join("");
  }

  private renderConditionToggles(character: CharacterV2): string {
    const activeByKey = new Map(character.combat.conditions.map((condition) => [condition.key, condition]));
    const available = new Map<string, string>(playerConditions.map(([key, label]) => [key, label]));
    for (const condition of character.combat.conditions) {
      if (!available.has(condition.key)) available.set(condition.key, condition.label);
    }
    const conditions = [...available].map(([key, label]) => ({ key, label, active: activeByKey.get(key) ?? null }))
      .sort((left, right) => Number(!left.active) - Number(!right.active) || left.label.localeCompare(right.label, "es", { sensitivity: "base" }));
    return `<div class="condition-toggle-panel" aria-label="Condiciones"><small>Condiciones</small><div class="condition-toggle-list">${conditions.map(({ key, label, active }) => `<button type="button" class="condition-toggle ${active ? "active" : ""}" data-toggle-condition="${escapeHtml(key)}" data-condition-label="${escapeHtml(label)}" ${active ? `data-condition-id="${active.id}"` : ""} aria-pressed="${!!active}" title="${active ? "Desactivar" : "Activar"} ${escapeHtml(label)}">${escapeHtml(label)}</button>`).join("")}</div></div>`;
  }

  private renderActiveCharacterTab(
    character: CharacterV2,
    projection: CharacterStatisticsProjection,
  ): string {
    if (this.activeSheetTab === "summary") {
      return this.sheetMode === "edit"
        ? this.renderSummaryEditor(character, projection)
        : this.renderSummaryPlay(character, projection);
    }
    if (this.activeSheetTab === "actions" || this.activeSheetTab === "spells") {
      return this.sheetMode === "edit"
        ? `<div class="actions-spells-editor"><div class="spell-discovery combined-search">${this.renderSpellSearchRow(false)}</div>${this.renderActions(character)}${this.renderSpells(character, false)}</div>`
        : `<section class="play-section collection-play actions-spells-workspace"><div class="spell-discovery combined-search">${this.renderSpellSearchRow()}</div>${this.renderActionsPlay(character, true)}${this.renderSpellsPlay(character, true, false)}</section>`;
    }
    if (this.activeSheetTab === "inventory") return this.sheetMode === "edit" ? this.renderInventory(character) : this.renderInventoryPlay(character);
    if (this.activeSheetTab === "traits") return this.sheetMode === "edit" ? this.renderTraits(character) : this.renderTraitsPlay(character);
    if (this.activeSheetTab === "notes") return this.sheetMode === "edit" ? this.renderNotes(character) : this.renderNotesPlay(character);
    if (this.activeSheetTab === "extras") return this.sheetMode === "edit" ? this.renderExtras(character) : this.renderExtrasPlay(character);
    return this.renderInitiativePanel(character, projection) || this.renderEmptyPanel("La colaboración de iniciativa no está disponible en este entorno.");
  }

  private renderSummaryEditor(character: CharacterV2, projection: CharacterStatisticsProjection): string {
    const signed = (value: number): string => value >= 0 ? `+${value}` : String(value);
    return `<form id="character-form" class="summary-editor" data-character-id="${character.id}" data-character-revision="${character.revision}"><input type="hidden" name="color" value="${character.color}">
        <div class="section-heading"><div><p class="eyebrow">Datos fundamentales</p><h2>Editar resumen</h2></div><button type="submit">Guardar cambios</button></div>
        <fieldset><legend>Identidad</legend><div class="field-grid">
          ${textInput("name", "Nombre", character.name)}
          ${textInput("className", "Clase", character.identity.className)}
          ${numberInput("level", "Nivel", character.identity.level, 0)}
          ${numberInput("experience", "Experiencia", character.identity.experience, 0)}
          ${textInput("alignment", "Alineamiento", character.identity.alignment)}
        </div></fieldset>
        <fieldset><legend>Características</legend><div class="field-grid compact">
          ${numberInput("strength", `FUE ${signed(projection.abilityModifiers.strength)}`, character.abilities.strength)}
          ${numberInput("dexterity", `DES ${signed(projection.abilityModifiers.dexterity)}`, character.abilities.dexterity)}
          ${numberInput("constitution", `CON ${signed(projection.abilityModifiers.constitution)}`, character.abilities.constitution)}
          ${numberInput("intelligence", `INT ${signed(projection.abilityModifiers.intelligence)}`, character.abilities.intelligence)}
          ${numberInput("wisdom", `SAB ${signed(projection.abilityModifiers.wisdom)}`, character.abilities.wisdom)}
          ${numberInput("charisma", `CAR ${signed(projection.abilityModifiers.charisma)}`, character.abilities.charisma)}
        </div></fieldset>
        ${this.renderChecks(character, projection)}
        <fieldset><legend>Competencias adicionales</legend><div class="field-grid">
          <label>Armas<textarea name="proficiencyWeapons" placeholder="Una por línea o separadas por coma">${escapeHtml(character.proficiencies.weapons.join("\n"))}</textarea></label>
          <label>Armaduras<textarea name="proficiencyArmor" placeholder="Una por línea o separadas por coma">${escapeHtml(character.proficiencies.armor.join("\n"))}</textarea></label>
          <label>Idiomas<textarea name="proficiencyLanguages" placeholder="Uno por línea o separados por coma">${escapeHtml(character.proficiencies.languages.join("\n"))}</textarea></label>
          <label>Herramientas<textarea name="proficiencyTools" placeholder="Una por línea o separadas por coma">${escapeHtml(character.proficiencies.tools.join("\n"))}</textarea></label>
        </div></fieldset>
        <fieldset><legend>Combate</legend><div class="field-grid">
          ${numberInput("armorClass", "Clase de armadura", character.combat.armorClass)}
          ${textInput("speed", "Velocidad", character.combat.speed)}
          ${textInput("initiative", "Iniciativa", character.combat.initiative)}
          ${numberInput("hpCurrent", "PG actuales", character.combat.hitPoints.current)}
          ${numberInput("hpMaximum", "PG máximos", character.combat.hitPoints.maximum, 0)}
          ${numberInput("hpTemporary", "PG temporales", character.combat.hitPoints.temporary, 0)}
          ${numberInput("hitDiceRemaining", "Dados de golpe restantes", character.combat.hitDice.remaining, 0)}
          <label>Tipo de dado<select name="hitDieSize">${[4, 6, 8, 10, 12, 20].map((size) => `<option value="${size}" ${size === character.combat.hitDice.dieSize ? "selected" : ""}>d${size}</option>`).join("")}</select></label>
          ${numberInput("exhaustion", "Agotamiento", character.combat.exhaustion, 0)}
          <label class="checkbox"><input name="inspiration" type="checkbox" ${character.combat.inspiration ? "checked" : ""}> Inspiración</label>
        </div></fieldset>
      </form>`;
  }

  private renderSummaryPlay(character: CharacterV2, projection: CharacterStatisticsProjection): string {
    const signed = (value: number): string => value >= 0 ? `+${value}` : String(value);
    const abilityLabels = ABILITY_ABBREVIATIONS;
    const proficiencyTags = [
      ...character.proficiencies.weapons.map((value) => `Arma: ${value}`),
      ...character.proficiencies.armor.map((value) => `Armadura: ${value}`),
      ...character.proficiencies.tools.map((value) => `Herramienta: ${value}`),
      ...character.proficiencies.languages.map((value) => `Idioma: ${value}`),
    ];
    const activeEffects = [
      ...character.spellcasting.spells.filter((spell) => spell.effect.active && spell.effect.description.trim()).map((spell) => ({ source: spell.name, description: spell.effect.description, kind: "Conjuro" })),
      ...character.inventory.filter((item) => item.effect.active && item.effect.description.trim()).map((item) => ({ source: item.name, description: item.effect.description, kind: "Objeto" })),
      ...character.traits.flatMap((group) => group.traits).filter((trait) => trait.effect.active && trait.effect.description.trim()).map((trait) => ({ source: trait.name, description: trait.effect.description, kind: "Rasgo" })),
    ];
    return `<div class="play-dashboard">
      ${this.renderResourcePanel(character, projection)}
      ${activeEffects.length ? `<section class="active-effects" aria-label="Efectos activos"><div class="section-heading"><h2>Efectos activos</h2><span>${activeEffects.length}</span></div><div>${activeEffects.map((effect) => `<article><span>${effect.kind}</span><strong>${escapeHtml(effect.source)}</strong><p>${escapeHtml(effect.description)}</p></article>`).join("")}</div></section>` : ""}
      <section class="play-section checks-play-section" aria-label="Características, habilidades y salvaciones">
        <div class="ability-cards">${(Object.keys(abilityLabels) as (keyof CharacterV2["abilities"])[]).map((key) => {
          const mode = projectAdjustedRollMode(character, "skills", [key, abilityLabels[key]], "normal");
          return `<button type="button" class="ability-card roll-button" data-roll-name="Prueba de ${abilityLabels[key]}" data-roll-expression="1d20${signed(projection.abilityModifiers[key])}" data-roll-mode="${mode}"><span>${abilityLabels[key]}</span><strong>${signed(projection.abilityModifiers[key])}</strong><small>${character.abilities[key]}</small></button>`;
        }).join("")}</div>
        <div class="checks-roll-layout"><div class="quick-roll-list skills">${(Object.keys(SKILL_DEFINITIONS) as SkillKey[]).map((key) => {
          const definition = SKILL_DEFINITIONS[key];
          const state = character.checks.skills[key];
          const mode = projectAdjustedRollMode(character, "skills", [key, definition.label], state.rollMode);
          return `<button type="button" class="quick-roll roll-button" data-roll-name="${escapeHtml(definition.label)}" data-roll-expression="1d20${signed(projection.skills[key])}" data-roll-mode="${mode}"><span>${state.proficiency === 2 ? "◆" : state.proficiency === 1 ? "●" : state.proficiency === 0.5 ? "◐" : "○"} ${escapeHtml(definition.label)}</span><strong>${signed(projection.skills[key])}</strong></button>`;
        }).join("")}</div><div class="quick-roll-list saves">${(Object.keys(SAVE_DEFINITIONS) as SaveKey[]).map((key) => {
          const definition = SAVE_DEFINITIONS[key];
          const state = character.checks.savingThrows[key];
          const mode = projectAdjustedRollMode(character, "saves", [key, key.slice(0, 3)], state.rollMode);
          return `<button type="button" class="quick-roll roll-button" data-roll-name="Salvación de ${escapeHtml(definition.label)}" data-roll-expression="1d20${signed(projection.savingThrows[key])}" data-roll-mode="${mode}"><span>${state.proficiency > 0 ? "●" : "○"} Sal. de ${ABILITY_ABBREVIATIONS[key]}</span><strong>${signed(projection.savingThrows[key])}</strong></button>`;
        }).join("")}</div>
        </div>
        ${this.renderConditionToggles(character)}
      </section>
      <section class="play-section"><h2>Competencias</h2><div class="tag-list">${proficiencyTags.length ? proficiencyTags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("") : '<span class="muted">Sin competencias adicionales</span>'}</div></section>
    </div>`;
  }

  private renderEmptyPanel(message: string): string {
    return `<div class="sheet-empty"><strong>Nada que mostrar todavía</strong><p>${escapeHtml(message)}</p>${this.sheetMode === "play" ? '<button type="button" data-sheet-mode-choice="edit">Abrir modo Edición</button>' : ""}</div>`;
  }

  private renderActionFilterBar(character: CharacterV2): string {
    const filters: readonly [string, string][] = [["all", "Todas"], ["attack", "Ataques"], ["action", "Acciones"], ["bonus-action", "Adicionales"], ["reaction", "Reacciones"], ["other", "Otras"]];
    return `<nav class="filter-bar" aria-label="Filtrar acciones">${filters.map(([value, label]) => {
      const count = value === "all" ? character.actions.length : character.actions.filter((action) => action.categories.includes(value as CharacterActionV2["categories"][number])).length;
      return `<button type="button" data-action-filter="${value}" class="${this.actionFilter === value ? "active" : ""}"><span>${label}</span><strong>${count}</strong></button>`;
    }).join("")}</nav>`;
  }

  private renderSpellFilterBar(character: CharacterV2): string {
    const labels = ["Trucos", "N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9"];
    const filters = ["all", ...Array.from({ length: 10 }, (_, level) => String(level))];
    return `<nav class="filter-bar spell-filter-bar" aria-label="Filtrar conjuros">${filters.map((value) => {
      const spells = value === "all" ? character.spellcasting.spells : character.spellcasting.spells.filter((spell) => spell.level === Number(value));
      const prepared = spells.filter((spell) => spell.prepared).length;
      const slot = value !== "all" && Number(value) > 0 ? character.spellcasting.slots[value] : undefined;
      const label = value === "all" ? "Todos" : labels[Number(value)]!;
      const slotText = slot && slot.maximum > 0 ? ` · ${Math.max(0, slot.maximum - slot.used)} disp./${slot.used} usados` : "";
      const marks = slot && slot.maximum > 0
        ? `${Array.from({ length: Math.max(0, slot.maximum - slot.used) }, () => '<i class="available">O</i>').join("")}${Array.from({ length: slot.used }, () => '<i class="used">X</i>').join("")}`
        : "";
      return `<button type="button" data-spell-filter="${value}" class="${this.spellFilter === value ? "active" : ""}" title="${spells.length} conocidos · ${prepared} preparados${slotText}"><span>${label}</span><strong>${spells.length}/${prepared}</strong>${marks ? `<small class="slot-marks">${marks}</small>` : ""}</button>`;
    }).join("")}</nav>`;
  }

  private isFavoriteSpell(character: CharacterV2, spellName: string): boolean {
    const normalizedName = normalizedSearchText(spellName);
    return character.spellcasting.favoriteSpells.some((name) => normalizedSearchText(name) === normalizedName);
  }

  private spellMatchesProperties(character: CharacterV2, spell: CharacterSpellV2): boolean {
    const definition = spell.definition;
    return [...this.spellPropertyFilters].every((filter) => {
      if (filter === "prepared") return spell.prepared;
      if (filter === "favorite") return this.isFavoriteSpell(character, spell.name);
      if (filter === "ritual") return definition?.ritual ?? false;
      if (filter === "concentration") return definition?.concentration ?? false;
      if (filter === "attack") return definition?.attackType === "attack";
      if (filter === "save") return definition?.attackType === "save";
      return true;
    });
  }

  private visibleSpellEntries(character: CharacterV2): SpellViewEntry[] {
    const knownNames = new Set(character.spellcasting.spells.map((spell) => normalizedSearchText(spell.name)));
    const unknownSpells: CharacterSpellV2[] = this.includeUnknownSpells
      ? this.spellCatalog()
        .filter((definition) => !knownNames.has(normalizedSearchText(definition.name)))
        .map((definition, index) => ({
          id: `catalog_${String(index).padStart(24, "0")}`,
          order: index,
          name: definition.name,
          level: definition.level,
          prepared: false,
          source: "bundled" as const,
          definition,
          effect: { description: "", active: false },
        }))
      : [];
    const query = normalizedSearchText(this.spellSearch);
    return [...character.spellcasting.spells.map((spell) => ({ spell, known: true })), ...unknownSpells.map((spell) => ({ spell, known: false }))]
      .filter(({ spell }) => this.spellFilter === "all" || spell.level === Number(this.spellFilter))
      .filter(({ spell }) => this.spellMatchesProperties(character, spell))
      .filter(({ spell }) => !query || this.spellSearchValue(spell).includes(query))
      .map(({ spell, known }) => ({ spell, known, favorite: this.isFavoriteSpell(character, spell.name) }))
      .sort((left, right) => {
        const leftRank = left.known ? left.spell.prepared || left.spell.level === 0 ? 0 : 1 : 2;
        const rightRank = right.known ? right.spell.prepared || right.spell.level === 0 ? 0 : 1 : 2;
        return leftRank - rightRank ||
          left.spell.name.localeCompare(right.spell.name, "es", { sensitivity: "base" });
      });
  }

  private spellSearchValue(spell: CharacterSpellV2): string {
    const definition = spell.definition;
    return normalizedSearchText([
      spell.name, definition?.school ?? "", definition?.classes ?? "",
      definition?.description ?? "", definition?.components ?? "",
      definition?.damageType ?? "", definition?.castingTime ?? "",
    ].join(" "));
  }

  private renderSpellSearchRow(includeDescriptionToggle = true): string {
    return `<div class="spell-search-row"><label class="spell-search"><span>Buscar</span><input id="spell-search" type="search" value="${escapeHtml(this.spellSearch)}" placeholder="Nombre, escuela, efecto…"></label>${includeDescriptionToggle ? `<button type="button" class="description-toggle" data-toggle-spell-descriptions aria-pressed="${this.showSpellDescriptions}">${this.showSpellDescriptions ? "Ocultar descripciones" : "Mostrar descripciones"}</button>` : ""}</div>`;
  }

  private renderSpellPropertyFilters(includeCatalog = true): string {
    const filters: readonly [string, string][] = [["prepared", "Preparados"], ["favorite", "Favoritos"], ["ritual", "Ritual"], ["concentration", "Concentración"], ["attack", "Ataque"], ["save", "Salvación"]];
    return `<nav class="filter-bar property-filter" aria-label="Filtrar por características"><button type="button" data-clear-spell-properties class="${this.spellPropertyFilters.size === 0 ? "active" : ""}">Sin filtros</button>${filters.map(([value, label]) => `<button type="button" data-spell-property-filter="${value}" class="${this.spellPropertyFilters.has(value) ? "active" : ""}" aria-pressed="${this.spellPropertyFilters.has(value)}">${label}</button>`).join("")}${includeCatalog ? `<button type="button" class="catalog-toggle ${this.includeUnknownSpells ? "active" : ""}" data-include-unknown-spells aria-pressed="${this.includeUnknownSpells}" title="${this.includeUnknownSpells ? "Ocultar" : "Incluir"} conjuros que el personaje no conoce">+ Catálogo</button>` : ""}</nav>`;
  }

  private renderSpellDiscoveryTools(includeCatalog = true, includeDescriptionToggle = true): string {
    return `<div class="spell-discovery">${this.renderSpellSearchRow(includeDescriptionToggle)}${this.renderSpellPropertyFilters(includeCatalog)}</div>`;
  }

  private renderCollapsibleSpellDescription(description: string, key: string): string {
    const expanded = this.expandedSpellDescriptions.has(key);
    return `<div class="spell-description ${expanded ? "expanded" : ""}" data-spell-description="${escapeHtml(key)}"><p class="card-description">${escapeHtml(description)}</p><button type="button" class="spell-description-more" data-toggle-spell-description aria-expanded="${expanded}">${expanded ? "Leer menos" : "Leer más"}</button></div>`;
  }

  private inventoryMatchesFilter(item: CharacterInventoryItemV2 | EquipmentCatalogDraft, filter: string): boolean {
    const category = normalizedSearchText(item.category);
    if (filter === "equipped") return item.equipped;
    if (filter === "weapon") return item.weapon !== null || category.includes("weapon") || category.includes("arma");
    if (filter === "armor") return item.armor !== null || category.includes("armor") || category.includes("armadura") || category.includes("shield") || category.includes("escudo");
    if (filter === "consumable") return item.consumable;
    if (filter === "usable") return item.usable;
    if (filter === "attunement") return item.requiresAttunement;
    return false;
  }

  private inventorySearchValue(item: CharacterInventoryItemV2 | EquipmentCatalogDraft): string {
    return normalizedSearchText([
      item.name,
      item.category,
      item.description,
      item.weapon?.category ?? "",
      item.weapon?.damageType ?? "",
      item.armor?.armorCategory ?? "",
      ...item.properties,
    ].join(" "));
  }

  private inventoryIsVisible(item: CharacterInventoryItemV2 | EquipmentCatalogDraft): boolean {
    const query = normalizedSearchText(this.inventorySearch);
    return (!query || this.inventorySearchValue(item).includes(query)) &&
      [...this.inventoryFilters].every((filter) => this.inventoryMatchesFilter(item, filter));
  }

  private inventoryCatalogEntries(character: CharacterV2): EquipmentCatalogDraft[] {
    if (!this.includeUnownedInventory) return [];
    const owned = new Set(character.inventory.map((item) => normalizedSearchText(item.name)));
    const unique = new Map<string, EquipmentCatalogDraft>();
    for (const definition of this.equipmentCatalog()) {
      const key = normalizedSearchText(definition.name);
      if (!owned.has(key) && !unique.has(key) && this.inventoryIsVisible(definition)) unique.set(key, definition);
    }
    return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name, "es", { sensitivity: "base" }));
  }

  private renderInventoryFilterBar(character: CharacterV2): string {
    const filters: readonly [string, string][] = [["equipped", "Equipado"], ["weapon", "Armas"], ["armor", "Armaduras"], ["consumable", "Consumibles"], ["usable", "Usables"], ["attunement", "Sintonización"]];
    return `<nav class="filter-bar property-filter inventory-filter-bar" aria-label="Filtrar inventario"><button type="button" data-clear-inventory-filters class="${this.inventoryFilters.size === 0 ? "active" : ""}">Sin filtros</button>${filters.map(([value, label]) => `<button type="button" data-inventory-filter="${value}" class="${this.inventoryFilters.has(value) ? "active" : ""}" aria-pressed="${this.inventoryFilters.has(value)}"><span>${label}</span><strong>${character.inventory.filter((item) => this.inventoryMatchesFilter(item, value)).length}</strong></button>`).join("")}<button type="button" class="catalog-toggle ${this.includeUnownedInventory ? "active" : ""}" data-include-unowned-inventory aria-pressed="${this.includeUnownedInventory}">+ Catálogo</button></nav>`;
  }

  private renderInventoryDiscoveryTools(character: CharacterV2): string {
    const projection = projectInventory(character);
    return `<div class="spell-discovery inventory-discovery">
      <div class="spell-search-row inventory-search-row"><label class="spell-search inventory-search"><span>Buscar</span><input id="inventory-search" type="search" value="${escapeHtml(this.inventorySearch)}" placeholder="Nombre, tipo, propiedad…"></label><button type="button" class="description-toggle" data-toggle-inventory-descriptions aria-pressed="${this.showInventoryDescriptions}">${this.showInventoryDescriptions ? "Ocultar descripciones" : "Mostrar descripciones"}</button></div>
      <div class="inventory-resource-row">${this.renderCurrencyResourceControl(character)}${this.renderInventoryAttunementControl(character, projection)}${this.renderInventoryWeightMeter(character, projection)}</div>
      ${this.renderInventoryFilterBar(character)}
    </div>`;
  }

  private renderCollapsibleInventoryDescription(description: string, key: string): string {
    const expanded = this.expandedInventoryDescriptions.has(key);
    return `<div class="spell-description inventory-description ${expanded ? "expanded" : ""}" data-inventory-description="${escapeHtml(key)}"><p class="card-description">${escapeHtml(description)}</p><button type="button" class="spell-description-more" data-toggle-inventory-description aria-expanded="${expanded}">${expanded ? "Leer menos" : "Leer más"}</button></div>`;
  }

  private renderActionsPlay(character: CharacterV2, embedded = false): string {
    const filtered = this.actionFilter === "all"
      ? character.actions
      : character.actions.filter((action) => action.categories.includes(this.actionFilter as CharacterActionV2["categories"][number]));
    return `${embedded ? '<div class="actions-spells-group action-group">' : '<section class="play-section collection-play">'}
      ${this.renderActionFilterBar(character)}
      ${filtered.length ? `<div class="play-card-grid">${filtered.map((action) => {
        const attack = projectActionAttackModifier(character, action);
        const damageBonus = projectActionDamageBonus(character, action);
        const signedAttack = attack >= 0 ? `+${attack}` : String(attack);
        const damage = `${action.damageExpression}${damageBonus > 0 ? `+${damageBonus}` : damageBonus < 0 ? damageBonus : ""}`;
        const mode = projectAdjustedRollMode(character, "combatStats", [action.weaponType.toLowerCase().includes("ranged") ? "RangedAttackRolls" : "MeleeAttackRolls"], action.rollMode);
        const executionKey = `action:${character.id}:${action.id}`;
        const armed = this.combatExecutions.get(executionKey);
        return `<article class="play-card spell-play-card action-play-card" data-combat-execution-key="${executionKey}" data-combat-name="${escapeHtml(action.name)}">
          <header class="spell-play-header"><div class="spell-title"><div class="spell-meta-line"><span class="card-kicker">${escapeHtml(action.activation || action.categories.join(" · "))}</span><span class="action-kind-label">Acción</span></div><div class="spell-name-line"><h3>${escapeHtml(action.name)}</h3><span class="spell-inline-facts">${escapeHtml(action.reach || "—")}${action.damageType ? ` · ${escapeHtml(action.damageType)}` : ""}</span></div></div><div class="spell-card-controls"><button type="button" data-arm-combat-action>Lanzar</button><button type="button" class="roll-button" data-combat-roll="attack" data-roll-name="Ataque: ${escapeHtml(action.name)}" data-roll-expression="1d20${signedAttack}" data-roll-mode="${mode}" ${armed?.has("attack") ? "" : "disabled"}>Ataque</button>${damage ? `<button type="button" class="roll-button" data-combat-roll="damage" data-roll-name="Daño: ${escapeHtml(action.name)}" data-roll-expression="${escapeHtml(damage)}" data-roll-mode="normal" ${armed?.has("damage") ? "" : "disabled"}>Daño</button>` : ""}</div></header>
          ${action.description && this.showSpellDescriptions ? this.renderCollapsibleSpellDescription(action.description, `action:${action.id}`) : ""}
          <div class="action-readouts"><span>Ataque <strong>${signedAttack}</strong></span>${damage ? `<span>Daño <strong>${escapeHtml(damage)}</strong>${action.damageType ? ` <em class="damage-badge" data-damage-tone="${spellDamageTone(action.damageType)}">${escapeHtml(action.damageType)}</em>` : ""}</span>` : ""}</div>
        </article>`;
      }).join("")}</div>` : embedded ? '<p class="combined-empty">Sin acciones configuradas.</p>' : this.renderEmptyPanel("Agregá acciones y ataques desde el modo Edición.")}
    ${embedded ? "</div>" : "</section>"}`;
  }

  private renderSpellsPlay(character: CharacterV2, embedded = false, includeSearchRow = true): string {
    const projection = projectSpellcasting(character);
    const entries = this.visibleSpellEntries(character);
    const attackMode = projectAdjustedRollMode(character, "combatStats", ["SpellAttackModifier", "SpellAttackandSave"], "normal");
    return `${embedded ? '<div class="actions-spells-group spell-group">' : '<section class="play-section collection-play">'}
      ${includeSearchRow ? this.renderSpellDiscoveryTools() : `<div class="spell-discovery spell-property-tools">${this.renderSpellPropertyFilters()}</div>`}${this.renderSpellFilterBar(character)}
      ${entries.length ? `<div class="play-card-grid spell-play-grid">${entries.map(({ spell, known, favorite }) => {
        const definition = spell.definition;
        const damage = projectSpellDamageExpression(character, spell);
        const minimumLevel = Math.max(1, spell.level);
        const ritualAvailable = definition?.ritual ?? false;
        const availableSlotLevel = spell.level === 0 ? 0 : Array.from({ length: 10 - minimumLevel }, (_, index) => minimumLevel + index).find((level) => {
          const slot = character.spellcasting.slots[String(level)] ?? { maximum: 0, used: 0 };
          return slot.used < slot.maximum;
        });
        const spellAvailable = known && (spell.level === 0 || spell.prepared || ritualAvailable);
        const canLaunch = known && (spell.level === 0 || (spell.prepared && availableSlotLevel !== undefined) || ritualAvailable);
        const initialCastLevel = spell.level === 0
          ? 0
          : spell.prepared && availableSlotLevel !== undefined
            ? availableSlotLevel
            : ritualAvailable
              ? "ritual"
              : minimumLevel;
        const initialDamage = typeof initialCastLevel === "number"
          ? projectSpellDamageExpression(character, spell, initialCastLevel)
          : damage;
        const levelOptions = spell.level === 0
          ? `<option value="0" data-spell-damage="${escapeHtml(damage)}" data-cast-available="true">Truco</option>`
          : Array.from({ length: 10 - minimumLevel }, (_, index) => minimumLevel + index).map((level) => {
              const slot = character.spellcasting.slots[String(level)] ?? { maximum: 0, used: 0 };
              const projectedDamage = projectSpellDamageExpression(character, spell, level);
              const disabled = !spell.prepared || slot.used >= slot.maximum;
              return `<option value="${level}" data-spell-damage="${escapeHtml(projectedDamage)}" data-cast-available="${!disabled}" ${initialCastLevel === level ? "selected" : ""} ${disabled ? "disabled" : ""}>Nivel ${level} · ${Math.max(0, slot.maximum - slot.used)} disp.</option>`;
            }).join("");
        const ritualOption = ritualAvailable ? `<option value="ritual" data-spell-damage="${escapeHtml(damage)}" data-cast-available="true" ${initialCastLevel === "ritual" ? "selected" : ""}>Ritual · sin espacio</option>` : "";
        const preparation = known
          ? spell.level > 0
            ? `<button type="button" class="preparation-toggle ${spell.prepared ? "active" : ""}" data-spell-action="prepare" title="${spell.prepared ? "Despreparar" : "Preparar"} conjuro">${spell.prepared ? "Preparado" : "No preparado"}</button>`
            : '<span class="cantrip-label">Siempre disponible</span>'
          : '<span class="preparation-toggle catalog-preparation">No conocido</span>';
        const executionKey = `spell:${character.id}:${spell.id}`;
        const armed = this.combatExecutions.get(executionKey);
        const resolutionDamage = armed?.has("damage") ? this.combatExecutionDamage.get(executionKey) ?? initialDamage : initialDamage;
        const controls = known
          ? `<label class="cast-as"><span>Lanzar como</span><select data-cast-slot-level size="1">${levelOptions}${ritualOption}</select></label><button type="button" data-spell-cast-control data-spell-action="cast" ${canLaunch ? "" : "disabled"}>Lanzar</button>${definition?.attackType === "attack" ? `<button type="button" class="roll-button" data-combat-roll="attack" data-roll-name="Ataque de conjuro: ${escapeHtml(spell.name)}" data-roll-expression="1d20${projection.attackModifier >= 0 ? "+" : ""}${projection.attackModifier}" data-roll-mode="${attackMode}" ${armed?.has("attack") ? "" : "disabled"}>Ataque</button>` : ""}${damage ? `<button type="button" class="roll-button" data-combat-roll="damage" data-spell-damage-button data-roll-name="Daño de ${escapeHtml(spell.name)}" data-roll-expression="${escapeHtml(resolutionDamage)}" data-roll-mode="normal" ${armed?.has("damage") ? "" : "disabled"}>Daño</button>` : ""}`
          : "";
        return `<article class="play-card spell-play-card ${known ? "known-spell" : "catalog-spell"} ${spell.prepared || spell.level === 0 ? "prepared" : ""} ${spellAvailable && canLaunch ? "" : "spell-disabled"}" data-spell-card ${known ? `data-spell-id="${spell.id}"` : ""} data-spell-name="${escapeHtml(spell.name)}" data-combat-execution-key="${executionKey}" data-combat-name="${escapeHtml(spell.name)}" data-spell-search-value="${escapeHtml(this.spellSearchValue(spell))}">
          <header class="spell-play-header"><div class="spell-title"><div class="spell-meta-line"><span class="card-kicker">${spell.level === 0 ? "Truco" : `Nivel ${spell.level}`}</span>${definition?.school ? `<span class="school-badge" data-school-tone="${spellSchoolTone(definition.school)}">${escapeHtml(definition.school)}</span>` : ""}${preparation}<button type="button" class="favorite-toggle ${favorite ? "active" : ""}" data-spell-action="favorite" aria-pressed="${favorite}" title="${favorite ? "Quitar de favoritos" : "Agregar a favoritos"}">${favorite ? "★" : "☆"}</button></div><div class="spell-name-line"><h3>${escapeHtml(spell.name)}</h3>${definition ? `<span class="spell-inline-facts">${escapeHtml(compactCastingTime(definition.castingTime || "—"))} · ${escapeHtml(definition.range || "—")} · ${escapeHtml(definition.duration || "—")}</span>` : ""}</div></div><div class="spell-card-controls">${controls}</div></header>
          ${definition ? definition.description && this.showSpellDescriptions ? this.renderCollapsibleSpellDescription(definition.description, known ? spell.id : `catalog:${normalizedSearchText(spell.name)}`) : "" : '<p class="muted">Sin definición de catálogo.</p>'}
          <div class="action-readouts">${definition?.attackType === "attack" ? `<span>Ataque <strong>${projection.attackModifier >= 0 ? "+" : ""}${projection.attackModifier}</strong></span>` : definition?.attackType === "save" ? `<span>Salvación <strong>${escapeHtml(definition.saveAbility.toUpperCase())} CD ${projection.saveDc}</strong></span>` : ""}${damage ? `<span>Daño <strong data-spell-damage-readout>${escapeHtml(resolutionDamage)}</strong>${definition?.damageType ? ` <em class="damage-badge" data-damage-tone="${spellDamageTone(definition.damageType)}">${escapeHtml(definition.damageType)}</em>` : ""}</span>` : ""}</div>
          ${known && spell.effect.description ? `<div class="effect-control"><span>${escapeHtml(spell.effect.description)}</span><select data-effect-toggle="spell" aria-label="Estado del efecto"><option value="off" ${spell.effect.active ? "" : "selected"}>Inactivo</option><option value="on" ${spell.effect.active ? "selected" : ""}>Activo</option></select></div>` : ""}
        </article>`;
      }).join("")}</div>` : '<div class="sheet-empty spell-empty"><strong>No hay conjuros con las características seleccionadas</strong><p>Probá quitar filtros, cambiar el nivel o limpiar la búsqueda.</p><button type="button" data-clear-spell-filters>Limpiar filtros</button></div>'}
    ${embedded ? "</div>" : "</section>"}`;
  }

  private renderInventoryWeightMeter(character: CharacterV2, projection: InventoryProjection): string {
    const ratio = projection.carryingCapacity > 0 ? projection.totalWeight / projection.carryingCapacity : 0;
    const percentage = Math.max(0, Math.round(ratio * 100));
    const weightByTone = new Map<string, { label: string; weight: number }>();
    for (const item of character.inventory) {
      const weight = Math.max(0, item.unitWeight * item.quantity);
      if (weight <= 0) continue;
      const tone = inventoryCategoryTone(item);
      const current = weightByTone.get(tone);
      weightByTone.set(tone, {
        label: current?.label ?? inventoryCategoryLabel(item),
        weight: (current?.weight ?? 0) + weight,
      });
    }
    const toneOrder = ["weapon", "armor", "shield", "consumable", "tool", "wondrous", "gear", "vehicle", "other"];
    const breakdown = toneOrder
      .map((tone) => ({ tone, ...weightByTone.get(tone) }))
      .filter((entry): entry is { tone: string; label: string; weight: number } => entry.weight !== undefined);
    const segments = breakdown.map((entry) => {
      const segment = projection.carryingCapacity > 0 ? Math.max(0, entry.weight / projection.carryingCapacity * 100) : 0;
      return `<i data-inventory-tone="${entry.tone}" style="--weight-segment:${segment}%" title="${escapeHtml(entry.label)}: ${entry.weight.toFixed(1)} lb"></i>`;
    }).join("");
    const breakdownLabel = breakdown.map((entry) => `${entry.label}: ${entry.weight.toFixed(1)} lb`).join(", ");
    return `<div class="inventory-weight-meter ${projection.overCapacity ? "over-capacity" : ""}" role="meter" aria-label="Peso transportado" aria-valuemin="0" aria-valuemax="${projection.carryingCapacity}" aria-valuenow="${projection.totalWeight}" aria-valuetext="${projection.totalWeight.toFixed(1)} de ${projection.carryingCapacity.toFixed(0)} libras${breakdownLabel ? `. ${escapeHtml(breakdownLabel)}` : ""}"><div class="inventory-weight-composition" aria-hidden="true">${segments}</div><span>Peso</span><strong>${projection.totalWeight.toFixed(1)}<small>/${projection.carryingCapacity.toFixed(0)} lb</small></strong><em>${percentage}%</em></div>`;
  }

  private renderInventoryPlay(character: CharacterV2): string {
    const items = character.inventory
      .filter((item) => this.inventoryIsVisible(item))
      .sort((left, right) => Number(right.equipped) - Number(left.equipped) || left.name.localeCompare(right.name, "es", { sensitivity: "base" }));
    const equipped = items.filter((item) => item.equipped);
    const stored = items.filter((item) => !item.equipped);
    const catalog = this.inventoryCatalogEntries(character);
    return `<section class="play-section collection-play">
      ${this.renderInventoryDiscoveryTools(character)}
      ${equipped.length ? `<section class="inventory-list-group equipped-group"><h3>Equipado <small>${equipped.length}</small></h3><div class="inventory-dense-list">${equipped.map((item) => this.renderInventoryPlayCard(character, item)).join("")}</div></section>` : ""}
      ${stored.length ? `<section class="inventory-list-group"><h3>Inventario <small>${stored.length}</small></h3><div class="inventory-dense-list">${stored.map((item) => this.renderInventoryPlayCard(character, item)).join("")}</div></section>` : ""}
      ${catalog.length ? `<section class="inventory-list-group catalog-group"><h3>Fuera del inventario <small>${catalog.length}</small></h3><div class="inventory-dense-list">${catalog.map((item) => this.renderInventoryPlayCard(character, item, true)).join("")}</div></section>` : ""}
      ${!items.length && !catalog.length ? '<div class="sheet-empty spell-empty"><strong>No hay objetos con las características seleccionadas</strong><p>Probá quitar filtros, cambiar la búsqueda o incluir el catálogo.</p><button type="button" data-clear-inventory-search>Limpiar filtros</button></div>' : ""}
    </section>`;
  }

  private renderInventoryPlayCard(
    character: CharacterV2,
    item: CharacterInventoryItemV2 | EquipmentCatalogDraft,
    catalog = false,
  ): string {
    const owned = !catalog && "id" in item;
    const ownedItem = owned ? item as CharacterInventoryItemV2 : null;
    const description = item.description.trim() || this.findEquipment(item.name)?.description.trim() || "";
    const categoryTone = inventoryCategoryTone(item);
    const useDisabled = !ownedItem?.usable || (!ownedItem.equipped && !ownedItem.consumable) ||
      (ownedItem.charges !== null && ownedItem.charges.current < 1) || ownedItem.quantity < 1;
    const targets = this.transferTargetOptions(character.id);
    const quantity = ownedItem?.quantity ?? 0;
    return `<article class="inventory-row ${ownedItem?.equipped ? "equipped" : ""} ${catalog ? "catalog-item inventory-disabled" : ""}" ${ownedItem ? `data-inventory-card data-inventory-id="${ownedItem.id}"` : ""}>
      <header class="inventory-row-header"><div class="inventory-row-main"><strong>${escapeHtml(item.name)}</strong><span><em class="inventory-category" data-inventory-tone="${categoryTone}">${escapeHtml(inventoryCategoryLabel(item))}</em> · ${(item.unitWeight * (quantity || 1)).toFixed(1)} lb</span></div>${ownedItem ? `<div class="inventory-quantity-control" aria-label="Cantidad de ${escapeHtml(item.name)}"><button type="button" data-inventory-quantity="-1" ${ownedItem.equipped ? "disabled" : ""}>−</button><strong>${quantity}</strong><button type="button" data-inventory-quantity="1">+</button></div>` : '<span class="inventory-catalog-state">No adquirido</span>'}</header>
      <div class="inventory-row-stats">${item.weapon?.damageExpression ? `<span>${escapeHtml(item.weapon.damageExpression)} ${escapeHtml(item.weapon.damageType)}</span>` : ""}${item.charges ? `<span>${item.charges.current}/${item.charges.maximum} cargas</span>` : ""}${ownedItem?.attuned ? "<span>Sintonizado</span>" : ""}${ownedItem?.equipped ? "<span>Equipado</span>" : ""}</div>
      ${ownedItem?.effect.description ? `<div class="effect-control compact-effect"><span>${escapeHtml(ownedItem.effect.description)}</span><select data-effect-toggle="inventory" aria-label="Estado del efecto"><option value="off" ${ownedItem.effect.active ? "" : "selected"}>Inactivo</option><option value="on" ${ownedItem.effect.active ? "selected" : ""}>Activo</option></select></div>` : ""}
      ${description && this.showInventoryDescriptions ? this.renderCollapsibleInventoryDescription(description, ownedItem?.id ?? `catalog:${normalizedSearchText(item.name)}`) : ""}
      ${item.properties.length ? `<div class="tag-list inventory-properties">${item.properties.map((property) => `<span>${escapeHtml(property)}</span>`).join("")}</div>` : ""}
      <div class="inventory-row-actions">${catalog ? `<button type="button" data-add-catalog-inventory="${escapeHtml(item.name)}">Agregar</button>` : `${ownedItem?.usable ? `<button type="button" data-inventory-action="use" ${useDisabled ? "disabled" : ""} title="${useDisabled && !ownedItem.consumable && !ownedItem.equipped ? "Debe estar equipado" : "Usar objeto"}">Usar</button>` : ""}<button type="button" class="secondary-button" data-inventory-action="equip">${ownedItem?.equipped ? "Quitar" : "Equipar"}</button>${ownedItem?.requiresAttunement && ownedItem.equipped ? `<button type="button" class="secondary-button" data-inventory-action="attune">${ownedItem.attuned ? "Desintonizar" : "Sintonizar"}</button>` : ""}<details class="inventory-item-transfer"><summary>Transferir</summary><div><select data-item-transfer-target aria-label="Personaje destinatario"><option value="">Destinatario…</option>${targets}</select><div><input data-item-transfer-quantity type="number" min="1" max="${quantity}" step="1" value="1" aria-label="Cantidad a transferir"><button type="button" data-transfer-inventory-item disabled>Confirmar</button></div></div></details>`}</div>
    </article>`;
  }

  private renderTraitsPlay(character: CharacterV2): string {
    if (!character.traits.some((group) => group.traits.length)) return this.renderEmptyPanel("Agregá rasgos desde el modo Edición.");
    return `<div class="content-play-groups">${character.traits.filter((group) => group.traits.length).map((group) => `<section class="play-section"><div class="section-heading"><h2>${escapeHtml(group.title)}</h2><span>${group.traits.length} rasgos</span></div><div class="play-card-grid">${group.traits.map((trait) => {
      const remaining = Math.max(0, trait.uses.maximum - trait.uses.used);
      return `<article class="play-card trait-play-card" data-trait-card data-group-id="${group.id}" data-trait-id="${trait.id}"><header><h3>${escapeHtml(trait.name)}</h3>${trait.uses.maximum > 0 ? `<span class="card-badge">${remaining} / ${trait.uses.maximum} usos</span>` : ""}</header>${trait.description ? `<p class="card-description">${escapeHtml(trait.description)}</p>` : ""}${trait.adjustment ? `<div class="tag-list"><span>${escapeHtml(trait.adjustment.category)} · ${escapeHtml(trait.adjustment.subcategory)} ${trait.adjustment.value >= 0 ? "+" : ""}${trait.adjustment.value}</span></div>` : ""}${trait.effect.description ? `<div class="effect-control"><span>${escapeHtml(trait.effect.description)}</span><select data-effect-toggle="trait" aria-label="Estado del efecto"><option value="off" ${trait.effect.active ? "" : "selected"}>Inactivo</option><option value="on" ${trait.effect.active ? "selected" : ""}>Activo</option></select></div>` : ""}${trait.uses.maximum > 0 ? '<div class="card-buttons"><button type="button" class="secondary-button" data-trait-use="-1">Recuperar</button><button type="button" data-trait-use="1">Gastar uso</button></div>' : ""}</article>`;
    }).join("")}</div></section>`).join("")}</div>`;
  }

  private renderNotesPlay(character: CharacterV2): string {
    if (!character.notes.some((group) => group.notes.length)) return this.renderEmptyPanel("Agregá notas desde el modo Edición.");
    return `<div class="content-play-groups">${character.notes.filter((group) => group.notes.length).map((group) => `<section class="play-section"><div class="section-heading"><h2>${escapeHtml(group.title)}</h2><span>${group.notes.length} notas</span></div><div class="notes-play-grid">${group.notes.map((note) => `<article class="play-card note-play-card"><header><h3>${escapeHtml(note.title)}</h3></header>${note.tags.length ? `<div class="tag-list">${note.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}<p class="card-description">${escapeHtml(note.content)}</p></article>`).join("")}</div></section>`).join("")}</div>`;
  }

  private renderExtrasPlay(character: CharacterV2): string {
    if (character.extras.length === 0) return this.renderEmptyPanel("Agregá mascotas, formas o criaturas desde el modo Edición.");
    return `<section class="play-section"><div class="play-card-grid">${character.extras.map((extra) => `<article class="play-card extra-play-card" data-extra-card data-extra-id="${extra.id}">
      <header><h3>${escapeHtml(extra.name)}</h3><span class="card-badge">PG ${extra.hitPoints.current} / ${extra.hitPoints.maximum}${extra.hitPoints.temporary ? ` +${extra.hitPoints.temporary}` : ""}</span></header>
      <div class="condition-pills">${extra.conditions.length ? extra.conditions.map((condition) => `<span class="condition-pill">${escapeHtml(condition.label)}<button type="button" data-remove-extra-condition="${condition.id}" title="Quitar condición">×</button></span>`).join("") : '<span class="muted">Sin condiciones</span>'}</div>
      <div class="resource-actions"><label>Cantidad<input data-extra-amount type="number" min="1" value="1"></label><button type="button" data-extra-hp="damage">Daño</button><button type="button" data-extra-hp="heal">Curar</button><button type="button" data-extra-hp="temporary">PG temp.</button></div>
      <div class="resource-actions"><label>Condición<select data-extra-condition-select>${playerConditions.map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}</select></label><button type="button" data-add-extra-condition>Agregar</button></div>
      <details class="stat-block"><summary>Ver stat block</summary><pre>${escapeHtml(JSON.stringify(extra.statBlock, null, 2))}</pre></details>
    </article>`).join("")}</div></section>`;
  }

  private renderInitiativePanel(character: CharacterV2, projection: CharacterStatisticsProjection): string {
    if (!this.runtime.requestInitiativeList && !this.runtime.sendInitiative && !this.runtime.sendCharacterSummary) return "";
    const state = this.initiativeState;
    const sync = this.encounterSyncState;
    return `<section class="initiative-panel">
      <div class="initiative-heading"><strong>Iniciativa compartida</strong><span>Ronda ${state.round ?? "—"}</span></div>
      ${sync && sync.status !== "idle" ? `<p class="encounter-sync ${sync.status}">${sync.status === "synchronized" ? `Encuentro sincronizado · revisión ${sync.revision ?? "—"}` : sync.status === "requesting" ? "Solicitando encuentro…" : sync.status === "receiving" ? "Recibiendo encuentro…" : `Error de sincronización: ${escapeHtml(sync.error ?? "desconocido")}`}</p>` : ""}
      <div class="initiative-list">${state.entries.length === 0 ? '<span class="muted">Sin lista recibida del GM</span>' : state.entries.map((entry, index) => `<span class="initiative-entry ${index === state.activeTurn ? "active" : ""} ${entry.visible ? "" : "hidden-entry"}">${escapeHtml(entry.name)}${entry.bloodied ? " · herido" : ""}</span>`).join("")}</div>
      <div class="resource-actions">
        ${this.runtime.requestInitiativeList ? '<button type="button" id="request-initiative-list">Solicitar lista</button>' : ""}
        ${this.runtime.sendCharacterSummary ? '<button type="button" id="send-character-summary">Enviar estadísticas al GM</button>' : ""}
        ${this.runtime.sendInitiative ? `<button type="button" id="roll-initiative">Tirar iniciativa (${projection.initiativeModifier >= 0 ? "+" : ""}${projection.initiativeModifier})</button><label>Resultado<input id="initiative-result" type="number" step="1"></label><button type="button" id="send-initiative">Enviar resultado</button>` : ""}
      </div>
    </section>`;
  }

  private renderActions(character: CharacterV2): string {
    const filtered = this.actionFilter === "all"
      ? character.actions
      : character.actions.filter((action) => action.categories.includes(this.actionFilter as CharacterActionV2["categories"][number]));
    return `
      <fieldset aria-label="Acciones y ataques">
        ${this.renderActionFilterBar(character)}
        <div class="action-cards">
          ${filtered.map((action) => this.renderActionCard(character, action)).join("")}
          ${this.actionFilter === "all" ? this.renderActionCard(character, null) : ""}
        </div>
      </fieldset>`;
  }

  private renderActionCard(
    character: CharacterV2,
    action: CharacterActionV2 | null,
  ): string {
    const categories = action?.categories ?? ["action"];
    const ability = action?.ability ?? "strength";
    const attack = action ? projectActionAttackModifier(character, action) : 0;
    const damageBonus = action ? projectActionDamageBonus(character, action) : 0;
    const effectiveMode = action
      ? projectAdjustedRollMode(
          character,
          "combatStats",
          [action.weaponType.toLowerCase().includes("ranged") ? "RangedAttackRolls" : "MeleeAttackRolls"],
          action.rollMode,
        )
      : "normal";
    const signed = attack >= 0 ? `+${attack}` : String(attack);
    return `
      <details class="action-card collapsible-editor" data-action-card data-action-id="${action?.id ?? ""}" ${action ? "" : "open"}>
        <summary class="editor-card-summary"><strong>${escapeHtml(action?.name ?? "Agregar acción")}</strong><span>${action ? `${escapeHtml(action.activation || action.categories.join(" · "))} · ataque ${signed}` : "Nueva"}</span></summary>
        <div class="editor-card-body">
        <div class="action-card-heading">
          <label>Nombre<input data-field="name" value="${escapeHtml(action?.name ?? "")}" placeholder="Nueva acción"></label>
          ${action ? `<output title="Ataque calculado">Ataque ${signed}</output>` : ""}
        </div>
        <div class="field-grid">
          ${numberInput("unused", "Orden", action?.order ?? character.actions.length)}
          <label>Activación<input data-field="activation" value="${escapeHtml(action?.activation ?? "")}" placeholder="Acción, adicional…"></label>
          <label>Alcance<input data-field="reach" value="${escapeHtml(action?.reach ?? "")}"></label>
          <label>Característica<select data-field="ability">${Object.entries({ strength: "FUE", dexterity: "DES", constitution: "CON", intelligence: "INT", wisdom: "SAB", charisma: "CAR" }).map(([value, label]) => `<option value="${value}" ${value === ability ? "selected" : ""}>${label}</option>`).join("")}</select></label>
          <label class="checkbox"><input data-field="proficient" type="checkbox" ${action?.proficient ? "checked" : ""}> Competente</label>
          <label>Bono de ataque<input data-field="attackBonus" type="number" value="${action?.attackBonus ?? 0}"></label>
          <label>Daño<input data-field="damageExpression" value="${escapeHtml(action?.damageExpression ?? "")}" placeholder="1d8+3"></label>
          <label>Bono de daño<input data-field="damageBonus" type="number" value="${action?.damageBonus ?? 0}"></label>
          <label>Tipo de daño<input data-field="damageType" value="${escapeHtml(action?.damageType ?? "")}"></label>
          <label>Tipo de arma<input data-field="weaponType" value="${escapeHtml(action?.weaponType ?? "")}"></label>
          <label>Propiedades<input data-field="properties" value="${escapeHtml(action?.properties ?? "")}"></label>
          <label>Objeto vinculado<input data-field="inventoryItemId" value="${escapeHtml(action?.inventoryItemId ?? "")}"></label>
          <label>Modo<select data-field="rollMode">${[["normal", "Normal"], ["advantage", "Ventaja"], ["disadvantage", "Desventaja"]].map(([value, label]) => `<option value="${value}" ${value === (action?.rollMode ?? "normal") ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        </div>
        <label>Descripción<textarea data-field="description">${escapeHtml(action?.description ?? "")}</textarea></label>
        <div class="category-checks">
          ${[["attack", "Ataque"], ["action", "Acción"], ["bonus-action", "Adicional"], ["reaction", "Reacción"], ["other", "Otra"]].map(([value, label]) => `<label class="checkbox"><input data-category="${value}" type="checkbox" ${categories.includes(value as CharacterActionV2["categories"][number]) ? "checked" : ""}> ${label}</label>`).join("")}
        </div>
        <div class="card-buttons">
          ${action ? `<button type="button" class="roll-button" data-roll-name="Ataque: ${escapeHtml(action.name)}" data-roll-expression="1d20${signed}" data-roll-mode="${effectiveMode}">Tirar ataque</button>${action.damageExpression ? `<button type="button" class="roll-button" data-roll-name="Daño: ${escapeHtml(action.name)}" data-roll-expression="${escapeHtml(action.damageExpression)}${damageBonus > 0 ? `+${damageBonus}` : damageBonus < 0 ? damageBonus : ""}" data-roll-mode="normal">Tirar daño</button>` : ""}` : ""}
          <button type="button" data-save-action>${action ? "Guardar acción" : "Agregar acción"}</button>
          ${action ? '<button type="button" class="danger" data-delete-action>Eliminar</button>' : ""}
        </div>
        </div>
      </details>`;
  }

  private renderInventory(character: CharacterV2): string {
    const visibleItems = character.inventory
      .filter((item) => this.inventoryIsVisible(item))
      .sort((left, right) => Number(right.equipped) - Number(left.equipped) || left.name.localeCompare(right.name, "es", { sensitivity: "base" }));
    const equippedItems = visibleItems.filter((item) => item.equipped);
    const storedItems = visibleItems.filter((item) => !item.equipped);
    const catalog = this.inventoryCatalogEntries(character);
    return `
      <fieldset aria-label="Inventario y equipo">
        <div class="inventory-toolbar">
          <span>${visibleItems.length} de ${character.inventory.length} objetos visibles</span>
          <label>Importar equipo JSON<input id="import-equipment-file" type="file" accept="application/json,.json"></label>
          <button type="button" class="secondary-button" data-reset-inventory-charges="short-rest">Recuperar cargas de descanso corto</button>
          <button type="button" class="secondary-button" data-reset-inventory-charges="long-rest">Recuperar cargas de descanso largo</button>
          <button type="button" class="secondary-button" data-reset-inventory-charges="at-dawn">Recuperar cargas al amanecer</button>
        </div>
        ${this.renderInventoryDiscoveryTools(character)}
        <div class="inventory-groups">
          ${equippedItems.length ? `<section class="inventory-group-v2"><h3>Equipado</h3>${equippedItems.map((item) => this.renderInventoryCard(character, item)).join("")}</section>` : ""}
          ${storedItems.length ? `<section class="inventory-group-v2"><h3>Inventario</h3>${storedItems.map((item) => this.renderInventoryCard(character, item)).join("")}</section>` : ""}
          ${catalog.length ? `<section class="inventory-group-v2 catalog-editor-group"><h3>Fuera del inventario</h3><div class="inventory-dense-list">${catalog.map((item) => this.renderInventoryPlayCard(character, item, true)).join("")}</div></section>` : ""}
        </div>
      </fieldset>`;
  }

  private renderSpells(character: CharacterV2, includeSearchRow = true): string {
    const projection = projectSpellcasting(character);
    const entries = this.visibleSpellEntries(character);
    const selectedAbility = projection.ability ?? "intelligence";
    const labels = ["Trucos", "Nivel 1", "Nivel 2", "Nivel 3", "Nivel 4", "Nivel 5", "Nivel 6", "Nivel 7", "Nivel 8", "Nivel 9"];
    return `
      <fieldset aria-label="Conjuros">
        <details class="compact-config"><summary>Configuración y espacios de conjuro</summary><div class="field-grid spell-settings">
          <label>Característica<select id="spellcasting-ability">${Object.entries({ strength: "FUE", dexterity: "DES", constitution: "CON", intelligence: "INT", wisdom: "SAB", charisma: "CAR" }).map(([value, label]) => `<option value="${value}" ${value === selectedAbility ? "selected" : ""}>${label}</option>`).join("")}</select></label>
          <label>Nivel visible<select id="spell-visible-level"><option value="">Todos</option>${Array.from({ length: 10 }, (_, level) => `<option value="${level}" ${character.spellcasting.selectedLevel === String(level) ? "selected" : ""}>${labels[level]}</option>`).join("")}</select></label>
          <label>Bono extra de ataque<input id="spell-attack-bonus" type="number" step="1" value="${character.spellcasting.attackBonus}"></label>
          <label>Bono extra de CD<input id="spell-save-bonus" type="number" step="1" value="${character.spellcasting.saveDcBonus}"></label>
          <label class="checkbox"><input id="spell-show-upcast" type="checkbox" ${character.spellcasting.showUpcast ? "checked" : ""}> Mostrar opciones de nivel superior</label>
          <button type="button" class="secondary-button" id="save-spell-settings">Guardar configuración</button>
        </div>
        <div class="spell-slots-grid">
          ${Array.from({ length: 9 }, (_, index) => {
            const level = index + 1;
            const state = character.spellcasting.slots[String(level)] ?? { maximum: 0, used: 0 };
            return `<div class="spell-slot-row" data-spell-slot-level="${level}">
              <strong>N${level}</strong>
              <label>Máx.<input data-slot-field="maximum" type="number" min="0" step="1" value="${state.maximum}"></label>
              <label>Usados<input data-slot-field="used" type="number" min="0" max="${state.maximum}" step="1" value="${state.used}"></label>
              <button type="button" data-save-spell-slots>Guardar</button>
            </div>`;
          }).join("")}
        </div></details>
        ${includeSearchRow ? this.renderSpellDiscoveryTools(true, false) : `<div class="spell-discovery spell-property-tools">${this.renderSpellPropertyFilters()}</div>`}${this.renderSpellFilterBar(character)}
        <div class="collection-toolbar spell-toolbar">
          <label>Importar conjuro JSON<input id="import-spell-file" type="file" accept="application/json,.json"></label>
          <span>${entries.length} conjuros visibles</span>
        </div>
        <datalist id="spell-catalog-names">${this.spellCatalog().map((spell) => `<option value="${escapeHtml(spell.name)}"></option>`).join("")}</datalist>
        <div class="spell-cards">
          ${entries.map(({ spell, known, favorite }) => known
            ? this.renderSpellCard(character, spell)
            : this.renderCatalogSpellEditorCard(spell, favorite)).join("")}
          ${this.spellFilter === "all" ? this.renderSpellCard(character, null) : ""}
        </div>
      </fieldset>`;
  }

  private renderCatalogSpellEditorCard(spell: CharacterSpellV2, favorite: boolean): string {
    const definition = spell.definition;
    return `
      <details class="spell-card collapsible-editor catalog-editor-card" data-spell-card data-spell-name="${escapeHtml(spell.name)}" data-spell-search-value="${escapeHtml(this.spellSearchValue(spell))}">
        <summary class="editor-card-summary">
          <strong>${escapeHtml(spell.name)}</strong>
          <span class="catalog-editor-meta"><span>${spell.level === 0 ? "Truco" : `Nivel ${spell.level}`}</span>${definition?.school ? `<em class="school-badge" data-school-tone="${spellSchoolTone(definition.school)}">${escapeHtml(definition.school)}</em>` : ""}<span class="preparation-toggle catalog-preparation">No conocido</span></span>
        </summary>
        <div class="editor-card-body">
          <div class="spell-name-line"><h3>${escapeHtml(spell.name)}</h3>${definition ? `<span class="spell-inline-facts">${escapeHtml(compactCastingTime(definition.castingTime || "—"))} · ${escapeHtml(definition.range || "—")} · ${escapeHtml(definition.duration || "—")}</span>` : ""}</div>
          ${definition?.description ? this.renderCollapsibleSpellDescription(definition.description, `catalog:${normalizedSearchText(spell.name)}`) : ""}
          <div class="card-buttons">
            <button type="button" class="favorite-toggle ${favorite ? "active" : ""}" data-spell-action="favorite" aria-pressed="${favorite}" title="${favorite ? "Quitar de favoritos" : "Agregar a favoritos"}">${favorite ? "★" : "☆"}</button>
            <button type="button" data-spell-action="learn">Aprender</button>
          </div>
        </div>
      </details>`;
  }

  private renderSpellCard(character: CharacterV2, spell: CharacterSpellV2 | null): string {
    const definition = spell?.definition;
    const projection = projectSpellcasting(character);
    const attackRollMode = projectAdjustedRollMode(
      character,
      "combatStats",
      ["SpellAttackModifier", "SpellAttackandSave"],
      "normal",
    );
    const damage = spell ? projectSpellDamageExpression(character, spell) : "";
    const field = (name: string, value: string | number, attributes = "") =>
      `<input data-spell-field="${name}" value="${escapeHtml(String(value))}" ${attributes}>`;
    const minimumLevel = Math.max(1, spell?.level ?? 1);
    const availableSlotLevel = spell?.level === 0 ? 0 : spell
      ? Array.from({ length: 10 - minimumLevel }, (_, index) => minimumLevel + index).find((level) => {
          const slot = character.spellcasting.slots[String(level)] ?? { maximum: 0, used: 0 };
          return slot.used < slot.maximum;
        })
      : undefined;
    const ritualAvailable = definition?.ritual ?? false;
    const canLaunch = !!spell && (spell.level === 0 || (spell.prepared && availableSlotLevel !== undefined) || ritualAvailable);
    const initialCastLevel = spell?.level === 0
      ? 0
      : spell?.prepared && availableSlotLevel !== undefined
        ? availableSlotLevel
        : ritualAvailable
          ? "ritual"
          : minimumLevel;
    const slotOptions = spell
      ? spell.level === 0
        ? '<option value="0" data-cast-available="true">Truco</option>'
        : `${Array.from({ length: 10 - minimumLevel }, (_, index) => minimumLevel + index).map((level) => {
            const slot = character.spellcasting.slots[String(level)] ?? { maximum: 0, used: 0 };
            const disabled = !spell.prepared || slot.used >= slot.maximum;
            return `<option value="${level}" data-cast-available="${!disabled}" ${initialCastLevel === level ? "selected" : ""} ${disabled ? "disabled" : ""}>Nivel ${level} · ${Math.max(0, slot.maximum - slot.used)} disp.</option>`;
          }).join("")}${ritualAvailable ? `<option value="ritual" data-cast-available="true" ${initialCastLevel === "ritual" ? "selected" : ""}>Ritual · sin espacio</option>` : ""}`
      : "";
    return `
      <details class="spell-card collapsible-editor" data-spell-card data-spell-id="${spell?.id ?? ""}" data-spell-search-value="${spell ? escapeHtml(this.spellSearchValue(spell)) : ""}" ${spell ? "" : "open"}>
        <summary class="editor-card-summary"><strong>${escapeHtml(spell?.name ?? "Agregar conjuro")}</strong><span>${spell ? `${spell.level === 0 ? "Truco" : `Nivel ${spell.level}`} · ${spell.prepared ? "preparado" : "no preparado"}` : "Nuevo"}${definition?.school ? ` <em class="school-badge" data-school-tone="${spellSchoolTone(definition.school)}">${escapeHtml(definition.school)}</em>` : ""}</span></summary>
        <div class="editor-card-body">
        <div class="spell-card-heading">
          <label>Nombre${field("name", spell?.name ?? "", 'list="spell-catalog-names" placeholder="Nuevo conjuro"')}</label>
          ${spell ? `<span>Nivel ${spell.level} · ${spell.prepared ? "Preparado" : "No preparado"} · ${spell.source}</span>` : ""}
        </div>
        <div class="field-grid">
          <label>Nivel${field("level", spell?.level ?? 0, 'type="number" min="0" max="9" step="1"')}</label>
          <label class="checkbox"><input data-spell-field="prepared" type="checkbox" ${spell?.prepared ? "checked" : ""}> Preparado</label>
          <label>Tiempo${field("castingTime", definition?.castingTime ?? "")}</label>
          <label>Alcance${field("range", definition?.range ?? "")}</label>
          <label>Duración${field("duration", definition?.duration ?? "")}</label>
          <label>Componentes${field("components", definition?.components ?? "")}</label>
          <label>Material${field("material", definition?.material ?? "")}</label>
          <label>Escuela${field("school", definition?.school ?? "")}</label>
          <label>Clases${field("classes", definition?.classes ?? "")}</label>
          <label>Resolución<select data-spell-field="attackType">${[["none", "Sin ataque/CD"], ["attack", "Ataque"], ["save", "Salvación"]].map(([value, label]) => `<option value="${value}" ${definition?.attackType === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
          <label>Salvación${field("saveAbility", definition?.saveAbility ?? "")}</label>
          <label>Daño base${field("damageExpression", definition?.damageExpression ?? "", 'placeholder="2d6"')}</label>
          <label>Daño por nivel${field("upcastDamageExpression", definition?.upcastDamageExpression ?? "", 'placeholder="1d6"')}</label>
          <label>Tipo de daño${field("damageType", definition?.damageType ?? "")}</label>
          <label>Año/reglas${field("year", definition?.year ?? "2014")}</label>
          <label class="checkbox"><input data-spell-field="ritual" type="checkbox" ${definition?.ritual ? "checked" : ""}> Ritual</label>
          <label class="checkbox"><input data-spell-field="concentration" type="checkbox" ${definition?.concentration ? "checked" : ""}> Concentración</label>
          <label class="checkbox"><input data-spell-field="addAbilityModifier" type="checkbox" ${definition?.addAbilityModifier ? "checked" : ""}> Suma característica al daño</label>
        </div>
        <label>Descripción<textarea data-spell-field="description">${escapeHtml(definition?.description ?? "")}</textarea></label>
        <label>A niveles superiores<textarea data-spell-field="higherLevels">${escapeHtml(definition?.higherLevels ?? "")}</textarea></label>
        <div class="effect-editor"><label>Efecto breve<input data-spell-field="effectDescription" value="${escapeHtml(spell?.effect.description ?? "")}" placeholder="Ej.: +2 CA mientras mantenga concentración"></label><label>Estado<select data-spell-field="effectActive"><option value="off" ${spell?.effect.active ? "" : "selected"}>Inactivo</option><option value="on" ${spell?.effect.active ? "selected" : ""}>Activo</option></select></label></div>
        ${spell ? `<div class="spell-readout"><span>${definition?.attackType === "attack" ? `Ataque ${projection.attackModifier >= 0 ? "+" : ""}${projection.attackModifier}` : definition?.attackType === "save" ? `${definition.saveAbility.toUpperCase()} CD ${projection.saveDc}` : ""}</span><span>${damage ? `Daño ${escapeHtml(damage)}${definition?.damageType ? ` <em class="damage-badge" data-damage-tone="${spellDamageTone(definition.damageType)}">${escapeHtml(definition.damageType)}</em>` : ""}` : ""}</span></div>` : ""}
        <div class="card-buttons">
          ${spell && definition?.attackType === "attack" ? `<button type="button" class="roll-button" data-roll-name="Ataque de conjuro: ${escapeHtml(spell.name)}" data-roll-expression="1d20${projection.attackModifier >= 0 ? "+" : ""}${projection.attackModifier}" data-roll-mode="${attackRollMode}">Tirar ataque</button>` : ""}
          ${spell && damage ? `<button type="button" class="roll-button" data-roll-name="Daño de ${escapeHtml(spell.name)}" data-roll-expression="${escapeHtml(damage)}" data-roll-mode="normal">Tirar daño</button>` : ""}
          ${spell ? `<label>Nivel de lanzamiento<select data-cast-slot-level size="1">${slotOptions}</select></label><button type="button" data-spell-cast-control data-spell-action="cast" ${canLaunch ? "" : "disabled"}>Lanzar/gastar espacio</button><button type="button" data-spell-action="prepare">${spell.prepared ? "Despreparar" : "Preparar"}</button><button type="button" data-spell-action="export">Exportar</button>` : ""}
          <button type="button" data-load-spell-catalog>Cargar datos del catálogo</button>
          <button type="button" data-save-spell>${spell ? "Guardar conjuro" : "Agregar conjuro"}</button>
          ${spell ? '<button type="button" class="danger" data-spell-action="delete">Eliminar</button>' : ""}
        </div>
        </div>
      </details>`;
  }

  private renderTraits(character: CharacterV2): string {
    return `<fieldset><legend>Rasgos y características</legend>
      <div class="content-groups">
        ${character.traits.map((group) => `<section class="content-group" data-trait-group data-group-id="${group.id}">
          <div class="content-group-heading">
            <label>Grupo<input data-group-field="title" value="${escapeHtml(group.title)}"></label>
            <label>Orden<input data-group-field="order" type="number" min="0" value="${group.order}"></label>
            <label class="checkbox"><input data-group-field="collapsed" type="checkbox" ${group.collapsed ? "checked" : ""}> Colapsado</label>
            <button type="button" data-save-trait-group>Guardar grupo</button>
            <button type="button" class="danger" data-delete-trait-group>Eliminar grupo</button>
          </div>
          <div class="trait-cards">
            ${group.traits.map((trait) => this.renderTraitCard(group.id, trait)).join("")}
            ${this.renderTraitCard(group.id, null)}
          </div>
        </section>`).join("")}
        <section class="content-group" data-trait-group data-group-id="">
          <div class="content-group-heading">
            <label>Nuevo grupo<input data-group-field="title" value="" placeholder="Nombre del grupo"></label>
            <label>Orden<input data-group-field="order" type="number" min="0" value="${character.traits.length}"></label>
            <label class="checkbox"><input data-group-field="collapsed" type="checkbox"> Colapsado</label>
            <button type="button" data-save-trait-group>Agregar grupo</button>
          </div>
        </section>
      </div>
    </fieldset>`;
  }

  private renderTraitCard(groupId: string, trait: CharacterV2["traits"][number]["traits"][number] | null): string {
    const adjustment = trait?.adjustment;
    return `<details class="content-card collapsible-editor" data-trait-card data-group-id="${groupId}" data-trait-id="${trait?.id ?? ""}" ${trait ? "" : "open"}>
      <summary class="editor-card-summary"><strong>${escapeHtml(trait?.name ?? "Agregar rasgo")}</strong><span>${trait?.uses.maximum ? `${Math.max(0, trait.uses.maximum - trait.uses.used)}/${trait.uses.maximum} usos` : trait ? "Sin usos" : "Nuevo"}</span></summary><div class="editor-card-body">
      <div class="field-grid">
        <label>Nombre<input data-trait-field="name" value="${escapeHtml(trait?.name ?? "")}" placeholder="Nuevo rasgo"></label>
        <label>Orden<input data-trait-field="order" type="number" min="0" value="${trait?.order ?? 0}"></label>
        <label>Usos máximos<input data-trait-field="maximum" type="number" min="0" value="${trait?.uses.maximum ?? 0}"></label>
        <label>Usos gastados<input data-trait-field="used" type="number" min="0" max="${trait?.uses.maximum ?? 0}" value="${trait?.uses.used ?? 0}"></label>
        <label>Recuperación<select data-trait-field="reset">${[["none", "Ninguna"], ["short-rest", "Descanso corto"], ["long-rest", "Descanso largo"]].map(([value, label]) => `<option value="${value}" ${trait?.uses.reset === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <label class="checkbox"><input data-trait-field="collapsed" type="checkbox" ${trait?.collapsed ? "checked" : ""}> Colapsado</label>
      </div>
      <label>Descripción<textarea data-trait-field="description">${escapeHtml(trait?.description ?? "")}</textarea></label>
      <div class="effect-editor"><label>Efecto breve<input data-trait-field="effectDescription" value="${escapeHtml(trait?.effect.description ?? "")}" placeholder="Se mostrará en el resumen cuando esté activo"></label><label>Estado<select data-trait-field="effectActive"><option value="off" ${trait?.effect.active ? "" : "selected"}>Inactivo</option><option value="on" ${trait?.effect.active ? "selected" : ""}>Activo</option></select></label></div>
      <details class="item-details" ${adjustment ? "open" : ""}><summary>Ajuste de estadísticas</summary><div class="field-grid item-detail-grid">
        <label class="checkbox"><input data-trait-field="hasAdjustment" type="checkbox" ${adjustment ? "checked" : ""}> Tiene ajuste</label>
        <label>Categoría<input data-trait-field="adjustmentCategory" value="${escapeHtml(adjustment?.category ?? "")}"></label>
        <label>Subcategoría<input data-trait-field="adjustmentSubcategory" value="${escapeHtml(adjustment?.subcategory ?? "")}"></label>
        <label>Característica<input data-trait-field="adjustmentAbility" value="${escapeHtml(adjustment?.ability ?? "")}"></label>
        <label>Valor<input data-trait-field="adjustmentValue" type="number" step="any" value="${adjustment?.value ?? 0}"></label>
        <label class="checkbox"><input data-trait-field="advantage" type="checkbox" ${adjustment?.advantage ? "checked" : ""}> Ventaja</label>
        <label class="checkbox"><input data-trait-field="disadvantage" type="checkbox" ${adjustment?.disadvantage ? "checked" : ""}> Desventaja</label>
        <label class="checkbox"><input data-trait-field="applyToDerived" type="checkbox" ${adjustment?.applyToDerived ? "checked" : ""}> Aplicar a valores derivados</label>
      </div></details>
      <div class="card-buttons">
        ${trait ? '<button type="button" data-trait-use="-1">Recuperar uso</button><button type="button" data-trait-use="1">Gastar uso</button>' : ""}
        <button type="button" data-save-trait>${trait ? "Guardar rasgo" : "Agregar rasgo"}</button>
        ${trait ? '<button type="button" class="danger" data-delete-trait>Eliminar</button>' : ""}
      </div>
      </div>
    </details>`;
  }

  private renderNotes(character: CharacterV2): string {
    return `<fieldset><legend>Notas</legend><div class="content-groups">
      ${character.notes.map((group) => `<section class="content-group" data-note-group data-group-id="${group.id}">
        <div class="content-group-heading">
          <label>Grupo<input data-group-field="title" value="${escapeHtml(group.title)}"></label>
          <label>Orden<input data-group-field="order" type="number" min="0" value="${group.order}"></label>
          <label class="checkbox"><input data-group-field="collapsed" type="checkbox" ${group.collapsed ? "checked" : ""}> Colapsado</label>
          <button type="button" data-save-note-group>Guardar grupo</button>
          <button type="button" class="danger" data-delete-note-group>Eliminar grupo</button>
        </div>
        ${group.notes.map((note) => this.renderNoteCard(group.id, note)).join("")}
        ${this.renderNoteCard(group.id, null)}
      </section>`).join("")}
      <section class="content-group" data-note-group data-group-id=""><div class="content-group-heading">
        <label>Nuevo grupo<input data-group-field="title" value="" placeholder="Nombre del grupo"></label>
        <label>Orden<input data-group-field="order" type="number" min="0" value="${character.notes.length}"></label>
        <label class="checkbox"><input data-group-field="collapsed" type="checkbox"> Colapsado</label>
        <button type="button" data-save-note-group>Agregar grupo</button>
      </div></section>
    </div></fieldset>`;
  }

  private renderNoteCard(groupId: string, note: CharacterV2["notes"][number]["notes"][number] | null): string {
    return `<article class="content-card" data-note-card data-group-id="${groupId}" data-note-id="${note?.id ?? ""}">
      <div class="field-grid">
        <label>Título<input data-note-field="title" value="${escapeHtml(note?.title ?? "")}" placeholder="Nueva nota"></label>
        <label>Orden<input data-note-field="order" type="number" min="0" value="${note?.order ?? 0}"></label>
        <label>Etiquetas<input data-note-field="tags" value="${escapeHtml(note?.tags.join(", ") ?? "")}"></label>
      </div>
      <label>Contenido<textarea data-note-field="content">${escapeHtml(note?.content ?? "")}</textarea></label>
      <div class="card-buttons"><button type="button" data-save-note>${note ? "Guardar nota" : "Agregar nota"}</button>${note ? '<button type="button" class="danger" data-delete-note>Eliminar</button>' : ""}</div>
    </article>`;
  }

  private renderExtras(character: CharacterV2): string {
    return `<fieldset aria-label="Extras, mascotas y formas">
      <datalist id="monster-catalog-names">${allMonsterNames().map((name) => `<option value="${escapeHtml(name)}"></option>`).join("")}</datalist>
      <div class="extra-cards">
      ${character.extras.map((extra) => this.renderExtraCard(extra)).join("")}
      ${this.renderExtraCard(null)}
    </div></fieldset>`;
  }

  private renderExtraCard(extra: CharacterV2["extras"][number] | null): string {
    return `<article class="content-card" data-extra-card data-extra-id="${extra?.id ?? ""}">
      <div class="field-grid">
        <label>Nombre<input data-extra-field="name" list="monster-catalog-names" value="${escapeHtml(extra?.name ?? "")}" placeholder="Nueva criatura o forma"></label>
        <label>Orden<input data-extra-field="order" type="number" min="0" value="${extra?.order ?? 0}"></label>
        <label>PG actuales<input data-extra-field="current" type="number" value="${extra?.hitPoints.current ?? 0}"></label>
        <label>PG máximos<input data-extra-field="maximum" type="number" min="0" value="${extra?.hitPoints.maximum ?? 0}"></label>
        <label>PG temporales<input data-extra-field="temporary" type="number" min="0" value="${extra?.hitPoints.temporary ?? 0}"></label>
      </div>
      ${extra ? `<div class="condition-pills">${extra.conditions.length ? extra.conditions.map((condition) => `<span class="condition-pill">${escapeHtml(condition.label)}<button type="button" data-remove-extra-condition="${condition.id}">×</button></span>`).join("") : '<span class="muted">Sin condiciones</span>'}</div>
      <div class="resource-actions"><label>Condición<select data-extra-condition-select>${playerConditions.map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}</select></label><button type="button" data-add-extra-condition>Agregar condición</button></div>` : ""}
      <label>Stat block JSON<textarea data-extra-field="statBlock">${escapeHtml(JSON.stringify(extra?.statBlock ?? {}, null, 2))}</textarea></label>
      <div class="card-buttons">
        ${extra ? '<label>Cantidad<input data-extra-amount type="number" min="1" value="1"></label><button type="button" data-extra-hp="damage">Daño</button><button type="button" data-extra-hp="heal">Curar</button><button type="button" data-extra-hp="temporary">PG temp.</button>' : ""}
        <button type="button" data-load-extra-catalog>Cargar del bestiario</button>
        <button type="button" data-save-extra>${extra ? "Guardar extra" : "Agregar extra"}</button>
        ${extra ? '<button type="button" class="danger" data-delete-extra>Eliminar</button>' : ""}
      </div>
    </article>`;
  }

  private renderInventoryCard(
    character: CharacterV2,
    item: CharacterInventoryItemV2 | null,
  ): string {
    const charges = item?.charges;
    const armor = item?.armor;
    const weapon = item?.weapon;
    const field = (name: string, value: string | number, attributes = "") =>
      `<input data-inventory-field="${name}" value="${escapeHtml(String(value))}" ${attributes}>`;
    return `
      <details class="inventory-card collapsible-editor" data-inventory-card data-inventory-id="${item?.id ?? ""}" ${item ? "" : "open"}>
        <summary class="editor-card-summary"><strong>${escapeHtml(item?.name ?? "Agregar objeto")}</strong><span>${item ? `${item.quantity}× · ${escapeHtml(item.category)} · ${item.equipped ? "equipado" : "guardado"}` : "Nuevo"}</span></summary>
        <div class="editor-card-body">
        <div class="inventory-card-heading">
          <label>Nombre${field("name", item?.name ?? "", 'list="equipment-catalog-names" placeholder="Nuevo objeto"')}</label>
          ${item ? `<span>${item.equipped ? "Equipado" : "Guardado"}${item.attuned ? " · Sintonizado" : ""}</span>` : ""}
        </div>
        <div class="field-grid">
          <label>Grupo${field("group", item?.group ?? "backpack")}</label>
          <label>Categoría${field("category", item?.category ?? "adventuring-gear", 'placeholder="weapon, armor, potion…"')}</label>
          <label>Orden${field("order", item?.order ?? character.inventory.length, 'type="number" min="0" step="1"')}</label>
          <label>Cantidad${field("quantity", item?.quantity ?? 1, 'type="number" min="0" step="1"')}</label>
          <label>Peso unitario (lb)${field("unitWeight", item?.unitWeight ?? 0, 'type="number" min="0" step="any"')}</label>
          <label>Precio${field("costQuantity", item?.cost.quantity ?? 0, 'type="number" min="0" step="any"')}</label>
          <label>Moneda/unidad${field("costUnit", item?.cost.unit ?? "gp")}</label>
          <label>Propiedades${field("properties", item?.properties.join(", ") ?? "")}</label>
          <label class="checkbox"><input data-inventory-field="requiresAttunement" type="checkbox" ${item?.requiresAttunement ? "checked" : ""}> Requiere sintonización</label>
          <label class="checkbox"><input data-inventory-field="usable" type="checkbox" ${item?.usable ? "checked" : ""}> Se puede usar</label>
          <label class="checkbox"><input data-inventory-field="consumable" type="checkbox" ${item?.consumable ? "checked" : ""}> Consume cantidad</label>
        </div>
        <label>Descripción<textarea data-inventory-field="description">${escapeHtml(item?.description ?? "")}</textarea></label>
        <div class="effect-editor"><label>Efecto breve<input data-inventory-field="effectDescription" value="${escapeHtml(item?.effect.description ?? "")}" placeholder="Se mostrará en el resumen cuando esté activo"></label><label>Estado<select data-inventory-field="effectActive"><option value="off" ${item?.effect.active ? "" : "selected"}>Inactivo</option><option value="on" ${item?.effect.active ? "selected" : ""}>Activo</option></select></label></div>
        <label>Bonificaciones JSON<textarea data-inventory-field="bonuses" placeholder='[{"category":"skill","key":"perception","value":1,"advantage":false,"disadvantage":false}]'>${escapeHtml(JSON.stringify(item?.bonuses ?? [], null, 2))}</textarea></label>
        <details class="item-details" ${weapon || armor || charges ? "open" : ""}>
          <summary>Arma, armadura y cargas</summary>
          <div class="field-grid item-detail-grid">
            <label class="checkbox"><input data-inventory-field="hasWeapon" type="checkbox" ${weapon ? "checked" : ""}> Es arma</label>
            <label>Clase de arma${field("weaponCategory", weapon?.category ?? "")}</label>
            <label>Tipo de alcance${field("weaponRange", weapon?.range ?? "")}</label>
            <label>Alcance normal${field("normalRange", weapon?.normalRange ?? "", 'type="number" min="0" step="1"')}</label>
            <label>Alcance largo${field("longRange", weapon?.longRange ?? "", 'type="number" min="0" step="1"')}</label>
            <label>Dados de daño${field("damageExpression", weapon?.damageExpression ?? "", 'placeholder="1d8"')}</label>
            <label>Daño versátil${field("versatileDamageExpression", weapon?.versatileDamageExpression ?? "")}</label>
            <label>Tipo de daño${field("damageType", weapon?.damageType ?? "")}</label>
            <label>Bono de ataque${field("weaponAttackBonus", weapon?.attackBonus ?? 0, 'type="number" step="1"')}</label>
            <label>Bono de daño${field("weaponDamageBonus", weapon?.damageBonus ?? 0, 'type="number" step="1"')}</label>
            <label class="checkbox"><input data-inventory-field="hasArmor" type="checkbox" ${armor ? "checked" : ""}> Es armadura/escudo</label>
            <label>CA base/bono${field("armorBase", armor?.base ?? (item?.category === "shield" ? 2 : 10), 'type="number" step="1"')}</label>
            <label>Clase de armadura${field("armorCategory", armor?.armorCategory ?? "")}</label>
            <label class="checkbox"><input data-inventory-field="armorDexterityBonus" type="checkbox" ${armor?.dexterityBonus ? "checked" : ""}> Suma DES</label>
            <label>Tope de DES${field("maximumDexterityBonus", armor?.maximumDexterityBonus ?? "", 'type="number" min="0" step="1"')}</label>
            <label class="checkbox"><input data-inventory-field="stealthDisadvantage" type="checkbox" ${armor?.stealthDisadvantage ? "checked" : ""}> Desventaja en sigilo</label>
            <label class="checkbox"><input data-inventory-field="hasCharges" type="checkbox" ${charges ? "checked" : ""}> Tiene cargas</label>
            <label>Cargas actuales${field("currentCharges", charges?.current ?? 0, 'type="number" min="0" step="1"')}</label>
            <label>Cargas máximas${field("maximumCharges", charges?.maximum ?? 0, 'type="number" min="0" step="1"')}</label>
            <label>Recuperación${field("chargeReset", charges?.reset ?? "long-rest", 'placeholder="long-rest"')}</label>
          </div>
        </details>
        <div class="card-buttons">
          <button type="button" data-load-inventory-catalog>Cargar del catálogo</button>
          ${item?.usable ? '<button type="button" data-inventory-action="use">Usar</button>' : ""}
          ${item ? `<button type="button" data-inventory-action="equip">${item.equipped ? "Desequipar" : "Equipar"}</button>` : ""}
          ${item?.requiresAttunement && item.equipped ? `<button type="button" data-inventory-action="attune">${item.attuned ? "Romper sintonización" : "Sintonizar"}</button>` : ""}
          <button type="button" data-save-inventory>${item ? "Guardar objeto" : "Agregar objeto"}</button>
          ${item ? '<button type="button" class="secondary-button" data-inventory-action="export">Exportar JSON</button>' : ""}
          ${item ? '<button type="button" class="danger" data-inventory-action="delete">Eliminar</button>' : ""}
        </div>
        </div>
      </details>`;
  }

  private renderChecks(
    character: CharacterV2,
    projection: CharacterStatisticsProjection,
  ): string {
    const signed = (value: number): string => value >= 0 ? `+${value}` : String(value);
    const rankOptions = (current: number, save = false): string =>
      (save
        ? [[0, "No competente"], [1, "Competente"]]
        : [[0, "No competente"], [0.5, "Media competencia"], [1, "Competente"], [2, "Pericia"]])
        .map(([value, label]) => `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`)
        .join("");
    const modeOptions = (current: string): string => [
      ["normal", "Normal"],
      ["advantage", "Ventaja"],
      ["disadvantage", "Desventaja"],
    ].map(([value, label]) => `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`).join("");

    return `
      <fieldset><legend>Habilidades y salvaciones</legend>
        <div class="checks-layout">
          <div><h3>Habilidades</h3><div class="check-table">
            ${(Object.keys(SKILL_DEFINITIONS) as SkillKey[]).map((key) => {
              const definition = SKILL_DEFINITIONS[key];
              const state = character.checks.skills[key];
              const effectiveMode = projectAdjustedRollMode(
                character,
                "skills",
                [key, definition.label],
                state.rollMode,
              );
              return `<div class="check-row">
                <span><strong>${definition.label}</strong><small>${definition.ability}</small></span>
                <button type="button" class="roll-button" data-roll-name="${escapeHtml(definition.label)}" data-roll-expression="1d20${signed(projection.skills[key])}" data-roll-mode="${effectiveMode}">${signed(projection.skills[key])}</button>
                <select name="skill_${key}_rank" aria-label="Competencia en ${definition.label}">${rankOptions(state.proficiency)}</select>
                <input name="skill_${key}_bonus" type="number" step="1" value="${state.bonus}" aria-label="Bono adicional de ${definition.label}">
                <select name="skill_${key}_mode" aria-label="Modo de tirada de ${definition.label}">${modeOptions(state.rollMode)}</select>
              </div>`;
            }).join("")}
          </div></div>
          <div><h3>Salvaciones</h3><div class="check-table">
            ${(Object.keys(SAVE_DEFINITIONS) as SaveKey[]).map((key) => {
              const definition = SAVE_DEFINITIONS[key];
              const state = character.checks.savingThrows[key];
              const effectiveMode = projectAdjustedRollMode(
                character,
                "saves",
                [key, key.slice(0, 3)],
                state.rollMode,
              );
              return `<div class="check-row save-row">
                <span><strong>Sal. de ${ABILITY_ABBREVIATIONS[key]}</strong></span>
                <button type="button" class="roll-button" data-roll-name="Salvación de ${escapeHtml(definition.label)}" data-roll-expression="1d20${signed(projection.savingThrows[key])}" data-roll-mode="${effectiveMode}">${signed(projection.savingThrows[key])}</button>
                <select name="save_${key}_rank">${rankOptions(state.proficiency, true)}</select>
                <input name="save_${key}_bonus" type="number" step="1" value="${state.bonus}" aria-label="Bono adicional de salvación de ${definition.label}">
                <select name="save_${key}_mode">${modeOptions(state.rollMode)}</select>
              </div>`;
            }).join("")}
          </div>
          <h3>Pasivas</h3>
          <div class="passive-grid">
            <label>Percepción <strong>${projection.passives.perception}</strong><input name="passive_perception_bonus" type="number" value="${character.checks.passiveBonuses.perception}" title="Bono adicional"></label>
            <label>Investigación <strong>${projection.passives.investigation}</strong><input name="passive_investigation_bonus" type="number" value="${character.checks.passiveBonuses.investigation}" title="Bono adicional"></label>
            <label>Perspicacia <strong>${projection.passives.insight}</strong><input name="passive_insight_bonus" type="number" value="${character.checks.passiveBonuses.insight}" title="Bono adicional"></label>
          </div>
          <h3>Iniciativa</h3>
          <div class="field-grid">
            ${numberInput("initiativeBonus", "Bono adicional", character.checks.initiative.bonus)}
            <label>Modo de tirada<select name="initiativeMode">${modeOptions(character.checks.initiative.rollMode)}</select></label>
          </div></div>
        </div>
      </fieldset>`;
  }

  private renderResourcePanel(character: CharacterV2, projection: CharacterStatisticsProjection): string {
    const combat = character.combat;
    const hitPointRatio = combat.hitPoints.maximum > 0
      ? Math.min(1, Math.max(0, combat.hitPoints.current / combat.hitPoints.maximum))
      : 0;
    const hitPointLevel = Math.round(hitPointRatio * 100);
    const temporaryHitPointLevel = combat.hitPoints.maximum > 0
      ? Math.min(100, Math.round(combat.hitPoints.temporary / combat.hitPoints.maximum * 100))
      : 0;
    const temporaryHitPointBottom = Math.min(hitPointLevel, 100 - temporaryHitPointLevel);
    const hitPointHue = Math.round(hitPointRatio * 112);
    const deathSavesResolved = combat.deathSaves.successes >= 3 || combat.deathSaves.failures >= 3;
    const successDeathSaveMarks = [3, 2, 1]
      .map((threshold) => `<i class="death-save-mark success ${combat.deathSaves.successes >= threshold ? "achieved" : "pending"}" aria-hidden="true"></i>`)
      .join("");
    const failureDeathSaveMarks = [1, 2, 3]
      .map((threshold) => `<i class="death-save-mark failure ${combat.deathSaves.failures >= threshold ? "achieved" : "pending"}" aria-hidden="true"></i>`)
      .join("");
    return `
      <section class="resource-panel" aria-label="Recursos de combate">
        <div class="combat-resource-strip">
          <div class="hp-readout" style="--hp-level:${hitPointLevel}%;--hp-temp-level:${temporaryHitPointLevel}%;--hp-temp-bottom:${temporaryHitPointBottom}%;--hp-tone:hsl(${hitPointHue} 38% 43%)" role="meter" aria-label="Puntos de golpe" aria-valuemin="0" aria-valuemax="${combat.hitPoints.maximum}" aria-valuenow="${combat.hitPoints.current}" aria-valuetext="${combat.hitPoints.current} más ${combat.hitPoints.temporary} temporales de ${combat.hitPoints.maximum}"><span>Puntos de golpe</span><strong>${combat.hitPoints.current}${combat.hitPoints.temporary ? `<b> + ${combat.hitPoints.temporary}</b>` : ""}<small> / ${combat.hitPoints.maximum}</small></strong><em>${combat.hitPoints.temporary ? "Temp. en azul" : "PG actuales"}</em></div>
          <div class="hp-action-stack">
            <button type="button" data-hit-point-button data-resource-action="temporary">PG temp.</button>
            <button type="button" data-hit-point-button data-resource-action="heal">Curar</button>
            <label><span>Cantidad</span><input id="resource-amount" data-hit-point-amount aria-label="Cantidad de puntos de golpe" type="number" min="1" step="1" value="1"></label>
            <button type="button" class="damage-button" data-hit-point-button data-resource-action="damage">Daño</button>
          </div>
          <div class="death-save-control">
            <div class="death-save-meter" role="img" aria-label="Salvaciones de muerte: ${combat.deathSaves.successes} éxitos y ${combat.deathSaves.failures} fallos"><div class="death-save-track successes">${successDeathSaveMarks}</div><span class="death-save-midline"></span><div class="death-save-track failures">${failureDeathSaveMarks}</div></div>
            <div class="death-save-actions"><span class="death-save-title">Salv. muerte</span><button type="button" data-add-death-save="success" ${deathSavesResolved ? "disabled" : ""}>+ Éxito</button><button type="button" data-add-death-save="failure" ${deathSavesResolved ? "disabled" : ""}>+ Fallo</button><button type="button" class="death-save-reset" data-reset-death-saves ${combat.deathSaves.successes === 0 && combat.deathSaves.failures === 0 ? "disabled" : ""}>Reiniciar</button></div>
          </div>
          <div class="combat-passive-readouts" aria-label="Velocidad y puntuaciones pasivas"><div><span>Velocidad</span><strong>${escapeHtml(combat.speed || "—")}</strong></div><div title="Percepción pasiva"><span>Percepción</span><strong>${projection.passives.perception}</strong></div><div title="Investigación pasiva"><span>Investigación</span><strong>${projection.passives.investigation}</strong></div><div title="Perspicacia pasiva"><span>Perspicacia</span><strong>${projection.passives.insight}</strong></div></div>
        </div>
      </section>`;
  }

  private bindEvents(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-sheet-mode-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.sheetModeChoice;
        if (mode !== "play" && mode !== "edit") return;
        this.sheetMode = mode;
        this.storeSheetPreference("sheet-mode", mode);
        this.message = null;
        this.renderAfterSavingSummaryEditor();
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-sheet-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.dataset.sheetTab;
        if (!characterSheetTabs.some((candidate) => candidate.id === tab)) return;
        this.activeSheetTab = tab as CharacterSheetTab;
        this.storeSheetPreference("sheet-tab", this.activeSheetTab);
        this.message = null;
        this.renderAfterSavingSummaryEditor();
      });
    });
    this.root.querySelectorAll<HTMLSelectElement>("#theme").forEach((select) => {
      select.addEventListener("change", () => this.updatePreferences());
    });
    this.root.querySelector<HTMLSelectElement>("#character-title-select")?.addEventListener("change", (event) => {
      this.selectedCharacterId = (event.currentTarget as HTMLSelectElement).value;
      this.message = null;
      this.renderAfterSavingSummaryEditor();
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-character-color-value]").forEach((button) => {
      button.addEventListener("click", () => this.applyCharacterColor(button.dataset.characterColorValue ?? ""));
    });
    const characterColorInput = this.root.querySelector<HTMLInputElement>("#character-color");
    this.root.querySelector<HTMLButtonElement>("#apply-character-color")?.addEventListener("click", () => {
      this.applyCharacterColor(characterColorInput?.value ?? "");
    });
    characterColorInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.applyCharacterColor(characterColorInput.value);
    });
    const currencyInputs = [...this.root.querySelectorAll<HTMLInputElement>("[data-currency-amount]")];
    const currencyTarget = this.root.querySelector<HTMLSelectElement>("[data-currency-batch-target]");
    const currencyBatchButtons = [...this.root.querySelectorAll<HTMLButtonElement>("[data-currency-batch-action]")];
    const currencyAmounts = (): Record<CurrencyDenomination, number> => Object.fromEntries(
      CURRENCY_DENOMINATIONS.map((denomination) => [
        denomination.key,
        Number(this.root.querySelector<HTMLInputElement>(`[data-currency-amount="${denomination.key}"]`)?.value),
      ]),
    ) as Record<CurrencyDenomination, number>;
    const updateCurrencyBatchButtons = () => {
      const amounts = currencyAmounts();
      const validAmounts = CURRENCY_DENOMINATIONS.every((denomination) => Number.isSafeInteger(amounts[denomination.key]) && amounts[denomination.key] >= 0);
      const requested = validAmounts ? CURRENCY_DENOMINATIONS.reduce(
        (total, denomination) => total + amounts[denomination.key] * denomination.copperValue,
        0,
      ) : Number.NaN;
      const character = this.snapshot && this.selectedCharacterId
        ? this.snapshot.campaign.characters[this.selectedCharacterId]
        : null;
      const available = character ? currencyTotalInCopper(character.currency) : 0;
      currencyBatchButtons.forEach((button) => {
        const action = button.dataset.currencyBatchAction;
        button.disabled = !validAmounts || requested <= 0 ||
          ((action === "remove" || action === "transfer") && requested > available) ||
          (action === "transfer" && !currencyTarget?.value);
      });
    };
    currencyInputs.forEach((input) => input.addEventListener("input", updateCurrencyBatchButtons));
    currencyTarget?.addEventListener("change", updateCurrencyBatchButtons);
    updateCurrencyBatchButtons();
    currencyBatchButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.currencyBatchAction;
        if (action === "add" || action === "remove") void this.adjustCharacterCurrencyBatch(action, currencyAmounts());
        if (action === "transfer") void this.transferCurrencyBatch(currencyTarget?.value ?? "", currencyAmounts());
      });
    });
    this.root.querySelector<HTMLButtonElement>("[data-reset-currency-controls]")?.addEventListener("click", () => {
      currencyInputs.forEach((input) => { input.value = "0"; });
      updateCurrencyBatchButtons();
    });
    this.root.querySelector<HTMLButtonElement>("[data-close-currency-manager]")?.addEventListener("click", (event) => {
      const manager = (event.currentTarget as HTMLButtonElement).closest<HTMLDetailsElement>(".currency-manager");
      if (manager) manager.open = false;
    });
    this.root.querySelectorAll<HTMLElement>("[data-select-character]").forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedCharacterId = button.dataset.selectCharacter ?? null;
        this.message = null;
        this.renderAfterSavingSummaryEditor();
      });
    });
    this.root.querySelector<HTMLFormElement>("#import-form")
      ?.addEventListener("submit", (event) => void this.importCampaign(event));
    this.root.querySelector<HTMLButtonElement>("#create-empty-campaign")
      ?.addEventListener("click", () => void this.createEmptyCampaign());
    const characterForm = this.root.querySelector<HTMLFormElement>("#character-form");
    characterForm?.addEventListener("submit", (event) => void this.saveCharacter(event));
    characterForm?.addEventListener("focusout", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.matches("input[name], select[name], textarea[name]")) return;
        if (this.autoSaveTimer !== null) window.clearTimeout(this.autoSaveTimer);
        this.autoSaveTimer = window.setTimeout(() => {
          this.autoSaveTimer = null;
          if (characterForm.isConnected) characterForm.requestSubmit();
        }, 700);
      });
    this.root.querySelector<HTMLButtonElement>("#import-current-campaign")
      ?.addEventListener("click", () => void this.importCurrentCampaign());
    this.root.querySelector<HTMLButtonElement>("#link-miniature")
      ?.addEventListener("click", () => void this.linkSelectedMiniature());
    this.root.querySelector<HTMLButtonElement>("#create-character")
      ?.addEventListener("click", () => void this.createCharacter());
    this.root.querySelector<HTMLButtonElement>("#export-character")
      ?.addEventListener("click", () => this.exportCharacter());
    this.root.querySelector<HTMLButtonElement>("#delete-character")
      ?.addEventListener("click", () => void this.deleteCharacter());
    this.root.querySelector<HTMLInputElement>("#import-character-file")
      ?.addEventListener("change", (event) => void this.importCharacterFile(event, false));
    this.root.querySelector<HTMLInputElement>("#import-ddb-file")
      ?.addEventListener("change", (event) => void this.importCharacterFile(event, true));
    this.root.querySelector<HTMLButtonElement>("#import-character-clipboard")
      ?.addEventListener("click", () => void this.importCharacterClipboard());
    this.root.querySelector<HTMLButtonElement>("#request-initiative-list")
      ?.addEventListener("click", () => void this.requestInitiativeList());
    this.root.querySelector<HTMLButtonElement>("#send-character-summary")
      ?.addEventListener("click", () => void this.sendCharacterSummary());
    this.root.querySelector<HTMLButtonElement>("#run-sync-probe")
      ?.addEventListener("click", () => void this.runSyncTransportProbe());
    this.root.querySelector<HTMLButtonElement>("#refresh-sync-peers")
      ?.addEventListener("click", () => void this.refreshSyncPeers());
    this.root.querySelector<HTMLButtonElement>("#roll-initiative")
      ?.addEventListener("click", () => void this.rollInitiative());
    this.root.querySelector<HTMLButtonElement>("#send-initiative")
      ?.addEventListener("click", () => void this.sendInitiative());
    this.root.querySelectorAll<HTMLButtonElement>("[data-resource-action]").forEach((button) => {
      button.addEventListener("click", () => void this.handleResourceAction(button.dataset.resourceAction ?? ""));
    });
    const hitPointAmount = this.root.querySelector<HTMLInputElement>("[data-hit-point-amount]");
    const updateHitPointButtons = (): void => {
      const enabled = isValidHitPointAmount(hitPointAmount?.value ?? "");
      this.root.querySelectorAll<HTMLButtonElement>("[data-hit-point-button]").forEach((button) => {
        button.disabled = !enabled;
      });
    };
    hitPointAmount?.addEventListener("input", updateHitPointButtons);
    updateHitPointButtons();
    this.root.querySelectorAll<HTMLButtonElement>("[data-add-death-save]").forEach((button) => {
      button.addEventListener("click", () => void this.addDeathSave(button.dataset.addDeathSave));
    });
    this.root.querySelector<HTMLButtonElement>("[data-reset-death-saves]")?.addEventListener("click", () => {
      void this.applyResourceAction({ kind: "set-death-saves", successes: 0, failures: 0 }, "Salvaciones de muerte reiniciadas.");
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-toggle-condition]").forEach((button) => {
      button.addEventListener("click", () => {
        const conditionId = button.dataset.conditionId;
        const key = button.dataset.toggleCondition;
        const label = button.dataset.conditionLabel;
        if (conditionId) {
          void this.applyResourceAction({ kind: "remove-condition", conditionId }, `${label ?? "Condición"} desactivada.`);
        } else if (key && label) {
          void this.applyResourceAction({ kind: "add-condition", key, label, level: null }, `${label} activada.`);
        }
      });
    });
    this.root.querySelector<HTMLSelectElement>("#action-filter")
      ?.addEventListener("change", (event) => {
        this.actionFilter = (event.currentTarget as HTMLSelectElement).value;
        this.render();
      });
    this.root.querySelectorAll<HTMLButtonElement>("[data-action-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        this.actionFilter = button.dataset.actionFilter ?? "all";
        this.render();
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-save-action]").forEach((button) => {
      button.addEventListener("click", () => void this.saveAction(button));
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-delete-action]").forEach((button) => {
      button.addEventListener("click", () => void this.deleteAction(button));
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-save-inventory]").forEach((button) => {
      button.addEventListener("click", () => void this.saveInventoryItem(button));
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-load-inventory-catalog]").forEach((button) => {
      button.addEventListener("click", () => this.loadInventoryCardFromCatalog(button));
    });
    this.root.querySelector<HTMLInputElement>("#import-equipment-file")
      ?.addEventListener("change", (event) => void this.importEquipment(event));
    this.root.querySelectorAll<HTMLButtonElement>("[data-inventory-action]").forEach((button) => {
      button.addEventListener("click", () => void this.handleInventoryAction(button));
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-reset-inventory-charges]").forEach((button) => {
      button.addEventListener("click", () => void this.resetInventoryCharges(button));
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-inventory-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        const filter = button.dataset.inventoryFilter;
        if (!filter) return;
        if (this.inventoryFilters.has(filter)) this.inventoryFilters.delete(filter);
        else this.inventoryFilters.add(filter);
        this.render();
      });
    });
    this.root.querySelector<HTMLButtonElement>("[data-clear-inventory-filters]")?.addEventListener("click", () => {
      this.inventoryFilters.clear();
      this.render();
    });
    this.root.querySelector<HTMLButtonElement>("[data-include-unowned-inventory]")?.addEventListener("click", () => {
      this.includeUnownedInventory = !this.includeUnownedInventory;
      this.render();
    });
    this.root.querySelector<HTMLButtonElement>("[data-toggle-inventory-descriptions]")?.addEventListener("click", () => {
      this.showInventoryDescriptions = !this.showInventoryDescriptions;
      try {
        window.localStorage.setItem(
          "talespire-5e-toolset:v2:inventory-descriptions",
          this.showInventoryDescriptions ? "shown" : "hidden",
        );
      } catch { /* La preferencia sigue activa durante la sesión. */ }
      this.render();
    });
    this.root.querySelector<HTMLInputElement>("#inventory-search")?.addEventListener("input", (event) => {
      const input = event.currentTarget as HTMLInputElement;
      this.inventorySearch = input.value;
      const selection = input.selectionStart ?? input.value.length;
      this.render();
      const replacement = this.root.querySelector<HTMLInputElement>("#inventory-search");
      replacement?.focus();
      replacement?.setSelectionRange(selection, selection);
    });
    this.root.querySelector<HTMLButtonElement>("[data-clear-inventory-search]")?.addEventListener("click", () => {
      this.inventoryFilters.clear();
      this.inventorySearch = "";
      this.render();
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-toggle-inventory-description]").forEach((button) => {
      const container = button.closest<HTMLElement>("[data-inventory-description]");
      const description = container?.querySelector<HTMLElement>(".card-description");
      if (!container || !description) return;
      const key = container.dataset.inventoryDescription;
      if (!container.classList.contains("expanded") && description.clientHeight > 0 && description.scrollHeight <= description.clientHeight + 1) button.hidden = true;
      button.addEventListener("click", () => {
        const expanded = !container.classList.contains("expanded");
        container.classList.toggle("expanded", expanded);
        button.textContent = expanded ? "Leer menos" : "Leer más";
        button.setAttribute("aria-expanded", String(expanded));
        if (key) {
          if (expanded) this.expandedInventoryDescriptions.add(key);
          else this.expandedInventoryDescriptions.delete(key);
        }
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-inventory-quantity]").forEach((button) => {
      button.addEventListener("click", () => void this.adjustInventoryQuantity(button));
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-add-catalog-inventory]").forEach((button) => {
      button.addEventListener("click", () => void this.addCatalogInventoryItem(button.dataset.addCatalogInventory ?? ""));
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-transfer-inventory-item]").forEach((button) => {
      const card = button.closest<HTMLElement>("[data-inventory-card]");
      const target = card?.querySelector<HTMLSelectElement>("[data-item-transfer-target]");
      const quantity = card?.querySelector<HTMLInputElement>("[data-item-transfer-quantity]");
      const update = () => {
        const amount = Number(quantity?.value);
        const maximum = Number(quantity?.max);
        button.disabled = !target?.value || !Number.isSafeInteger(amount) || amount <= 0 || amount > maximum;
      };
      target?.addEventListener("change", update);
      quantity?.addEventListener("input", update);
      update();
      button.addEventListener("click", () => void this.transferInventoryItemFromCard(button));
    });
    this.root.querySelector<HTMLButtonElement>("#save-spell-settings")
      ?.addEventListener("click", () => void this.saveSpellcastingSettings());
    this.root.querySelectorAll<HTMLButtonElement>("[data-save-spell-slots]").forEach((button) => {
      button.addEventListener("click", () => void this.saveSpellSlots(button));
    });
    this.root.querySelector<HTMLSelectElement>("#spell-filter")
      ?.addEventListener("change", (event) => {
        this.spellFilter = (event.currentTarget as HTMLSelectElement).value;
        this.render();
      });
    this.root.querySelectorAll<HTMLButtonElement>("[data-spell-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        this.spellFilter = button.dataset.spellFilter ?? "all";
        this.render();
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-spell-property-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        const filter = button.dataset.spellPropertyFilter;
        if (!filter) return;
        if (this.spellPropertyFilters.has(filter)) this.spellPropertyFilters.delete(filter);
        else this.spellPropertyFilters.add(filter);
        this.render();
      });
    });
    this.root.querySelector<HTMLButtonElement>("[data-clear-spell-properties]")?.addEventListener("click", () => {
      this.spellPropertyFilters.clear();
      this.render();
    });
    this.root.querySelector<HTMLButtonElement>("[data-include-unknown-spells]")?.addEventListener("click", () => {
      this.includeUnknownSpells = !this.includeUnknownSpells;
      this.render();
    });
    this.root.querySelector<HTMLButtonElement>("[data-toggle-spell-descriptions]")?.addEventListener("click", () => {
      this.showSpellDescriptions = !this.showSpellDescriptions;
      try {
        window.localStorage.setItem(
          "talespire-5e-toolset:v2:spell-descriptions",
          this.showSpellDescriptions ? "shown" : "hidden",
        );
      } catch { /* The preference remains active for the current session. */ }
      this.render();
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-toggle-spell-description]").forEach((button) => {
      const container = button.closest<HTMLElement>("[data-spell-description]");
      const description = container?.querySelector<HTMLElement>(".card-description");
      if (!container || !description) return;
      const key = container.dataset.spellDescription;
      if (!container.classList.contains("expanded") && description.clientHeight > 0 && description.scrollHeight <= description.clientHeight + 1) {
        button.hidden = true;
      }
      button.addEventListener("click", () => {
        const expanded = !container.classList.contains("expanded");
        container.classList.toggle("expanded", expanded);
        button.textContent = expanded ? "Leer menos" : "Leer más";
        button.setAttribute("aria-expanded", String(expanded));
        if (key) {
          if (expanded) this.expandedSpellDescriptions.add(key);
          else this.expandedSpellDescriptions.delete(key);
        }
      });
    });
    this.root.querySelector<HTMLButtonElement>("[data-clear-spell-filters]")?.addEventListener("click", () => {
      this.spellFilter = "all";
      this.spellPropertyFilters.clear();
      this.spellSearch = "";
      this.render();
    });
    this.root.querySelector<HTMLInputElement>("#spell-search")?.addEventListener("input", (event) => {
      const input = event.currentTarget as HTMLInputElement;
      this.spellSearch = input.value;
      const selection = input.selectionStart ?? input.value.length;
      this.render();
      const replacement = this.root.querySelector<HTMLInputElement>("#spell-search");
      replacement?.focus();
      replacement?.setSelectionRange(selection, selection);
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-save-spell]").forEach((button) => {
      button.addEventListener("click", () => void this.saveSpell(button));
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-spell-action]").forEach((button) => {
      button.addEventListener("click", () => void this.handleSpellAction(button));
    });
    this.root.querySelectorAll<HTMLSelectElement>("[data-cast-slot-level]").forEach((select) => {
      select.addEventListener("change", () => this.updateSpellCastPreview(select));
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-load-spell-catalog]").forEach((button) => {
      button.addEventListener("click", () => this.loadSpellCardFromCatalog(button));
    });
    this.root.querySelector<HTMLInputElement>("#import-spell-file")
      ?.addEventListener("change", (event) => void this.importSpell(event));
    this.root.querySelectorAll<HTMLButtonElement>("[data-save-trait-group]").forEach((button) => button.addEventListener("click", () => void this.saveTraitGroup(button)));
    this.root.querySelectorAll<HTMLButtonElement>("[data-delete-trait-group]").forEach((button) => button.addEventListener("click", () => void this.deleteTraitGroup(button)));
    this.root.querySelectorAll<HTMLButtonElement>("[data-save-trait]").forEach((button) => button.addEventListener("click", () => void this.saveTrait(button)));
    this.root.querySelectorAll<HTMLButtonElement>("[data-delete-trait]").forEach((button) => button.addEventListener("click", () => void this.deleteTrait(button)));
    this.root.querySelectorAll<HTMLButtonElement>("[data-trait-use]").forEach((button) => button.addEventListener("click", () => void this.changeTraitUse(button)));
    this.root.querySelectorAll<HTMLButtonElement>("[data-save-note-group]").forEach((button) => button.addEventListener("click", () => void this.saveNoteGroup(button)));
    this.root.querySelectorAll<HTMLButtonElement>("[data-delete-note-group]").forEach((button) => button.addEventListener("click", () => void this.deleteNoteGroup(button)));
    this.root.querySelectorAll<HTMLButtonElement>("[data-save-note]").forEach((button) => button.addEventListener("click", () => void this.saveNote(button)));
    this.root.querySelectorAll<HTMLButtonElement>("[data-delete-note]").forEach((button) => button.addEventListener("click", () => void this.deleteNote(button)));
    this.root.querySelectorAll<HTMLButtonElement>("[data-save-extra]").forEach((button) => button.addEventListener("click", () => void this.saveExtra(button)));
    this.root.querySelectorAll<HTMLButtonElement>("[data-delete-extra]").forEach((button) => button.addEventListener("click", () => void this.deleteExtra(button)));
    this.root.querySelectorAll<HTMLButtonElement>("[data-extra-hp]").forEach((button) => button.addEventListener("click", () => void this.applyExtraHp(button)));
    this.root.querySelectorAll<HTMLButtonElement>("[data-load-extra-catalog]").forEach((button) => button.addEventListener("click", () => this.loadExtraFromCatalog(button)));
    this.root.querySelectorAll<HTMLButtonElement>("[data-add-extra-condition]").forEach((button) => button.addEventListener("click", () => void this.addExtraCondition(button)));
    this.root.querySelectorAll<HTMLButtonElement>("[data-remove-extra-condition]").forEach((button) => button.addEventListener("click", () => void this.removeExtraCondition(button)));
    this.root.querySelectorAll<HTMLSelectElement>("[data-effect-toggle]").forEach((select) => {
      select.addEventListener("change", () => void this.toggleActiveEffect(select));
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-arm-combat-action]").forEach((button) => {
      button.addEventListener("click", () => this.armCombatExecution(button));
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-history-action]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.historyAction === "undo") void this.undoLastAction();
        if (button.dataset.historyAction === "redo") void this.redoLastAction();
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-roll-expression]").forEach((button) => {
      button.addEventListener("click", () => void this.rollDice(button));
    });
  }

  private appendActionLog(
    label: string,
    kind: SessionActionLogEntry["kind"] = "action",
    characterId: string | null = this.selectedCharacterId,
  ): void {
    if (!characterId) return;
    const actionLog = this.actionLogs.get(characterId) ?? [];
    actionLog.push({ id: this.nextHistoryId++, label, occurredAt: new Date().toISOString(), kind });
    if (actionLog.length > 100) actionLog.splice(0, actionLog.length - 100);
    this.actionLogs.set(characterId, actionLog);
  }

  private acceptCharacterSnapshot(
    snapshot: CampaignSnapshot,
    label: string,
    relatedCharacterIds: string[] = [],
  ): void {
    const characterId = this.selectedCharacterId;
    const before = this.snapshot && characterId ? this.snapshot.campaign.characters[characterId] : undefined;
    const after = characterId ? snapshot.campaign.characters[characterId] : undefined;
    const relatedCharacters = characterId && this.snapshot
      ? [...new Set(relatedCharacterIds)]
        .filter((id) => id !== characterId)
        .flatMap((id) => {
          const relatedBefore = this.snapshot?.campaign.characters[id];
          const relatedAfter = snapshot.campaign.characters[id];
          return relatedBefore && relatedAfter
            ? [{ characterId: id, before: structuredClone(relatedBefore), after: structuredClone(relatedAfter) }]
            : [];
        })
      : [];
    this.snapshot = snapshot;
    if (!characterId || !before || !after) {
      this.appendActionLog(label, "action", characterId);
      return;
    }
    const undoStack = this.undoStacks.get(characterId) ?? [];
    undoStack.push({
      type: "character",
      id: this.nextHistoryId++,
      label,
      characterId,
      before: structuredClone(before),
      after: structuredClone(after),
      relatedCharacters,
      occurredAt: new Date().toISOString(),
    });
    if (undoStack.length > 30) undoStack.shift();
    this.undoStacks.set(characterId, undoStack);
    this.redoStacks.set(characterId, []);
    this.appendActionLog(label, "action", characterId);
  }

  private armCombatExecution(button: HTMLButtonElement): void {
    const card = button.closest<HTMLElement>("[data-combat-execution-key]");
    if (!card) return;
    const key = card.dataset.combatExecutionKey;
    if (!key) return;
    const before = [...(this.combatExecutions.get(key) ?? [])];
    const beforeDamage = this.combatExecutionDamage.get(key) ?? null;
    this.armCombatExecutionCard(card);
    const label = `Lanzar ${card.dataset.combatName || "acción"}`;
    this.recordCombatAction(label, key, before, beforeDamage);
    this.message = { kind: "success", text: `${card.dataset.combatName || "Acción"}: ataque y daño habilitados.` };
    this.render();
  }

  private armCombatExecutionCard(card: HTMLElement): void {
    const key = card.dataset.combatExecutionKey;
    if (!key) return;
    const available = new Set<CombatResolutionKind>();
    card.querySelectorAll<HTMLButtonElement>("[data-combat-roll]").forEach((button) => {
      if (button.dataset.combatRoll === "attack" || button.dataset.combatRoll === "damage") {
        available.add(button.dataset.combatRoll);
      }
    });
    if (available.size) this.combatExecutions.set(key, available);
    const damage = card.querySelector<HTMLButtonElement>('[data-combat-roll="damage"]')?.dataset.rollExpression;
    if (damage) this.combatExecutionDamage.set(key, damage);
  }

  private consumeCombatResolution(button: HTMLButtonElement): void {
    const card = button.closest<HTMLElement>("[data-combat-execution-key]");
    const key = card?.dataset.combatExecutionKey;
    const kind = button.dataset.combatRoll;
    if (!key || (kind !== "attack" && kind !== "damage")) return;
    const before = [...(this.combatExecutions.get(key) ?? [])];
    const beforeDamage = this.combatExecutionDamage.get(key) ?? null;
    const pending = this.combatExecutions.get(key);
    pending?.delete(kind);
    if (!pending?.size) {
      this.combatExecutions.delete(key);
      this.combatExecutionDamage.delete(key);
    }
    this.recordCombatAction(
      `${kind === "attack" ? "Resolver ataque" : "Resolver daño"}: ${card?.dataset.combatName || "acción"}`,
      key,
      before,
      beforeDamage,
    );
  }

  private recordCombatAction(
    label: string,
    executionKey: string,
    before: CombatResolutionKind[],
    beforeDamage: string | null,
  ): void {
    const characterId = this.selectedCharacterId;
    if (!characterId) return;
    const undoStack = this.undoStacks.get(characterId) ?? [];
    undoStack.push({
      type: "combat",
      id: this.nextHistoryId++,
      label,
      characterId,
      executionKey,
      before,
      after: [...(this.combatExecutions.get(executionKey) ?? [])],
      beforeDamage,
      afterDamage: this.combatExecutionDamage.get(executionKey) ?? null,
      occurredAt: new Date().toISOString(),
    });
    if (undoStack.length > 30) undoStack.shift();
    this.undoStacks.set(characterId, undoStack);
    this.redoStacks.set(characterId, []);
    this.appendActionLog(label, "action", characterId);
  }

  private restoreCombatAction(entry: ReversibleCombatAction, state: "before" | "after"): void {
    const kinds = entry[state];
    const damage = state === "before" ? entry.beforeDamage : entry.afterDamage;
    if (kinds.length) this.combatExecutions.set(entry.executionKey, new Set(kinds));
    else this.combatExecutions.delete(entry.executionKey);
    if (damage) this.combatExecutionDamage.set(entry.executionKey, damage);
    else this.combatExecutionDamage.delete(entry.executionKey);
  }

  private clearCombatForCharacters(characterIds: string[]): void {
    const ids = new Set(characterIds);
    for (const key of this.combatExecutions.keys()) {
      if ([...ids].some((id) => key.includes(`:${id}:`))) this.combatExecutions.delete(key);
    }
    for (const key of this.combatExecutionDamage.keys()) {
      if ([...ids].some((id) => key.includes(`:${id}:`))) this.combatExecutionDamage.delete(key);
    }
  }

  private async undoLastAction(): Promise<void> {
    const characterId = this.selectedCharacterId;
    if (!this.snapshot || !characterId) return;
    const undoStack = this.undoStacks.get(characterId) ?? [];
    const entry = undoStack.pop();
    if (!entry) return;
    this.undoStacks.set(characterId, undoStack);
    const redoStack = this.redoStacks.get(characterId) ?? [];
    if (entry.type === "combat") {
      this.restoreCombatAction(entry, "before");
      redoStack.push(entry);
      this.redoStacks.set(characterId, redoStack);
      this.appendActionLog(`Deshacer: ${entry.label}`, "undo", characterId);
      this.message = { kind: "success", text: `Deshecho: ${entry.label}` };
      this.render();
      return;
    }
    const changes = [
      { characterId: entry.characterId, before: entry.before, after: entry.after },
      ...entry.relatedCharacters,
    ];
    try {
      this.snapshot = await this.application.restoreCharacterStates({
        expectedCampaignChecksum: this.snapshot.checksum,
        characters: changes.map((change) => {
          const current = this.snapshot!.campaign.characters[change.characterId];
          if (!current) throw new Error("Uno de los personajes de la acción ya no está disponible.");
          return {
            characterId: change.characterId,
            character: change.before,
            expectedCharacterRevision: current.revision,
          };
        }),
      });
      redoStack.push(entry);
      this.redoStacks.set(characterId, redoStack);
      this.clearCombatForCharacters(changes.map((change) => change.characterId));
      this.appendActionLog(`Deshacer: ${entry.label}`, "undo", characterId);
      for (const related of entry.relatedCharacters) {
        this.appendActionLog(`Transferencia revertida: ${entry.label}`, "undo", related.characterId);
      }
      this.message = { kind: "success", text: `Deshecho: ${entry.label}` };
      await this.refreshStorageUsage();
      this.render();
    } catch (error) {
      undoStack.push(entry);
      this.undoStacks.set(characterId, undoStack);
      this.message = { kind: "error", text: formatError(error) };
      await this.reload();
    }
  }

  private async redoLastAction(): Promise<void> {
    const characterId = this.selectedCharacterId;
    if (!this.snapshot || !characterId) return;
    const redoStack = this.redoStacks.get(characterId) ?? [];
    const entry = redoStack.pop();
    if (!entry) return;
    this.redoStacks.set(characterId, redoStack);
    const undoStack = this.undoStacks.get(characterId) ?? [];
    if (entry.type === "combat") {
      this.restoreCombatAction(entry, "after");
      undoStack.push(entry);
      this.undoStacks.set(characterId, undoStack);
      this.appendActionLog(`Rehacer: ${entry.label}`, "redo", characterId);
      this.message = { kind: "success", text: `Rehecho: ${entry.label}` };
      this.render();
      return;
    }
    const changes = [
      { characterId: entry.characterId, before: entry.before, after: entry.after },
      ...entry.relatedCharacters,
    ];
    try {
      this.snapshot = await this.application.restoreCharacterStates({
        expectedCampaignChecksum: this.snapshot.checksum,
        characters: changes.map((change) => {
          const current = this.snapshot!.campaign.characters[change.characterId];
          if (!current) throw new Error("Uno de los personajes de la acción ya no está disponible.");
          return {
            characterId: change.characterId,
            character: change.after,
            expectedCharacterRevision: current.revision,
          };
        }),
      });
      undoStack.push(entry);
      this.undoStacks.set(characterId, undoStack);
      this.clearCombatForCharacters(changes.map((change) => change.characterId));
      this.appendActionLog(`Rehacer: ${entry.label}`, "redo", characterId);
      for (const related of entry.relatedCharacters) {
        this.appendActionLog(`Transferencia reaplicada: ${entry.label}`, "redo", related.characterId);
      }
      this.message = { kind: "success", text: `Rehecho: ${entry.label}` };
      await this.refreshStorageUsage();
      this.render();
    } catch (error) {
      redoStack.push(entry);
      this.redoStacks.set(characterId, redoStack);
      this.message = { kind: "error", text: formatError(error) };
      await this.reload();
    }
  }

  private storeSheetPreference(key: "sheet-mode" | "sheet-tab", value: string): void {
    try { window.localStorage.setItem(`talespire-5e-toolset:v2:${key}`, value); }
    catch { /* The selected view remains active for the current session. */ }
  }

  private renderAfterSavingSummaryEditor(): void {
    const form = this.root.querySelector<HTMLFormElement>("#character-form");
    if (!form) {
      this.render();
      return;
    }
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    form.requestSubmit();
  }

  private updatePreferences(): void {
    const theme = this.root.querySelector<HTMLSelectElement>("#theme")?.value;
    if (theme === "dark" || theme === "light") this.theme = theme;
    try {
      window.localStorage.setItem("talespire-5e-toolset:v2:theme", this.theme);
    } catch { /* Preferences remain active for the current session. */ }
    this.render();
  }

  private async saveCharacterColor(color: string): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    if (!character) return;
    try {
      this.acceptCharacterSnapshot(await this.application.editCharacter({
        characterId: character.id,
        expectedCharacterRevision: character.revision,
        expectedCampaignChecksum: this.snapshot.checksum,
        patch: { color },
      }), "Cambiar color del personaje");
      this.message = { kind: "success", text: "Color del personaje actualizado." };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      await this.reload();
    }
  }

  private applyCharacterColor(rawColor: string): void {
    const candidate = rawColor.trim();
    const color = candidate.startsWith("#") ? candidate : `#${candidate}`;
    if (!/^#[0-9a-f]{6}$/i.test(color)) {
      this.message = { kind: "error", text: "Ingresá un color hexadecimal válido, por ejemplo #6f96c4." };
      this.render();
      return;
    }
    void this.saveCharacterColor(color.toLowerCase());
  }

  private async rollDice(button: HTMLButtonElement): Promise<void> {
    try {
      const rawExpression = button.dataset.rollExpression;
      if (!rawExpression) throw new Error("La tirada no tiene una expresión de dados.");
      const character = this.snapshot && this.selectedCharacterId
        ? this.snapshot.campaign.characters[this.selectedCharacterId]
        : undefined;
      const conditionKeys = new Set(
        character?.combat.conditions.map((condition) => condition.key) ?? [],
      );
      const expressions = rawExpression.split("/").map((expression) => {
        if (!expression.toLowerCase().includes("d20")) return expression;
        let adjusted = expression;
        if (conditionKeys.has("bless") || conditionKeys.has("guidance")) {
          adjusted += "+1d4";
        }
        if (conditionKeys.has("bane")) adjusted += "-1d4";
        return adjusted;
      });
      const baseMode = button.dataset.rollMode === "advantage"
        ? "advantage"
        : button.dataset.rollMode === "disadvantage"
          ? "disadvantage"
          : "normal";
      const useInspiration = !!character &&
        character.combat.inspiration &&
        this.armedInspirationCharacterIds.has(character.id) &&
        expressions.some((expression) => expression.toLowerCase().includes("d20"));
      const mode = useInspiration ? inspiredRollMode(baseMode) : baseMode;
      const result = await this.runtime.diceRoller.roll({
        name: button.dataset.rollName ?? "Tirada",
        expressions,
        mode,
      });
      if (useInspiration && character) await this.consumeInspiration(character.id);
      this.consumeCombatResolution(button);
      this.appendActionLog(`${button.dataset.rollName ?? "Tirada"}: ${result.summary}`, "roll");
      this.message = { kind: "success", text: `${result.summary}${useInspiration ? " · Inspiración usada." : ""}` };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private async consumeInspiration(characterId: string): Promise<void> {
    if (!this.snapshot) return;
    const character = this.snapshot.campaign.characters[characterId];
    if (!character?.combat.inspiration) {
      this.armedInspirationCharacterIds.delete(characterId);
      return;
    }
    const consumed = await this.application.applyCharacterResource({
      characterId,
      expectedCharacterRevision: character.revision,
      expectedCampaignChecksum: this.snapshot.checksum,
      action: { kind: "toggle-inspiration" },
    });
    this.acceptCharacterSnapshot(consumed.snapshot, "Inspiración usada");
    this.armedInspirationCharacterIds.delete(characterId);
    await this.refreshStorageUsage();
  }

  private async requestInitiativeList(): Promise<void> {
    try {
      await this.runtime.requestInitiativeList?.();
      this.message = { kind: "success", text: "Lista de iniciativa solicitada al GM." };
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
    }
    this.render();
  }

  private async runSyncTransportProbe(): Promise<void> {
    const size = Number(this.root.querySelector<HTMLSelectElement>("#sync-probe-size")?.value);
    try {
      if (!Number.isSafeInteger(size)) throw new Error("Seleccioná un tamaño de prueba válido.");
      await this.runtime.runSyncTransportProbe?.(size);
      this.message = { kind: "success", text: "Prueba enviada. Los resultados se actualizarán al recibir las confirmaciones." };
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
    }
    this.render();
  }

  private async refreshSyncPeers(): Promise<void> {
    try {
      await this.runtime.refreshSyncPeers?.();
      this.message = { kind: "success", text: "Lista de clientes de TaleSpire actualizada." };
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
    }
    this.render();
  }

  private async sendCharacterSummary(): Promise<void> {
    const character = this.snapshot && this.selectedCharacterId
      ? this.snapshot.campaign.characters[this.selectedCharacterId]
      : undefined;
    if (!character) return;
    try {
      await this.runtime.sendCharacterSummary?.(character);
      this.message = { kind: "success", text: "Estadísticas enviadas al GM." };
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
    }
    this.render();
  }

  private async respondToCharacterSummaryRequest(request: CharacterSummaryRequest): Promise<void> {
    const character = this.snapshot && this.selectedCharacterId
      ? this.snapshot.campaign.characters[this.selectedCharacterId]
      : undefined;
    if (!character) return;
    try {
      await this.runtime.respondToCharacterSummaryRequest?.(character, request);
      this.message = { kind: "success", text: "El GM actualizó las estadísticas del personaje." };
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
    }
    this.render();
  }

  private async rollInitiative(): Promise<void> {
    const character = this.snapshot && this.selectedCharacterId
      ? this.snapshot.campaign.characters[this.selectedCharacterId]
      : undefined;
    if (!character) return;
    try {
      const modifier = projectCharacterStatistics(character).initiativeModifier;
      const baseMode = projectAdjustedRollMode(character, "skills", ["Initiative"], character.checks.initiative.rollMode);
      const useInspiration = character.combat.inspiration && this.armedInspirationCharacterIds.has(character.id);
      const result = await this.runtime.diceRoller.roll({
        name: `Iniciativa: ${character.name}`,
        expressions: [`1d20${modifier >= 0 ? "+" : ""}${modifier}`],
        mode: useInspiration ? inspiredRollMode(baseMode) : baseMode,
      });
      if (useInspiration) await this.consumeInspiration(character.id);
      this.appendActionLog(`Iniciativa: ${character.name}: ${result.summary}`, "roll");
      const total = result.totals[0];
      if (total !== undefined) {
        await this.runtime.sendInitiative?.(total);
        this.message = { kind: "success", text: `${result.summary}.${useInspiration ? " Inspiración usada." : ""} Resultado enviado al GM.` };
      } else {
        this.message = { kind: "success", text: `${result.summary}${useInspiration ? " · Inspiración usada." : ""} El resultado se enviará automáticamente al GM al completarse la tirada; también podés ingresarlo manualmente.` };
      }
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
    }
    this.render();
  }

  private async sendInitiative(): Promise<void> {
    const input = this.root.querySelector<HTMLInputElement>("#initiative-result");
    const value = Number(input?.value);
    try {
      if (!Number.isInteger(value)) throw new Error("Ingresá un resultado entero de iniciativa.");
      await this.runtime.sendInitiative?.(value);
      this.appendActionLog(`Enviar iniciativa: ${value}`);
      this.message = { kind: "success", text: `Iniciativa ${value} enviada al GM.` };
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
    }
    this.render();
  }

  private actionCardField<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    card: HTMLElement,
    field: string,
  ): T {
    const element = card.querySelector<T>(`[data-field="${field}"]`);
    if (!element) throw new Error(`Falta el campo de acción ${field}.`);
    return element;
  }

  private async saveAction(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const card = button.closest<HTMLElement>("[data-action-card]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    if (!card || !character) return;
    try {
      const categories = [...card.querySelectorAll<HTMLInputElement>("[data-category]:checked")]
        .map((input) => input.dataset.category)
        .filter((value): value is CharacterActionDraft["categories"][number] =>
          value === "attack" || value === "action" || value === "bonus-action" || value === "reaction" || value === "other",
        );
      const orderInput = card.querySelector<HTMLInputElement>('input[name="unused"]');
      const abilityValue = this.actionCardField<HTMLSelectElement>(card, "ability").value;
      const draft: CharacterActionDraft = {
        order: Number(orderInput?.value),
        name: this.actionCardField<HTMLInputElement>(card, "name").value,
        categories,
        activation: this.actionCardField<HTMLInputElement>(card, "activation").value,
        reach: this.actionCardField<HTMLInputElement>(card, "reach").value,
        ability: abilityValue as CharacterActionDraft["ability"],
        proficient: this.actionCardField<HTMLInputElement>(card, "proficient").checked,
        attackBonus: Number(this.actionCardField<HTMLInputElement>(card, "attackBonus").value),
        damageExpression: this.actionCardField<HTMLInputElement>(card, "damageExpression").value,
        damageBonus: Number(this.actionCardField<HTMLInputElement>(card, "damageBonus").value),
        damageType: this.actionCardField<HTMLInputElement>(card, "damageType").value,
        weaponType: this.actionCardField<HTMLInputElement>(card, "weaponType").value,
        properties: this.actionCardField<HTMLInputElement>(card, "properties").value,
        description: this.actionCardField<HTMLTextAreaElement>(card, "description").value,
        inventoryItemId: this.actionCardField<HTMLInputElement>(card, "inventoryItemId").value || null,
        rollMode: this.actionCardField<HTMLSelectElement>(card, "rollMode").value as CharacterActionDraft["rollMode"],
      };
      this.acceptCharacterSnapshot(await this.application.upsertCharacterAction({
        characterId: character.id,
        ...(card.dataset.actionId ? { actionId: card.dataset.actionId } : {}),
        expectedCharacterRevision: character.revision,
        expectedCampaignChecksum: this.snapshot.checksum,
        action: draft,
      }), `Guardar acción: ${draft.name}`);
      this.message = { kind: "success", text: "Acción guardada correctamente." };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private async deleteAction(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const card = button.closest<HTMLElement>("[data-action-card]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    const actionId = card?.dataset.actionId;
    if (!character || !actionId) return;
    try {
      const removed = character.actions.find((action) => action.id === actionId);
      this.acceptCharacterSnapshot(await this.application.removeCharacterAction({
        characterId: character.id,
        actionId,
        expectedCharacterRevision: character.revision,
        expectedCampaignChecksum: this.snapshot.checksum,
      }), `Eliminar acción: ${removed?.name ?? actionId}`);
      this.message = { kind: "success", text: "Acción eliminada." };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private spellCardField<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    card: HTMLElement,
    field: string,
  ): T {
    const element = card.querySelector<T>(`[data-spell-field="${field}"]`);
    if (!element) throw new Error(`Falta el campo de conjuro ${field}.`);
    return element;
  }

  private spellInteger(card: HTMLElement, field: string): number {
    const value = Number(this.spellCardField<HTMLInputElement>(card, field).value);
    if (!Number.isInteger(value)) throw new Error(`${field}: se requiere un entero.`);
    return value;
  }

  private readSpellDraft(
    card: HTMLElement,
    existing: CharacterSpellV2 | undefined,
  ): CharacterSpellDraft {
    const name = this.spellCardField<HTMLInputElement>(card, "name").value.trim();
    const catalog = this.findSpell(name);
    const checkbox = (field: string) =>
      this.spellCardField<HTMLInputElement>(card, field).checked;
    const definition: SpellDefinition = {
      name,
      level: this.spellInteger(card, "level"),
      description: this.spellCardField<HTMLTextAreaElement>(card, "description").value,
      higherLevels: this.spellCardField<HTMLTextAreaElement>(card, "higherLevels").value,
      range: this.spellCardField<HTMLInputElement>(card, "range").value,
      components: this.spellCardField<HTMLInputElement>(card, "components").value,
      material: this.spellCardField<HTMLInputElement>(card, "material").value,
      ritual: checkbox("ritual"),
      duration: this.spellCardField<HTMLInputElement>(card, "duration").value,
      concentration: checkbox("concentration"),
      castingTime: this.spellCardField<HTMLInputElement>(card, "castingTime").value,
      school: this.spellCardField<HTMLInputElement>(card, "school").value,
      classes: this.spellCardField<HTMLInputElement>(card, "classes").value,
      attackType: this.spellCardField<HTMLSelectElement>(card, "attackType").value as SpellDefinition["attackType"],
      saveAbility: this.spellCardField<HTMLInputElement>(card, "saveAbility").value,
      damageExpression: this.spellCardField<HTMLInputElement>(card, "damageExpression").value,
      upcastDamageExpression: this.spellCardField<HTMLInputElement>(card, "upcastDamageExpression").value,
      addAbilityModifier: checkbox("addAbilityModifier"),
      damageType: this.spellCardField<HTMLInputElement>(card, "damageType").value,
      year: this.spellCardField<HTMLInputElement>(card, "year").value,
      legacyData: existing?.definition?.legacyData ?? catalog?.legacyData ?? {},
    };
    return {
      order: existing?.order ?? this.snapshot?.campaign.characters[this.selectedCharacterId ?? ""]?.spellcasting.spells.length ?? 0,
      name,
      level: definition.level,
      prepared: checkbox("prepared"),
      source: existing?.source ?? (catalog ? "bundled" : "custom"),
      definition,
      effect: {
        description: this.spellCardField<HTMLInputElement>(card, "effectDescription").value,
        active: this.spellCardField<HTMLSelectElement>(card, "effectActive").value === "on",
      },
    };
  }

  private loadSpellCardFromCatalog(button: HTMLButtonElement): void {
    try {
      const card = button.closest<HTMLElement>("[data-spell-card]");
      if (!card) return;
      const name = this.spellCardField<HTMLInputElement>(card, "name").value;
      const definition = this.findSpell(name);
      if (!definition) throw new Error(`No se encontró “${name}” en el catálogo cargado.`);
      const value = (field: string, next: string | number) => {
        this.spellCardField<HTMLInputElement | HTMLTextAreaElement>(card, field).value = String(next);
      };
      const checked = (field: string, next: boolean) => {
        this.spellCardField<HTMLInputElement>(card, field).checked = next;
      };
      value("level", definition.level);
      value("castingTime", definition.castingTime);
      value("range", definition.range);
      value("duration", definition.duration);
      value("components", definition.components);
      value("material", definition.material);
      value("school", definition.school);
      value("classes", definition.classes);
      value("saveAbility", definition.saveAbility);
      value("damageExpression", definition.damageExpression);
      value("upcastDamageExpression", definition.upcastDamageExpression);
      value("damageType", definition.damageType);
      value("year", definition.year);
      value("description", definition.description);
      value("higherLevels", definition.higherLevels);
      this.spellCardField<HTMLSelectElement>(card, "attackType").value = definition.attackType;
      checked("ritual", definition.ritual);
      checked("concentration", definition.concentration);
      checked("addAbilityModifier", definition.addAbilityModifier);
      this.message = { kind: "success", text: `Datos de ${definition.name} cargados; guardá el conjuro para persistirlos.` };
      const message = this.root.querySelector<HTMLElement>(".message");
      if (message) message.textContent = this.message.text;
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private async saveSpell(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const card = button.closest<HTMLElement>("[data-spell-card]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    if (!card || !character) return;
    try {
      const existing = character.spellcasting.spells.find((spell) => spell.id === card.dataset.spellId);
      const draft = this.readSpellDraft(card, existing);
      const snapshot = await this.application.upsertCharacterSpell({
        characterId: character.id,
        ...(existing ? { spellId: existing.id } : {}),
        expectedCharacterRevision: character.revision,
        expectedCampaignChecksum: this.snapshot.checksum,
        spell: draft,
      });
      this.acceptCharacterSnapshot(snapshot, `Guardar conjuro: ${draft.name}`);
      if (draft.source === "custom" && draft.definition && this.runtime.saveCustomSpell) {
        await this.runtime.saveCustomSpell(draft.definition);
        this.customSpells = [
          ...this.customSpells.filter((spell) => spell.name.toLocaleLowerCase() !== draft.name.toLocaleLowerCase()),
          draft.definition,
        ];
      }
      await this.refreshStorageUsage();
      this.message = { kind: "success", text: "Conjuro guardado correctamente." };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private async handleSpellAction(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const card = button.closest<HTMLElement>("[data-spell-card]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    const action = button.dataset.spellAction;
    const spellName = card?.dataset.spellName?.trim() ?? "";
    if (!character || !card || !action) return;
    if (action === "favorite") {
      if (!spellName) return;
      try {
        const favorite = !this.isFavoriteSpell(character, spellName);
        const snapshot = await this.application.setCharacterSpellFavorite({
          characterId: character.id,
          spellName,
          favorite,
          expectedCharacterRevision: character.revision,
          expectedCampaignChecksum: this.snapshot.checksum,
        });
        this.acceptCharacterSnapshot(snapshot, `${favorite ? "Agregar" : "Quitar"} favorito: ${spellName}`);
        this.message = { kind: "success", text: favorite ? `${spellName} agregado a favoritos.` : `${spellName} quitado de favoritos.` };
        this.render();
      } catch (error) {
        this.message = { kind: "error", text: formatError(error) };
        this.render();
      }
      return;
    }
    if (action === "learn") {
      if (this.sheetMode !== "edit") return;
      const definition = this.findSpell(spellName);
      if (!definition) return;
      try {
        const isCustom = this.customSpells.some((spell) => normalizedSearchText(spell.name) === normalizedSearchText(definition.name));
        const snapshot = await this.application.upsertCharacterSpell({
          characterId: character.id,
          expectedCharacterRevision: character.revision,
          expectedCampaignChecksum: this.snapshot.checksum,
          spell: {
            order: character.spellcasting.spells.length,
            name: definition.name,
            level: definition.level,
            prepared: false,
            source: isCustom ? "custom" : "bundled",
            definition,
            effect: { description: "", active: false },
          },
        });
        this.acceptCharacterSnapshot(snapshot, `Aprender conjuro: ${definition.name}`);
        this.message = { kind: "success", text: `${definition.name} agregado a los conjuros conocidos.` };
        this.render();
      } catch (error) {
        this.message = { kind: "error", text: formatError(error) };
        this.render();
      }
      return;
    }
    const spell = character.spellcasting.spells.find((entry) => entry.id === card.dataset.spellId);
    if (!spell) return;
    if (action === "export") {
      this.exportSpell(spell);
      return;
    }
    const command = {
      characterId: character.id,
      spellId: spell.id,
      expectedCharacterRevision: character.revision,
      expectedCampaignChecksum: this.snapshot.checksum,
    };
    try {
      if (action === "delete") {
        const snapshot = await this.application.removeCharacterSpell(command);
        this.acceptCharacterSnapshot(snapshot, `Eliminar conjuro: ${spell.name}`);
      } else if (action === "prepare") {
        const snapshot = await this.application.setCharacterSpellPrepared({
          ...command,
          prepared: !spell.prepared,
        });
        this.acceptCharacterSnapshot(snapshot, `${spell.prepared ? "Despreparar" : "Preparar"} conjuro: ${spell.name}`);
      } else if (action === "cast") {
        const slot = card?.querySelector<HTMLSelectElement>("[data-cast-slot-level]");
        if (slot?.value === "ritual") {
          if (!spell.definition?.ritual) throw new Error("Este conjuro no se puede lanzar como ritual.");
          const executionKey = card.dataset.combatExecutionKey;
          const before = executionKey ? [...(this.combatExecutions.get(executionKey) ?? [])] : [];
          const beforeDamage = executionKey ? this.combatExecutionDamage.get(executionKey) ?? null : null;
          this.armCombatExecutionCard(card);
          if (executionKey) this.recordCombatAction(`Lanzar ritual: ${spell.name}`, executionKey, before, beforeDamage);
          this.message = { kind: "success", text: `${spell.name} lanzado como ritual, sin gastar espacio.` };
          this.render();
          return;
        }
        if (spell.level > 0 && !spell.prepared) throw new Error("Prepará el conjuro antes de lanzarlo.");
        const snapshot = await this.application.castCharacterSpell({
          ...command,
          slotLevel: Number(slot?.value),
        });
        this.acceptCharacterSnapshot(snapshot, `Lanzar conjuro: ${spell.name}`);
        this.armCombatExecutionCard(card);
      } else {
        throw new Error(`Acción de conjuro desconocida: ${action}`);
      }
      await this.refreshStorageUsage();
      this.message = { kind: "success", text: action === "cast" ? "Conjuro lanzado y espacio registrado." : "Conjuro actualizado." };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private updateSpellCastPreview(select: HTMLSelectElement): void {
    const card = select.closest<HTMLElement>("[data-spell-card]");
    const option = select.selectedOptions[0];
    if (!card || !option) return;
    const damage = option.dataset.spellDamage ?? "";
    const castAvailable = option.dataset.castAvailable !== "false";
    if (card.classList.contains("spell-play-card")) {
      card.classList.toggle("spell-disabled", !castAvailable);
    }
    card.querySelectorAll<HTMLButtonElement>("[data-spell-cast-control]").forEach((button) => {
      button.disabled = !castAvailable;
    });
    const executionKey = card.dataset.combatExecutionKey;
    const pending = executionKey ? this.combatExecutions.get(executionKey) : undefined;
    const displayedDamage = executionKey && pending?.has("damage")
      ? this.combatExecutionDamage.get(executionKey) ?? damage
      : damage;
    card.querySelectorAll<HTMLButtonElement>("[data-combat-roll]").forEach((button) => {
      const kind = button.dataset.combatRoll;
      button.disabled = !executionKey ||
        (kind !== "attack" && kind !== "damage") ||
        !pending?.has(kind);
    });
    const damageReadout = card.querySelector<HTMLElement>("[data-spell-damage-readout]");
    const damageButton = card.querySelector<HTMLButtonElement>("[data-spell-damage-button]");
    if (damageReadout) damageReadout.textContent = displayedDamage || "—";
    if (damageButton) {
      damageButton.dataset.rollExpression = displayedDamage;
      damageButton.disabled = displayedDamage.length === 0 || !executionKey || !pending?.has("damage");
    }
  }

  private async saveSpellSlots(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const row = button.closest<HTMLElement>("[data-spell-slot-level]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    if (!row || !character) return;
    try {
      const read = (field: string) => Number(row.querySelector<HTMLInputElement>(`[data-slot-field="${field}"]`)?.value);
      this.acceptCharacterSnapshot(await this.application.setSpellSlots({
        characterId: character.id,
        level: Number(row.dataset.spellSlotLevel),
        maximum: read("maximum"),
        used: read("used"),
        expectedCharacterRevision: character.revision,
        expectedCampaignChecksum: this.snapshot.checksum,
      }), `Actualizar espacios de conjuro nivel ${row.dataset.spellSlotLevel}`);
      this.message = { kind: "success", text: "Espacios de conjuro actualizados." };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private async saveSpellcastingSettings(): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    if (!character) return;
    try {
      const ability = this.root.querySelector<HTMLSelectElement>("#spellcasting-ability")?.value ?? "intelligence";
      const selectedLevel = this.root.querySelector<HTMLSelectElement>("#spell-visible-level")?.value ?? "";
      this.acceptCharacterSnapshot(await this.application.setSpellcastingSettings({
        characterId: character.id,
        settings: {
          ability,
          selectedLevel: selectedLevel || null,
          showUpcast: this.root.querySelector<HTMLInputElement>("#spell-show-upcast")?.checked ?? false,
          attackBonus: Number(this.root.querySelector<HTMLInputElement>("#spell-attack-bonus")?.value),
          saveDcBonus: Number(this.root.querySelector<HTMLInputElement>("#spell-save-bonus")?.value),
        },
        expectedCharacterRevision: character.revision,
        expectedCampaignChecksum: this.snapshot.checksum,
      }), "Actualizar configuración de conjuros");
      this.message = { kind: "success", text: "Configuración de conjuros guardada." };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private exportSpell(spell: CharacterSpellV2): void {
    const blob = new Blob([JSON.stringify(spell.definition ?? spell, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${spell.name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "spell"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private async importSpell(event: Event): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    if (!character) return;
    try {
      const definition = normalizeSpellDefinition(JSON.parse(await input.files[0].text()));
      this.acceptCharacterSnapshot(await this.application.upsertCharacterSpell({
        characterId: character.id,
        expectedCharacterRevision: character.revision,
        expectedCampaignChecksum: this.snapshot.checksum,
        spell: {
          order: character.spellcasting.spells.length,
          name: definition.name,
          level: definition.level,
          prepared: false,
          source: "custom",
          definition,
          effect: { description: "", active: false },
        },
      }), `Importar conjuro: ${definition.name}`);
      if (this.runtime.saveCustomSpell) await this.runtime.saveCustomSpell(definition);
      this.customSpells = [
        ...this.customSpells.filter((spell) => spell.name.toLocaleLowerCase() !== definition.name.toLocaleLowerCase()),
        definition,
      ];
      await this.refreshStorageUsage();
      this.message = { kind: "success", text: `Conjuro ${definition.name} importado.` };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private contentField<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    card: HTMLElement,
    selector: string,
  ): T {
    const field = card.querySelector<T>(selector);
    if (!field) throw new Error(`Falta un campo de contenido: ${selector}`);
    return field;
  }

  private contentCommand(character: CharacterV2): {
    characterId: string;
    expectedCharacterRevision: number;
    expectedCampaignChecksum: string;
  } {
    if (!this.snapshot) throw new Error("No hay campaña cargada.");
    return {
      characterId: character.id,
      expectedCharacterRevision: character.revision,
      expectedCampaignChecksum: this.snapshot.checksum,
    };
  }

  private finishContent(snapshot: CampaignSnapshot, text: string): void {
    this.acceptCharacterSnapshot(snapshot, text.replace(/\.$/, ""));
    this.message = { kind: "success", text };
    void this.refreshStorageUsage();
    this.render();
  }

  private contentFailure(error: unknown): void {
    this.message = { kind: "error", text: formatError(error) };
    this.render();
  }

  private async toggleActiveEffect(select: HTMLSelectElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    if (!character) return;
    const active = select.value === "on";
    const kind = select.dataset.effectToggle;
    try {
      if (kind === "spell") {
        const card = select.closest<HTMLElement>("[data-spell-card]");
        const spell = character.spellcasting.spells.find((entry) => entry.id === card?.dataset.spellId);
        if (!spell) return;
        this.finishContent(await this.application.upsertCharacterSpell({
          ...this.contentCommand(character), spellId: spell.id,
          spell: { ...spell, effect: { ...spell.effect, active } },
        }), "Efecto del conjuro actualizado.");
        return;
      }
      if (kind === "inventory") {
        const card = select.closest<HTMLElement>("[data-inventory-card]");
        const item = character.inventory.find((entry) => entry.id === card?.dataset.inventoryId);
        if (!item) return;
        this.finishContent(await this.application.upsertInventoryItem({
          ...this.contentCommand(character), itemId: item.id,
          item: { ...item, effect: { ...item.effect, active } },
        }), "Efecto del objeto actualizado.");
        return;
      }
      if (kind === "trait") {
        const card = select.closest<HTMLElement>("[data-trait-card]");
        const groupId = card?.dataset.groupId;
        const trait = character.traits.find((group) => group.id === groupId)?.traits.find((entry) => entry.id === card?.dataset.traitId);
        if (!groupId || !trait) return;
        this.finishContent(await this.application.upsertTrait({
          ...this.contentCommand(character), groupId, traitId: trait.id,
          trait: { ...trait, effect: { ...trait.effect, active } },
        }), "Efecto del rasgo actualizado.");
      }
    } catch (error) {
      this.contentFailure(error);
    }
  }

  private async saveTraitGroup(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const container = button.closest<HTMLElement>("[data-trait-group]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    if (!container || !character) return;
    try {
      const existing = character.traits.find((group) => group.id === container.dataset.groupId);
      const title = this.contentField<HTMLInputElement>(container, '[data-group-field="title"]').value;
      const order = Number(this.contentField<HTMLInputElement>(container, '[data-group-field="order"]').value);
      const collapsed = this.contentField<HTMLInputElement>(container, '[data-group-field="collapsed"]').checked;
      const snapshot = await this.application.upsertTraitGroup({
        ...this.contentCommand(character),
        ...(existing ? { groupId: existing.id } : {}),
        group: { title, order, collapsed, legacyData: existing?.legacyData ?? {} },
      });
      this.finishContent(snapshot, "Grupo de rasgos guardado.");
    } catch (error) { this.contentFailure(error); }
  }

  private async deleteTraitGroup(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const container = button.closest<HTMLElement>("[data-trait-group]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    const groupId = container?.dataset.groupId;
    if (!character || !groupId) return;
    try {
      this.finishContent(await this.application.removeTraitGroup({ ...this.contentCommand(character), groupId }), "Grupo de rasgos eliminado.");
    } catch (error) { this.contentFailure(error); }
  }

  private async saveTrait(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const card = button.closest<HTMLElement>("[data-trait-card]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    const groupId = card?.dataset.groupId;
    if (!card || !character || !groupId) return;
    try {
      const group = character.traits.find((entry) => entry.id === groupId);
      const existing = group?.traits.find((trait) => trait.id === card.dataset.traitId);
      const input = (name: string) => this.contentField<HTMLInputElement>(card, `[data-trait-field="${name}"]`);
      const select = (name: string) => this.contentField<HTMLSelectElement>(card, `[data-trait-field="${name}"]`);
      const hasAdjustment = input("hasAdjustment").checked;
      const trait: CharacterTraitDraft = {
        order: Number(input("order").value),
        name: input("name").value,
        description: this.contentField<HTMLTextAreaElement>(card, '[data-trait-field="description"]').value,
        collapsed: input("collapsed").checked,
        uses: {
          maximum: Number(input("maximum").value),
          used: Number(input("used").value),
          reset: select("reset").value as CharacterTraitDraft["uses"]["reset"],
        },
        adjustment: hasAdjustment ? {
          category: input("adjustmentCategory").value,
          subcategory: input("adjustmentSubcategory").value,
          ability: input("adjustmentAbility").value,
          value: Number(input("adjustmentValue").value),
          advantage: input("advantage").checked,
          disadvantage: input("disadvantage").checked,
          applyToDerived: input("applyToDerived").checked,
        } : null,
        effect: {
          description: input("effectDescription").value,
          active: select("effectActive").value === "on",
        },
        legacyData: existing?.legacyData ?? {},
      };
      const snapshot = await this.application.upsertTrait({
        ...this.contentCommand(character), groupId,
        ...(existing ? { traitId: existing.id } : {}), trait,
      });
      this.finishContent(snapshot, "Rasgo guardado.");
    } catch (error) { this.contentFailure(error); }
  }

  private async deleteTrait(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const card = button.closest<HTMLElement>("[data-trait-card]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    const groupId = card?.dataset.groupId;
    const traitId = card?.dataset.traitId;
    if (!character || !groupId || !traitId) return;
    try {
      this.finishContent(await this.application.removeTrait({ ...this.contentCommand(character), groupId, traitId }), "Rasgo eliminado.");
    } catch (error) { this.contentFailure(error); }
  }

  private async changeTraitUse(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const card = button.closest<HTMLElement>("[data-trait-card]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    const groupId = card?.dataset.groupId;
    const traitId = card?.dataset.traitId;
    const trait = character?.traits.find((group) => group.id === groupId)?.traits.find((entry) => entry.id === traitId);
    if (!character || !groupId || !traitId || !trait) return;
    try {
      const used = Math.max(0, Math.min(trait.uses.maximum, trait.uses.used + Number(button.dataset.traitUse)));
      this.finishContent(await this.application.setTraitUsed({ ...this.contentCommand(character), groupId, traitId, used }), "Usos del rasgo actualizados.");
    } catch (error) { this.contentFailure(error); }
  }

  private async saveNoteGroup(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const container = button.closest<HTMLElement>("[data-note-group]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    if (!container || !character) return;
    try {
      const existing = character.notes.find((group) => group.id === container.dataset.groupId);
      const snapshot = await this.application.upsertNoteGroup({
        ...this.contentCommand(character), ...(existing ? { groupId: existing.id } : {}),
        group: {
          title: this.contentField<HTMLInputElement>(container, '[data-group-field="title"]').value,
          order: Number(this.contentField<HTMLInputElement>(container, '[data-group-field="order"]').value),
          collapsed: this.contentField<HTMLInputElement>(container, '[data-group-field="collapsed"]').checked,
          legacyData: existing?.legacyData ?? {},
        },
      });
      this.finishContent(snapshot, "Grupo de notas guardado.");
    } catch (error) { this.contentFailure(error); }
  }

  private async deleteNoteGroup(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const container = button.closest<HTMLElement>("[data-note-group]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    const groupId = container?.dataset.groupId;
    if (!character || !groupId) return;
    try { this.finishContent(await this.application.removeNoteGroup({ ...this.contentCommand(character), groupId }), "Grupo de notas eliminado."); }
    catch (error) { this.contentFailure(error); }
  }

  private async saveNote(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const card = button.closest<HTMLElement>("[data-note-card]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    const groupId = card?.dataset.groupId;
    if (!card || !character || !groupId) return;
    try {
      const existing = character.notes.find((group) => group.id === groupId)?.notes.find((note) => note.id === card.dataset.noteId);
      const input = (name: string) => this.contentField<HTMLInputElement>(card, `[data-note-field="${name}"]`);
      const note: CharacterNoteDraft = {
        order: Number(input("order").value), title: input("title").value,
        content: this.contentField<HTMLTextAreaElement>(card, '[data-note-field="content"]').value,
        tags: input("tags").value.split(",").map((tag) => tag.trim()).filter(Boolean),
        legacyData: existing?.legacyData ?? {},
      };
      const snapshot = await this.application.upsertNote({ ...this.contentCommand(character), groupId, ...(existing ? { noteId: existing.id } : {}), note });
      this.finishContent(snapshot, "Nota guardada.");
    } catch (error) { this.contentFailure(error); }
  }

  private async deleteNote(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const card = button.closest<HTMLElement>("[data-note-card]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    const groupId = card?.dataset.groupId;
    const noteId = card?.dataset.noteId;
    if (!character || !groupId || !noteId) return;
    try { this.finishContent(await this.application.removeNote({ ...this.contentCommand(character), groupId, noteId }), "Nota eliminada."); }
    catch (error) { this.contentFailure(error); }
  }

  private async saveExtra(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const card = button.closest<HTMLElement>("[data-extra-card]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    if (!card || !character) return;
    try {
      const existing = character.extras.find((extra) => extra.id === card.dataset.extraId);
      const input = (name: string) => this.contentField<HTMLInputElement>(card, `[data-extra-field="${name}"]`);
      const statBlock = JSON.parse(this.contentField<HTMLTextAreaElement>(card, '[data-extra-field="statBlock"]').value) as unknown;
      if (statBlock === null || Array.isArray(statBlock) || typeof statBlock !== "object") throw new Error("El stat block debe ser un objeto JSON.");
      const extra: CharacterExtraDraft = {
        order: Number(input("order").value), name: input("name").value,
        hitPoints: { current: Number(input("current").value), maximum: Number(input("maximum").value), temporary: Number(input("temporary").value) },
        conditions: existing?.conditions ?? [], statBlock: statBlock as CharacterExtraDraft["statBlock"],
        legacyData: existing?.legacyData ?? {},
      };
      const snapshot = await this.application.upsertExtra({ ...this.contentCommand(character), ...(existing ? { extraId: existing.id } : {}), extra });
      this.finishContent(snapshot, "Extra guardado.");
    } catch (error) { this.contentFailure(error); }
  }

  private loadExtraFromCatalog(button: HTMLButtonElement): void {
    try {
      const card = button.closest<HTMLElement>("[data-extra-card]");
      if (!card) return;
      const input = (name: string) => this.contentField<HTMLInputElement>(card, `[data-extra-field="${name}"]`);
      const monster = findMonsterByName(input("name").value);
      if (!monster) throw new Error(`No se encontró “${input("name").value}” en el bestiario.`);
      const hp = monster.HP;
      const hpObject = hp !== null && !Array.isArray(hp) && typeof hp === "object" ? hp : {};
      const maximum = Number(hpObject.Value ?? 0);
      input("maximum").value = String(Number.isFinite(maximum) ? maximum : 0);
      input("current").value = input("maximum").value;
      this.contentField<HTMLTextAreaElement>(card, '[data-extra-field="statBlock"]').value = JSON.stringify(monster, null, 2);
    } catch (error) {
      this.contentFailure(error);
    }
  }

  private async deleteExtra(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const card = button.closest<HTMLElement>("[data-extra-card]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    const extraId = card?.dataset.extraId;
    if (!character || !extraId) return;
    try { this.finishContent(await this.application.removeExtra({ ...this.contentCommand(character), extraId }), "Extra eliminado."); }
    catch (error) { this.contentFailure(error); }
  }

  private async applyExtraHp(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const card = button.closest<HTMLElement>("[data-extra-card]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    const extraId = card?.dataset.extraId;
    const kind = button.dataset.extraHp;
    if (!character || !extraId || (kind !== "damage" && kind !== "heal" && kind !== "temporary")) return;
    try {
      const amount = Number(this.contentField<HTMLInputElement>(card!, "[data-extra-amount]").value);
      this.finishContent(await this.application.applyExtraHitPoints({ ...this.contentCommand(character), extraId, action: { kind, amount } }), "Puntos de golpe del extra actualizados.");
    } catch (error) { this.contentFailure(error); }
  }

  private async addExtraCondition(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const card = button.closest<HTMLElement>("[data-extra-card]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    const extraId = card?.dataset.extraId;
    const select = card?.querySelector<HTMLSelectElement>("[data-extra-condition-select]");
    const option = select?.selectedOptions[0];
    if (!character || !extraId || !select || !option) return;
    try {
      this.finishContent(await this.application.addExtraCondition({
        ...this.contentCommand(character), extraId,
        key: select.value, label: option.textContent || select.value, level: null,
      }), "Condición agregada al extra.");
    } catch (error) { this.contentFailure(error); }
  }

  private async removeExtraCondition(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const card = button.closest<HTMLElement>("[data-extra-card]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    const extraId = card?.dataset.extraId;
    const conditionId = button.dataset.removeExtraCondition;
    if (!character || !extraId || !conditionId) return;
    try {
      this.finishContent(await this.application.removeExtraCondition({
        ...this.contentCommand(character), extraId, conditionId,
      }), "Condición quitada del extra.");
    } catch (error) { this.contentFailure(error); }
  }

  private inventoryCardField<T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    card: HTMLElement,
    field: string,
  ): T {
    const element = card.querySelector<T>(`[data-inventory-field="${field}"]`);
    if (!element) throw new Error(`Falta el campo de inventario ${field}.`);
    return element;
  }

  private inventoryNumber(card: HTMLElement, field: string): number {
    const value = Number(this.inventoryCardField<HTMLInputElement>(card, field).value);
    if (!Number.isFinite(value)) {
      throw new Error(`${field}: se requiere un número válido.`);
    }
    return value;
  }

  private inventoryOptionalInteger(card: HTMLElement, field: string): number | null {
    const raw = this.inventoryCardField<HTMLInputElement>(card, field).value.trim();
    if (raw === "") return null;
    const value = Number(raw);
    if (!Number.isInteger(value)) throw new Error(`${field}: se requiere un entero.`);
    return value;
  }

  private loadInventoryCardFromCatalog(button: HTMLButtonElement): void {
    try {
      const card = button.closest<HTMLElement>("[data-inventory-card]");
      if (!card) return;
      const name = this.inventoryCardField<HTMLInputElement>(card, "name").value;
      const definition = this.findEquipment(name);
      if (!definition) throw new Error(`No se encontró “${name}” en el catálogo de equipo.`);
      const value = (field: string, next: string | number | null) => {
        this.inventoryCardField<HTMLInputElement | HTMLTextAreaElement>(card, field).value = next === null ? "" : String(next);
      };
      const checked = (field: string, next: boolean) => {
        this.inventoryCardField<HTMLInputElement>(card, field).checked = next;
      };
      value("name", definition.name);
      value("category", definition.category);
      value("quantity", definition.quantity);
      value("unitWeight", definition.unitWeight);
      value("costQuantity", definition.cost.quantity);
      value("costUnit", definition.cost.unit);
      value("properties", definition.properties.join(", "));
      value("description", definition.description);
      value("bonuses", JSON.stringify(definition.bonuses, null, 2));
      checked("requiresAttunement", definition.requiresAttunement);
      checked("usable", definition.usable);
      checked("consumable", definition.consumable);
      checked("hasCharges", definition.charges !== null);
      value("currentCharges", definition.charges?.current ?? 0);
      value("maximumCharges", definition.charges?.maximum ?? 0);
      value("chargeReset", definition.charges?.reset ?? "long-rest");
      checked("hasArmor", definition.armor !== null);
      value("armorBase", definition.armor?.base ?? 10);
      value("armorCategory", definition.armor?.armorCategory ?? "");
      checked("armorDexterityBonus", definition.armor?.dexterityBonus ?? false);
      value("maximumDexterityBonus", definition.armor?.maximumDexterityBonus ?? null);
      checked("stealthDisadvantage", definition.armor?.stealthDisadvantage ?? false);
      checked("hasWeapon", definition.weapon !== null);
      value("weaponCategory", definition.weapon?.category ?? "");
      value("weaponRange", definition.weapon?.range ?? "");
      value("normalRange", definition.weapon?.normalRange ?? null);
      value("longRange", definition.weapon?.longRange ?? null);
      value("damageExpression", definition.weapon?.damageExpression ?? "");
      value("versatileDamageExpression", definition.weapon?.versatileDamageExpression ?? "");
      value("damageType", definition.weapon?.damageType ?? "");
      value("weaponAttackBonus", definition.weapon?.attackBonus ?? 0);
      value("weaponDamageBonus", definition.weapon?.damageBonus ?? 0);
      const details = card.querySelector<HTMLDetailsElement>("details");
      if (details && (definition.weapon || definition.armor || definition.charges)) details.open = true;
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private async saveInventoryItem(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const card = button.closest<HTMLElement>("[data-inventory-card]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    if (!card || !character) return;
    try {
      const existing = character.inventory.find((item) => item.id === card.dataset.inventoryId);
      const checkbox = (field: string) =>
        this.inventoryCardField<HTMLInputElement>(card, field).checked;
      const integer = (field: string) => {
        const value = this.inventoryNumber(card, field);
        if (!Number.isInteger(value)) throw new Error(`${field}: se requiere un entero.`);
        return value;
      };
      const hasCharges = checkbox("hasCharges");
      const hasArmor = checkbox("hasArmor");
      const hasWeapon = checkbox("hasWeapon");
      const draft: CharacterInventoryItemDraft = {
        order: integer("order"),
        group: this.inventoryCardField<HTMLInputElement>(card, "group").value,
        name: this.inventoryCardField<HTMLInputElement>(card, "name").value,
        quantity: integer("quantity"),
        unitWeight: this.inventoryNumber(card, "unitWeight"),
        cost: {
          quantity: this.inventoryNumber(card, "costQuantity"),
          unit: this.inventoryCardField<HTMLInputElement>(card, "costUnit").value,
        },
        category: this.inventoryCardField<HTMLInputElement>(card, "category").value,
        description: this.inventoryCardField<HTMLTextAreaElement>(card, "description").value,
        properties: this.inventoryCardField<HTMLInputElement>(card, "properties").value
          .split(",").map((value) => value.trim()).filter(Boolean),
        equipped: existing?.equipped ?? false,
        attuned: existing?.attuned ?? false,
        requiresAttunement: checkbox("requiresAttunement"),
        usable: checkbox("usable"),
        consumable: checkbox("consumable"),
        charges: hasCharges ? {
          current: integer("currentCharges"),
          maximum: integer("maximumCharges"),
          reset: this.inventoryCardField<HTMLInputElement>(card, "chargeReset").value,
        } : null,
        armor: hasArmor ? {
          base: integer("armorBase"),
          dexterityBonus: checkbox("armorDexterityBonus"),
          maximumDexterityBonus: this.inventoryOptionalInteger(card, "maximumDexterityBonus"),
          armorCategory: this.inventoryCardField<HTMLInputElement>(card, "armorCategory").value,
          stealthDisadvantage: checkbox("stealthDisadvantage"),
        } : null,
        weapon: hasWeapon ? {
          category: this.inventoryCardField<HTMLInputElement>(card, "weaponCategory").value,
          range: this.inventoryCardField<HTMLInputElement>(card, "weaponRange").value,
          normalRange: this.inventoryOptionalInteger(card, "normalRange"),
          longRange: this.inventoryOptionalInteger(card, "longRange"),
          damageExpression: this.inventoryCardField<HTMLInputElement>(card, "damageExpression").value,
          versatileDamageExpression: this.inventoryCardField<HTMLInputElement>(card, "versatileDamageExpression").value,
          damageType: this.inventoryCardField<HTMLInputElement>(card, "damageType").value,
          attackBonus: integer("weaponAttackBonus"),
          damageBonus: integer("weaponDamageBonus"),
        } : null,
        bonuses: JSON.parse(this.inventoryCardField<HTMLTextAreaElement>(card, "bonuses").value || "[]") as CharacterInventoryItemDraft["bonuses"],
        effect: {
          description: this.inventoryCardField<HTMLInputElement>(card, "effectDescription").value,
          active: this.inventoryCardField<HTMLSelectElement>(card, "effectActive").value === "on",
        },
        legacyData: existing?.legacyData ?? {},
      };
      this.acceptCharacterSnapshot(await this.application.upsertInventoryItem({
        characterId: character.id,
        ...(existing ? { itemId: existing.id } : {}),
        expectedCharacterRevision: character.revision,
        expectedCampaignChecksum: this.snapshot.checksum,
        item: draft,
      }), `Guardar objeto: ${draft.name}`);
      if (!findEquipmentDefinitionByName(draft.name) && this.runtime.saveCustomEquipment) {
        const { order: _order, group: _group, ...definition } = draft;
        await this.runtime.saveCustomEquipment(definition);
        this.customEquipment = [
          ...this.customEquipment.filter((item) => item.name.toLocaleLowerCase() !== draft.name.toLocaleLowerCase()),
          definition,
        ];
      }
      await this.refreshStorageUsage();
      this.message = { kind: "success", text: "Objeto guardado correctamente." };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private async addCatalogInventoryItem(name: string, quantity = 1): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    if (!character) return;
    try {
      if (!name) throw new Error("Ingresá el nombre del objeto.");
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new Error("La cantidad debe ser un entero positivo.");
      }
      const definition = this.findEquipment(name);
      if (!definition) throw new Error("El objeto seleccionado ya no está disponible en el catálogo.");
      const existingStack = character.inventory.find((item) =>
        !item.equipped && normalizedSearchText(item.name) === normalizedSearchText(name));
      this.acceptCharacterSnapshot(await this.application.upsertInventoryItem({
        characterId: character.id,
        ...(existingStack ? { itemId: existingStack.id } : {}),
        expectedCharacterRevision: character.revision,
        expectedCampaignChecksum: this.snapshot.checksum,
        item: existingStack ? {
          ...existingStack,
          quantity: existingStack.quantity + quantity,
        } : {
          ...definition,
          name,
          quantity,
          order: character.inventory.length,
          group: "backpack",
        },
      }), `Agregar objeto: ${name} ×${quantity}`);
      await this.refreshStorageUsage();
      this.message = { kind: "success", text: `${name} agregado al inventario.` };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private async adjustInventoryQuantity(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const card = button.closest<HTMLElement>("[data-inventory-card]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    const item = character?.inventory.find((entry) => entry.id === card?.dataset.inventoryId);
    const delta = Number(button.dataset.inventoryQuantity);
    if (!character || !item || (delta !== -1 && delta !== 1)) return;
    try {
      this.acceptCharacterSnapshot(await this.application.adjustInventoryItemQuantity({
        characterId: character.id,
        itemId: item.id,
        delta,
        expectedCharacterRevision: character.revision,
        expectedCampaignChecksum: this.snapshot.checksum,
      }), `${delta > 0 ? "Agregar" : "Quitar"} unidad: ${item.name}`);
      await this.refreshStorageUsage();
      this.message = { kind: "success", text: "Cantidad actualizada." };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private async transferInventoryItemFromCard(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const card = button.closest<HTMLElement>("[data-inventory-card]");
    const source = this.snapshot.campaign.characters[this.selectedCharacterId];
    const item = source?.inventory.find((entry) => entry.id === card?.dataset.inventoryId);
    const targetId = card?.querySelector<HTMLSelectElement>("[data-item-transfer-target]")?.value;
    const quantity = Number(card?.querySelector<HTMLInputElement>("[data-item-transfer-quantity]")?.value);
    const target = targetId ? this.snapshot.campaign.characters[targetId] : undefined;
    if (!source || !item) return;
    try {
      if (!target) throw new Error("Seleccioná el personaje de destino.");
      if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > item.quantity) {
        throw new Error(`La cantidad debe estar entre 1 y ${item.quantity}.`);
      }
      const snapshot = await this.application.transferInventoryItem({
        sourceCharacterId: source.id,
        targetCharacterId: target.id,
        itemId: item.id,
        quantity,
        expectedSourceRevision: source.revision,
        expectedTargetRevision: target.revision,
        expectedCampaignChecksum: this.snapshot.checksum,
      });
      this.acceptCharacterSnapshot(snapshot, `Transferir ${item.name} ×${quantity} a ${target.name}`, [target.id]);
      this.appendActionLog(`Recibir ${item.name} ×${quantity} de ${source.name}`, "action", target.id);
      await this.refreshStorageUsage();
      this.message = { kind: "success", text: `${item.name} transferido a ${target.name}.` };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      await this.reload();
    }
  }

  private currencyBatchTotalInCopper(amounts: Record<CurrencyDenomination, number>): number {
    if (!CURRENCY_DENOMINATIONS.every((denomination) => Number.isSafeInteger(amounts[denomination.key]) && amounts[denomination.key] >= 0)) return Number.NaN;
    return CURRENCY_DENOMINATIONS.reduce(
      (total, denomination) => total + amounts[denomination.key] * denomination.copperValue,
      0,
    );
  }

  private currencyBatchLabel(amounts: Record<CurrencyDenomination, number>): string {
    return CURRENCY_DENOMINATIONS
      .filter((denomination) => amounts[denomination.key] > 0)
      .map((denomination) => `${amounts[denomination.key]} ${denomination.abbreviation}`)
      .join(" · ");
  }

  private async transferCurrencyBatch(
    targetId: string,
    amounts: Record<CurrencyDenomination, number>,
  ): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const source = this.snapshot.campaign.characters[this.selectedCharacterId];
    const target = targetId ? this.snapshot.campaign.characters[targetId] : undefined;
    if (!source) return;
    try {
      if (!target) throw new Error("Seleccioná el personaje de destino.");
      const quantity = this.currencyBatchTotalInCopper(amounts);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Ingresá al menos una cantidad válida.");
      const batchLabel = this.currencyBatchLabel(amounts);
      const label = `Transferir ${batchLabel} a ${target.name}`;
      const receivedLabel = `Recibir ${batchLabel} de ${source.name}`;
      const successText = `${batchLabel} transferidas a ${target.name}.`;
      const snapshot = await this.application.transferCurrency({
        sourceCharacterId: source.id,
        targetCharacterId: target.id,
        denomination: "copper",
        quantity,
        expectedSourceRevision: source.revision,
        expectedTargetRevision: target.revision,
        expectedCampaignChecksum: this.snapshot.checksum,
      });
      this.acceptCharacterSnapshot(snapshot, label, [target.id]);
      this.appendActionLog(receivedLabel, "action", target.id);
      await this.refreshStorageUsage();
      this.message = { kind: "success", text: successText };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      await this.reload();
    }
  }

  private async handleInventoryAction(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const card = button.closest<HTMLElement>("[data-inventory-card]");
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    const item = character?.inventory.find((entry) => entry.id === card?.dataset.inventoryId);
    const action = button.dataset.inventoryAction;
    if (!character || !item || !action) return;
    const command = {
      characterId: character.id,
      itemId: item.id,
      expectedCharacterRevision: character.revision,
      expectedCampaignChecksum: this.snapshot.checksum,
    };
    try {
      if (action === "delete") {
        this.acceptCharacterSnapshot(await this.application.removeInventoryItem(command), `Eliminar objeto: ${item.name}`);
      } else if (action === "export") {
        this.exportInventoryItem(item);
        return;
      } else if (action === "equip") {
        this.acceptCharacterSnapshot(await this.application.setInventoryItemEquipped({
          ...command,
          value: !item.equipped,
        }), `${item.equipped ? "Quitar" : "Equipar"} objeto: ${item.name}`);
      } else if (action === "attune") {
        this.acceptCharacterSnapshot(await this.application.setInventoryItemAttuned({
          ...command,
          value: !item.attuned,
        }), `${item.attuned ? "Desintonizar" : "Sintonizar"} objeto: ${item.name}`);
      } else if (action === "use") {
        this.acceptCharacterSnapshot(await this.application.useInventoryItem(command), `Usar objeto: ${item.name}`);
      } else {
        throw new Error(`Acción de inventario desconocida: ${action}`);
      }
      await this.refreshStorageUsage();
      this.message = { kind: "success", text: "Inventario actualizado." };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private exportInventoryItem(item: CharacterInventoryItemV2): void {
    const blob = new Blob([JSON.stringify(item, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${item.name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "equipment"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private async importEquipment(event: Event): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
    try {
      const parsed = JSON.parse(await input.files[0].text()) as unknown;
      const records = Array.isArray(parsed) ? parsed : [parsed];
      for (const record of records) {
        const definition = normalizeEquipmentDefinition(record);
        const character = this.snapshot.campaign.characters[this.selectedCharacterId];
        if (!character) throw new Error("El personaje ya no está disponible.");
        this.acceptCharacterSnapshot(await this.application.upsertInventoryItem({
          characterId: character.id,
          expectedCharacterRevision: character.revision,
          expectedCampaignChecksum: this.snapshot.checksum,
          item: {
            ...definition,
            order: character.inventory.length,
            group: "backpack",
          },
        }), `Importar objeto: ${definition.name}`);
        if (this.runtime.saveCustomEquipment) await this.runtime.saveCustomEquipment(definition);
        this.customEquipment = [
          ...this.customEquipment.filter((item) => item.name.toLocaleLowerCase() !== definition.name.toLocaleLowerCase()),
          definition,
        ];
      }
      this.message = { kind: "success", text: `${records.length} objeto(s) importado(s).` };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    } finally {
      input.value = "";
    }
  }

  private async resetInventoryCharges(button: HTMLButtonElement): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    const reset = button.dataset.resetInventoryCharges;
    if (!character || !reset) return;
    try {
      this.acceptCharacterSnapshot(await this.application.resetInventoryCharges({
        characterId: character.id,
        reset,
        expectedCharacterRevision: character.revision,
        expectedCampaignChecksum: this.snapshot.checksum,
      }), `Recuperar cargas: ${reset}`);
      await this.refreshStorageUsage();
      this.message = { kind: "success", text: "Cargas recuperadas." };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private resourceInteger(id: string): number {
    const input = this.root.querySelector<HTMLInputElement>(`#${id}`);
    const value = Number(input?.value);
    if (!Number.isInteger(value)) throw new Error(`${id}: se requiere un número entero`);
    return value;
  }

  private async handleResourceAction(action: string): Promise<void> {
    try {
      if (action === "inspiration") {
        await this.handleInspirationAction();
        return;
      }
      let resourceAction: CharacterResourceAction;
      switch (action) {
        case "heal":
          resourceAction = { kind: "heal", amount: this.resourceInteger("resource-amount") };
          break;
        case "damage":
          resourceAction = { kind: "damage", amount: this.resourceInteger("resource-amount") };
          break;
        case "temporary":
          resourceAction = { kind: "grant-temporary-hit-points", amount: this.resourceInteger("resource-amount") };
          break;
        case "death-saves":
          resourceAction = {
            kind: "set-death-saves",
            successes: this.resourceInteger("death-successes"),
            failures: this.resourceInteger("death-failures"),
          };
          break;
        case "exhaustion":
          resourceAction = { kind: "set-exhaustion", level: this.resourceInteger("exhaustion-level") };
          break;
        case "hit-dice":
          resourceAction = {
            kind: "spend-hit-dice",
            dice: this.resourceInteger("hit-dice-count"),
            healing: this.resourceInteger("hit-dice-healing"),
          };
          break;
        case "long-rest":
          resourceAction = { kind: "long-rest" };
          break;
        case "short-rest":
          resourceAction = { kind: "short-rest" };
          break;
        case "add-condition": {
          const select = this.root.querySelector<HTMLSelectElement>("#condition-select");
          const option = select?.selectedOptions[0];
          if (!select || !option) throw new Error("Seleccioná una condición.");
          resourceAction = {
            kind: "add-condition",
            key: select.value,
            label: option.textContent || select.value,
            level: null,
          };
          break;
        }
        default:
          throw new Error(`Acción de recurso desconocida: ${action}`);
      }
      await this.applyResourceAction(resourceAction);
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private async handleInspirationAction(): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId) return;
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    if (!character) return;
    if (!character.combat.inspiration) {
      this.armedInspirationCharacterIds.delete(character.id);
      await this.applyResourceAction({ kind: "toggle-inspiration" }, "Inspiración activada.");
      return;
    }
    if (!this.armedInspirationCharacterIds.has(character.id)) {
      this.armedInspirationCharacterIds.add(character.id);
      this.message = { kind: "success", text: "Inspiración preparada para la próxima tirada d20 compatible." };
      this.render();
      return;
    }
    this.armedInspirationCharacterIds.delete(character.id);
    await this.applyResourceAction({ kind: "toggle-inspiration" }, "Inspiración desactivada.");
  }

  private async addDeathSave(kind: string | undefined): Promise<void> {
    if (!this.snapshot || !this.selectedCharacterId || (kind !== "success" && kind !== "failure")) return;
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    if (!character) return;
    const current = character.combat.deathSaves;
    if (current.successes >= 3 || current.failures >= 3) return;
    await this.applyResourceAction({
      kind: "set-death-saves",
      successes: kind === "success" ? Math.min(3, current.successes + 1) : current.successes,
      failures: kind === "failure" ? Math.min(3, current.failures + 1) : current.failures,
    }, kind === "success" ? "Salvación de muerte agregada." : "Fallo de muerte agregado.");
  }

  private async applyResourceAction(action: CharacterResourceAction, successText?: string): Promise<void> {
    if (this.snapshot === null || this.selectedCharacterId === null) return;
    const summaryForm = this.root.querySelector<HTMLFormElement>("#character-form");
    if (summaryForm) {
      if (this.autoSaveTimer !== null) {
        window.clearTimeout(this.autoSaveTimer);
        this.autoSaveTimer = null;
      }
      if (!await this.persistCharacterForm(summaryForm, false)) return;
    }
    const character = this.snapshot.campaign.characters[this.selectedCharacterId];
    if (!character) return;
    try {
      const result = await this.application.applyCharacterResource({
        characterId: character.id,
        expectedCharacterRevision: character.revision,
        expectedCampaignChecksum: this.snapshot.checksum,
        action,
      });
      const historyLabel = result.effects.concentrationCheckDc === null
        ? successText ?? "Recurso actualizado"
        : `Daño aplicado · salvación de Constitución CD ${result.effects.concentrationCheckDc}`;
      this.acceptCharacterSnapshot(result.snapshot, historyLabel.replace(/\.$/, ""));
      await this.refreshStorageUsage();
      this.message = result.effects.concentrationCheckDc === null
        ? { kind: "success", text: successText ?? "Recurso actualizado correctamente." }
        : { kind: "success", text: `Daño aplicado. Se requiere una salvación de Constitución CD ${result.effects.concentrationCheckDc}.` };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      await this.reload();
    }
  }

  private async adjustCharacterCurrencyBatch(
    direction: "add" | "remove",
    amounts: Record<CurrencyDenomination, number>,
  ): Promise<void> {
    const amount = this.currencyBatchTotalInCopper(amounts);
    if (!Number.isSafeInteger(amount) || amount <= 0) return;
    const quantity = direction === "add" ? amount : -amount;
    const label = this.currencyBatchLabel(amounts);
    await this.applyResourceAction(
      { kind: "adjust-currency", denomination: "copper", quantity },
      `${label} ${direction === "add" ? "agregadas" : "quitadas"}. Patrimonio recalculado.`,
    );
  }

  private async createEmptyCampaign(): Promise<void> {
    try {
      this.snapshot = await this.application.createCampaign();
      this.selectedCharacterId = null;
      this.message = { kind: "success", text: "Campaña creada. Ya podés agregar el primer personaje." };
      this.render();
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private async importCampaign(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    try {
      const data = new FormData(form);
      const file = data.get("campaignFile");
      if (!(file instanceof File) || file.size === 0) throw new Error("Seleccioná un archivo JSON de campaña.");
      const replaceExisting = data.get("replaceExisting") === "on";
      if (this.snapshot !== null && !replaceExisting) {
        throw new Error("Para reemplazar la campaña local tenés que confirmarlo explícitamente.");
      }
      await this.persistImportedCampaign(
        JSON.parse(await file.text()),
        readText(data, "campaignId"),
        replaceExisting,
      );
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private async importCurrentCampaign(): Promise<void> {
    const loader = this.runtime.loadCurrentCampaignSource;
    const form = this.root.querySelector<HTMLFormElement>("#import-form");
    if (!loader || !form) return;

    try {
      const data = new FormData(form);
      const replaceExisting = data.get("replaceExisting") === "on";
      if (this.snapshot !== null && !replaceExisting) {
        throw new Error("Para reemplazar la campaña v2 tenés que confirmarlo explícitamente.");
      }
      await this.persistImportedCampaign(
        await loader(),
        readText(data, "campaignId"),
        replaceExisting,
      );
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      this.render();
    }
  }

  private async persistImportedCampaign(
    input: unknown,
    campaignId: string,
    replaceExisting: boolean,
  ): Promise<void> {
    const result = await this.application.importCampaign({
      input,
      campaignId,
      replaceExisting,
    });
    this.snapshot = result.snapshot;
    await this.refreshStorageUsage();
    this.selectedCharacterId = Object.values(result.snapshot.campaign.characters)[0]?.id ?? null;
    this.message = {
      kind: "success",
      text: `Importación completa: ${result.report.migratedCharacters} personajes, ${result.report.generatedEntityIds} identificadores generados.`,
    };
    this.render();
  }

  private async saveCharacter(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    await this.persistCharacterForm(form);
  }

  private async persistCharacterForm(form: HTMLFormElement, renderAfterSave = true): Promise<boolean> {
    if (this.snapshot === null) return false;
    const data = new FormData(form);
    try {
      const characterId = form.dataset.characterId ?? "";
      const editedCharacter = this.snapshot.campaign.characters[characterId];
      if (!editedCharacter) throw new Error("El personaje ya no está disponible.");
      this.acceptCharacterSnapshot(await this.application.editCharacter({
        characterId,
        expectedCharacterRevision: Number(form.dataset.characterRevision),
        expectedCampaignChecksum: this.snapshot.checksum,
        patch: {
          name: readText(data, "name"),
          color: readText(data, "color"),
          identity: {
            className: readText(data, "className"),
            level: readInteger(data, "level"),
            experience: readInteger(data, "experience"),
            alignment: readText(data, "alignment"),
          },
          abilities: {
            strength: readInteger(data, "strength"),
            dexterity: readInteger(data, "dexterity"),
            constitution: readInteger(data, "constitution"),
            intelligence: readInteger(data, "intelligence"),
            wisdom: readInteger(data, "wisdom"),
            charisma: readInteger(data, "charisma"),
          },
          checks: this.readChecks(data, editedCharacter.checks),
          proficiencies: {
            weapons: this.readStringList(data, "proficiencyWeapons"),
            armor: this.readStringList(data, "proficiencyArmor"),
            languages: this.readStringList(data, "proficiencyLanguages"),
            tools: this.readStringList(data, "proficiencyTools"),
          },
          combat: {
            armorClass: readInteger(data, "armorClass"),
            speed: readText(data, "speed"),
            initiative: readText(data, "initiative"),
            hitPoints: {
              current: readInteger(data, "hpCurrent"),
              maximum: readInteger(data, "hpMaximum"),
              temporary: readInteger(data, "hpTemporary"),
            },
            hitDice: {
              current: String(readInteger(data, "hitDiceRemaining")),
              formula: `${readInteger(data, "hitDiceRemaining")}d${readInteger(data, "hitDieSize")}`,
              remaining: readInteger(data, "hitDiceRemaining"),
              dieSize: readInteger(data, "hitDieSize") as 4 | 6 | 8 | 10 | 12 | 20,
            },
            inspiration: data.get("inspiration") === "on",
            exhaustion: readInteger(data, "exhaustion"),
          },
        },
      }), `Guardar personaje: ${editedCharacter.name}`);
      await this.refreshStorageUsage();
      this.message = { kind: "success", text: "Personaje guardado correctamente." };
      if (renderAfterSave) this.render();
      return true;
    } catch (error) {
      this.message = { kind: "error", text: formatError(error) };
      await this.reload();
      return false;
    }
  }

  private readStringList(data: FormData, field: string): string[] {
    return readText(data, field)
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
  }

  private readChecks(data: FormData, current: CharacterChecks): CharacterChecks {
    const checks = structuredClone(current);
    (Object.keys(SKILL_DEFINITIONS) as SkillKey[]).forEach((key) => {
      checks.skills[key] = {
        proficiency: Number(readText(data, `skill_${key}_rank`)) as 0 | 0.5 | 1 | 2,
        bonus: readInteger(data, `skill_${key}_bonus`),
        rollMode: readText(data, `skill_${key}_mode`) as CharacterChecks["skills"][SkillKey]["rollMode"],
      };
    });
    (Object.keys(SAVE_DEFINITIONS) as SaveKey[]).forEach((key) => {
      checks.savingThrows[key] = {
        proficiency: Number(readText(data, `save_${key}_rank`)) as 0 | 1,
        bonus: readInteger(data, `save_${key}_bonus`),
        rollMode: readText(data, `save_${key}_mode`) as CharacterChecks["savingThrows"][SaveKey]["rollMode"],
      };
    });
    checks.initiative = {
      bonus: readInteger(data, "initiativeBonus"),
      rollMode: readText(data, "initiativeMode") as CharacterChecks["initiative"]["rollMode"],
    };
    checks.passiveBonuses = {
      perception: readInteger(data, "passive_perception_bonus"),
      investigation: readInteger(data, "passive_investigation_bonus"),
      insight: readInteger(data, "passive_insight_bonus"),
    };
    return checks;
  }
}
