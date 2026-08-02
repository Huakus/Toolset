import { EncounterApplication } from "../application/encounter/encounter-application";
import type { CampaignSnapshot } from "../application/ports/campaign-repository";
import { isBloodied, orderedCombatants } from "../domain/encounter/encounter";
import type { Encounter, EncounterCombatant } from "../domain/encounter/encounter-model";
import type { DiceRoller } from "../application/ports/dice-roller";
import { normalizeMonsterDefinition, type MonsterDefinition } from "../domain/monsters/monster-catalog";
import type { EncounterTransferStatus, ReceivedCharacterSummary, TaleSpireGmPlayer } from "../infrastructure/talespire/talespire-gm-collaboration";
import { projectCharacterStatistics } from "../domain/character/character-projection";
import { GmToolsPanel, type GmContentSection, type GmSection, type GmToolsRuntime } from "./gm-tools-panel";
import type { GmWorkspace } from "../domain/gm/gm-workspace";

type GmContentKind = "monster" | GmContentSection;

export interface GmAppRuntime extends GmToolsRuntime {
  diceRoller: DiceRoller;
  monsters: readonly MonsterDefinition[];
  subscribePlayers?: (listener: (players: TaleSpireGmPlayer[]) => void) => () => void;
  subscribeCharacterSummaries?: (listener: (summary: ReceivedCharacterSummary) => void) => () => void;
  subscribeInitiative?: (listener: (clientId: string, initiative: number) => void) => () => void;
  refreshPlayers?: () => Promise<void>;
  requestCharacterSummaries?: () => Promise<void>;
  publishEncounter?: (encounter: Encounter) => Promise<void>;
  subscribeTransferStatus?: (listener: (status: EncounterTransferStatus) => void) => () => void;
  loadCustomMonsters?: () => Promise<MonsterDefinition[]>;
  saveCustomMonster?: (definition: MonsterDefinition, previousKey: string | null) => Promise<void>;
  deleteCustomMonster?: (key: string) => Promise<void>;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function integer(value: FormDataEntryValue | null, fallback = 0): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function gmPreference(key: string, fallback: string): string {
  try { return window.localStorage.getItem(`talespire-5e-toolset:v2:gm:${key}`) ?? fallback; }
  catch { return fallback; }
}

const GM_COLORS = ["#c98282", "#d09a68", "#c5ad6a", "#79a879", "#6fae9f", "#6f96c4", "#8f83bc", "#c982a6", "#9a73ad", "#9da79a"];

interface GmHistoryState {
  encounters: CampaignSnapshot["campaign"]["encounters"];
  workspace: GmWorkspace;
}

interface ReversibleGmAction {
  id: number;
  label: string;
  before: GmHistoryState;
  after: GmHistoryState;
  occurredAt: string;
}

interface GmLogEntry {
  id: number;
  label: string;
  occurredAt: string;
  kind: "action" | "roll" | "undo" | "redo" | "system";
}

export function calculateFloatingPanelPosition(
  viewport: { width: number; height: number },
  anchor: { left: number; top: number; bottom: number },
  panel: { width: number; height: number },
  margin = 6,
): { left: number; top: number; maxHeight: number } {
  const maxHeight = Math.max(1, viewport.height - margin * 2);
  const width = Math.min(panel.width, Math.max(1, viewport.width - margin * 2));
  const height = Math.min(panel.height, maxHeight);
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - width - margin));
  const below = anchor.bottom + 4;
  const top = below + height <= viewport.height - margin
    ? below
    : Math.max(margin, Math.min(anchor.top - height - 4, viewport.height - height - margin));
  return { left, top, maxHeight };
}

const GM_CONDITIONS = [
  ["blinded", "Cegado"], ["charmed", "Hechizado"], ["deafened", "Ensordecido"],
  ["frightened", "Asustado"], ["grappled", "Agarrado"], ["incapacitated", "Incapacitado"],
  ["invisible", "Invisible"], ["paralyzed", "Paralizado"], ["petrified", "Petrificado"],
  ["poisoned", "Envenenado"], ["prone", "Derribado"], ["restrained", "Apresado"],
  ["stunned", "Aturdido"], ["unconscious", "Inconsciente"], ["concentration", "Concentración"],
  ["bless", "Bendición"], ["bane", "Perdición"], ["guidance", "Guía"],
  ["heroism", "Heroísmo"], ["sanctuary", "Santuario"], ["slow", "Ralentizado"],
  ["recharging", "Recargando"],
] as const;

export class GmApp {
  private snapshot: CampaignSnapshot | null = null;
  private selectedEncounterId: string | null = null;
  private message: { kind: "success" | "error"; text: string } | null = null;
  private players: TaleSpireGmPlayer[] = [];
  private playerSummaries = new Map<string, ReceivedCharacterSummary["summary"]>();
  private transferStatuses = new Map<string, EncounterTransferStatus>();
  private customMonsters: MonsterDefinition[] = [];
  private selectedCustomMonsterKey: string | null = null;
  private editingCustomMonsterKey: string | null = null;
  private activeSection: GmSection = "encounter";
  private activeContentKind: GmContentKind = "monster";
  private monsterSearch = "";
  private monsterFilters = new Set<string>();
  private showMonsterDescriptions = true;
  private gmColor = gmPreference("color", "#c5ad6a");
  private undoStack: ReversibleGmAction[] = [];
  private redoStack: ReversibleGmAction[] = [];
  private actionLog: GmLogEntry[] = [];
  private nextHistoryId = 1;
  private readonly toolsPanel: GmToolsPanel;
  private readonly handleOutsideCombatantClick = (event: MouseEvent): void => {
    const open = this.root.querySelector<HTMLDetailsElement>(".gm-combatant[open]");
    if (!open || !(event.target instanceof Node) || open.contains(event.target)) return;
    this.render();
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly application: EncounterApplication,
    private readonly runtime: GmAppRuntime,
  ) {
    this.toolsPanel = new GmToolsPanel(
      root,
      runtime,
      (snapshot, label) => this.acceptSnapshot(snapshot, label ?? "Actualizar espacio GM"),
      (message) => { this.message = message; },
      () => this.render(),
      (label, kind) => this.appendActionLog(label, kind),
    );
    document.addEventListener("click", this.handleOutsideCombatantClick);
    window.addEventListener("resize", () => {
      const open = this.root.querySelector<HTMLDetailsElement>(".gm-combatant[open]");
      if (open) this.positionCombatantPopover(open);
    });
  }

  async start(): Promise<void> {
    this.runtime.subscribePlayers?.((players) => { this.players = players; this.render(); });
    this.runtime.subscribeCharacterSummaries?.((received) => {
      this.playerSummaries.set(received.clientId, received.summary);
      void this.applyReceivedSummary(received);
    });
    this.runtime.subscribeInitiative?.((clientId, initiative) => { void this.applyReceivedInitiative(clientId, initiative); });
    this.runtime.subscribeTransferStatus?.((status) => {
      this.transferStatuses.set(status.clientId, status);
      this.render();
    });
    if (this.runtime.loadCustomMonsters) {
      try {
        this.customMonsters = await this.runtime.loadCustomMonsters();
        this.selectedCustomMonsterKey = this.customMonsters[0]?.name ?? null;
      } catch (error) {
        this.message = { kind: "error", text: `No se pudieron cargar los monstruos personalizados: ${this.formatError(error)}` };
      }
    }
    try { await this.toolsPanel.load(); } catch (error) {
      this.message = { kind: "error", text: `No se pudo cargar el contenido GM: ${this.formatError(error)}` };
    }
    try {
      this.snapshot = await this.application.migratePreservedLegacyEncounters();
    } catch (error) {
      this.message = { kind: "error", text: this.formatError(error) };
      this.snapshot = await this.application.loadCampaign();
    }
    this.selectAvailableEncounter();
    this.render();
    const selected = this.selectedEncounterId ? this.snapshot?.campaign.encounters[this.selectedEncounterId] : null;
    if (selected) await this.runtime.publishEncounter?.(selected);
  }

  private selectAvailableEncounter(): void {
    if (this.selectedEncounterId && this.snapshot?.campaign.encounters[this.selectedEncounterId]) return;
    this.selectedEncounterId = this.snapshot ? Object.values(this.snapshot.campaign.encounters)[0]?.id ?? null : null;
  }

  private render(): void {
    const encounters = this.snapshot ? Object.values(this.snapshot.campaign.encounters) : [];
    const selected = this.snapshot && this.selectedEncounterId ? this.snapshot.campaign.encounters[this.selectedEncounterId] ?? null : null;
    this.root.innerHTML = `
      <section class="gm-shell" style="--character-color:${this.gmColor}">
        ${this.message ? `<p class="message ${this.message.kind}" role="status">${escapeHtml(this.message.text)}</p>` : ""}
        <header class="gm-header">
          <strong class="gm-header-title">Control de GM</strong>
          <div class="gm-header-controls">${this.renderColorPicker()}${this.renderActionHistoryControls()}</div>
        </header>
        <nav class="sheet-tabs gm-section-nav">${(["encounter", "content", "notes", "tools"] as const).map((section) => `<button type="button" data-gm-section="${section}" class="sheet-tab-button ${this.activeSection === section ? "active" : ""}">${section === "encounter" ? "Encuentro" : section === "content" ? "Contenido" : section === "notes" ? "Notas" : "Herramientas"}</button>`).join("")}</nav>
        ${this.activeSection === "encounter" ? `<div class="gm-encounter-management">
          <select data-action="select-encounter" aria-label="Encuentro activo" ${encounters.length ? "" : "disabled"}>
            ${encounters.length ? encounters.map((encounter) => `<option value="${encounter.id}" ${encounter.id === selected?.id ? "selected" : ""}>${escapeHtml(encounter.name)}</option>`).join("") : '<option>Sin encuentros</option>'}
          </select>
          <details class="gm-popover gm-new-encounter"><summary>+ Encuentro</summary><div><form data-action="create-encounter" class="gm-compact-popup-form"><input name="name" required placeholder="Nombre del encuentro" aria-label="Nombre del encuentro"><button type="submit">Crear</button></form></div></details>
          <button type="button" data-action="delete-encounter" ${selected ? "" : "disabled"}>Eliminar</button>
          <span class="gm-connected-count">${this.players.length} conectado${this.players.length === 1 ? "" : "s"}</span>
          <button type="button" data-action="refresh-players" ${this.runtime.refreshPlayers ? "" : "disabled"}>Actualizar</button>
          <button type="button" data-action="request-summaries" ${this.players.length && this.runtime.requestCharacterSummaries ? "" : "disabled"}>Pedir estadísticas</button>
        </div>
        ${this.transferStatuses.size ? `<div class="gm-sync-status">${this.players.map((player) => {
          const status = this.transferStatuses.get(player.id);
          return status ? `<span class="${status.status}">${escapeHtml(player.label)}: ${status.status === "confirmed" ? "sincronizado" : status.status === "sending" ? "enviando" : status.status === "retrying" ? `reintentando (${status.attempt})` : "falló"}</span>` : "";
        }).join("")}</div>` : ""}
        ${this.snapshot ? `
          ${selected ? this.renderEncounter(selected) : '<div class="sheet-empty"><strong>No hay encuentros</strong><p>Creá uno para comenzar.</p></div>'}
        ` : '<div class="sheet-empty"><strong>No hay una campaña v2 cargada</strong><p>Importá o creá la campaña desde la hoja de personaje antes de abrir el control GM.</p></div>'}` : ""}
        ${this.activeSection === "content" ? `${this.renderContentNavigation()}${this.activeContentKind === "monster" ? this.renderCustomMonsterManager() : this.toolsPanel.render("content", this.snapshot?.campaign.gm ?? { noteGroups: [], randomTables: [], googleDocsUrl: "" }, this.activeContentKind)}` : ""}
        ${this.activeSection === "notes" && this.snapshot ? this.toolsPanel.render("notes", this.snapshot.campaign.gm) : ""}
        ${this.activeSection === "tools" && this.snapshot ? this.toolsPanel.render("tools", this.snapshot.campaign.gm) : ""}
      </section>`;
    this.bindEvents();
    if (this.snapshot) this.toolsPanel.bind(this.activeSection, this.snapshot.campaign.gm, this.snapshot.checksum);
  }

  private renderColorPicker(): string {
    return `<details class="color-picker"><summary title="Cambiar color de la interfaz GM"><span>Color</span><i style="--swatch-color:${this.gmColor}" aria-hidden="true"></i></summary><div class="color-picker-menu"><div class="color-palette" role="group" aria-label="Colores sugeridos">${GM_COLORS.map((color) => `<button type="button" class="color-swatch ${color === this.gmColor ? "active" : ""}" style="--swatch-color:${color}" data-gm-color-value="${color}" aria-label="Usar color ${color}" aria-pressed="${color === this.gmColor}"></button>`).join("")}</div><div class="color-custom-row"><label><span>Hexadecimal</span><input id="gm-interface-color" value="${this.gmColor}" maxlength="7" spellcheck="false" aria-label="Color hexadecimal"></label><button type="button" id="apply-gm-interface-color">Aplicar</button></div></div></details>`;
  }

  private renderActionHistoryControls(): string {
    const entries = this.actionLog.slice(-30).reverse();
    return `<div class="action-history-controls" aria-label="Historial de acciones del GM"><button type="button" data-gm-history="undo" title="Deshacer última acción GM" ${this.undoStack.length ? "" : "disabled"}>↶</button><button type="button" data-gm-history="redo" title="Rehacer última acción GM" ${this.redoStack.length ? "" : "disabled"}>↷</button><details class="action-log"><summary title="Ver historial GM">Log${this.actionLog.length ? ` ${this.actionLog.length}` : ""}</summary><div>${entries.length ? `<ol>${entries.map((entry) => `<li data-log-kind="${entry.kind}"><time>${entry.occurredAt.slice(11, 19)}</time><span>${escapeHtml(entry.label)}</span></li>`).join("")}</ol>` : '<p>Sin acciones registradas en esta sesión.</p>'}</div></details></div>`;
  }

  private renderContentNavigation(): string {
    const options: [GmContentKind, string, number][] = [
      ["monster", "Monstruos", this.customMonsters.length],
      ["spell", "Conjuros", this.toolsPanel.contentCount("spell")],
      ["equipment", "Equipo", this.toolsPanel.contentCount("equipment")],
      ["shop", "Tiendas", this.toolsPanel.contentCount("shop")],
    ];
    return `<nav class="filter-bar gm-subsection-nav" aria-label="Tipo de contenido">${options.map(([key, label, count]) => `<button type="button" data-gm-content-kind="${key}" class="${this.activeContentKind === key ? "active" : ""}"><span>${label}</span><strong>${count}</strong></button>`).join("")}</nav>`;
  }

  private renderEncounter(encounter: Encounter): string {
    const combatants = orderedCombatants(encounter);
    const suggestions = [
      ...this.players.map((player) => player.label),
      ...Object.values(this.snapshot?.campaign.characters ?? {}).map((character) => character.name),
      ...this.monsterCatalog().map((monster) => monster.name),
    ];
    return `
      <div class="gm-turn-bar">
        <button type="button" data-command="previous-turn">Anterior</button>
        <strong>Ronda ${encounter.round}</strong>
        <button type="button" data-command="advance-turn">Siguiente</button>
        <details class="gm-popover gm-add-combatant-popover"><summary>+ Combatiente</summary><div>
          <form data-action="add-combatant" class="gm-add-combatant">
            <select name="kind" aria-label="Tipo"><option value="custom">Personalizado</option><option value="monster">Monstruo</option><option value="player">Jugador</option></select>
            <input name="name" required placeholder="Nombre" list="gm-combatant-suggestions" autocomplete="off">
            <datalist id="gm-combatant-suggestions">${[...new Set(suggestions)].map((name) => `<option value="${escapeHtml(name)}"></option>`).join("")}</datalist>
            <label>INI<input name="initiative" type="number" step="1" placeholder="—"></label>
            <label>PG máximos<input name="maximumHitPoints" type="number" min="0" step="1" value="1"></label>
            <label>CA<input name="armorClass" type="number" min="0" step="1" placeholder="—"></label>
            <button type="submit">Agregar</button>
          </form>
        </div></details>
      </div>
      <div class="gm-combatants">
        ${combatants.length ? combatants.map((combatant) => this.renderCombatant(encounter, combatant)).join("") : '<div class="sheet-empty"><strong>Iniciativa vacía</strong><p>Agregá jugadores, monstruos o combatientes personalizados.</p></div>'}
      </div>`;
  }

  private renderCombatant(encounter: Encounter, combatant: EncounterCombatant): string {
    const active = encounter.activeCombatantId === combatant.id;
    const monster = combatant.kind === "monster" ? this.findMonster(combatant.monsterDefinitionId) : null;
    const currentPercent = combatant.hitPoints.maximum > 0 ? Math.min(100, combatant.hitPoints.current / combatant.hitPoints.maximum * 100) : 0;
    const temporaryPercent = combatant.hitPoints.maximum > 0 ? Math.min(100, combatant.hitPoints.temporary / combatant.hitPoints.maximum * 100) : 0;
    const temporaryBottom = Math.min(currentPercent, 100 - temporaryPercent);
    const hitPointHue = Math.round(currentPercent / 100 * 112);
    const conditions = [...combatant.conditions];
    const bloodied = isBloodied(combatant) && !conditions.some((condition) => condition.key === "bloodied");
    return `<details class="gm-combatant ${active ? "active" : ""}" data-combatant-id="${combatant.id}">
      <summary class="gm-combatant-summary">
        <span class="gm-combatant-identity"><strong>${escapeHtml(combatant.name)}</strong><small>${combatant.kind === "player" ? "Jugador" : combatant.kind === "monster" ? "Monstruo" : "Personalizado"}</small></span>
        <span><small>INI</small><strong>${combatant.initiative ?? "—"}</strong></span>
        <span><small>CA</small><strong>${combatant.armorClass ?? "—"}</strong></span>
        <div class="hp-readout gm-combatant-hp-readout" style="--hp-level:${Math.round(currentPercent)}%;--hp-temp-level:${Math.round(temporaryPercent)}%;--hp-temp-bottom:${Math.round(temporaryBottom)}%;--hp-tone:hsl(${hitPointHue} 38% 43%)" role="meter" aria-label="Puntos de golpe" aria-valuemin="0" aria-valuemax="${combatant.hitPoints.maximum}" aria-valuenow="${combatant.hitPoints.current}"><span>PG</span><strong>${combatant.hitPoints.current}${combatant.hitPoints.temporary ? `<b> + ${combatant.hitPoints.temporary}</b>` : ""}<small> / ${combatant.hitPoints.maximum}</small></strong><em>${combatant.hitPoints.temporary ? "Temp. en azul" : "Actuales"}</em></div>
        <span class="gm-summary-conditions">${conditions.map((condition) => escapeHtml(condition.label)).join(" · ")}${bloodied ? `${conditions.length ? " · " : ""}Herido` : ""}</span>
      </summary>
      <div class="gm-combatant-popover">
        <div class="gm-combatant-control-row"><button type="button" data-action="activate-combatant">Hacer activo</button><label>INI<input data-action="initiative" type="number" step="1" value="${combatant.initiative ?? ""}"></label><button type="button" data-action="save-initiative">Guardar INI</button><button type="button" data-action="roll-initiative">Tirar INI</button></div>
        <div class="gm-card-actions"><input data-action="hp-amount" type="number" min="1" step="1" value="1" aria-label="Cantidad de puntos de golpe"><button type="button" data-action="damage">Daño</button><button type="button" data-action="heal">Curar</button><button type="button" data-action="temporary-hit-points">PG temp.</button></div>
        <div class="gm-condition-pills">${conditions.map((condition) => `<button type="button" data-action="remove-condition" data-condition-id="${condition.id}" title="Quitar condición">${escapeHtml(condition.label)} ×</button>`).join("")}${bloodied ? '<span class="bloodied">Herido</span>' : ""}</div>
        <div class="gm-condition-control"><select data-action="condition-select" aria-label="Condición">${GM_CONDITIONS.filter(([key]) => !conditions.some((condition) => condition.key === key)).map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}</select><button type="button" data-action="add-condition" ${GM_CONDITIONS.every(([key]) => conditions.some((condition) => condition.key === key)) ? "disabled" : ""}>Agregar</button></div>
        <div class="gm-card-actions gm-card-danger"><button type="button" data-action="toggle-visibility" class="${combatant.visibleToPlayers ? "visible" : "hidden"}">${combatant.visibleToPlayers ? "Visible" : "Oculto"}</button><button type="button" data-action="remove-combatant">Quitar del encuentro</button></div>
        ${monster ? this.renderMonsterDetails(monster) : ""}
      </div>
    </details>`;
  }

  private renderMonsterDetails(monster: MonsterDefinition): string {
    const sections = [
      ["Rasgos", monster.traits], ["Acciones", monster.actions],
      ["Reacciones", monster.reactions], ["Acciones legendarias", monster.legendaryActions],
    ] as const;
    return `<details class="gm-monster-details"><summary>${escapeHtml(monster.type || "Estadísticas")} · VD ${escapeHtml(monster.challenge || "—")} · ${escapeHtml(monster.speed.join(", "))}</summary>
      <div class="gm-abilities">${Object.entries(monster.abilities).map(([key, value]) => `<span>${escapeHtml(key.toUpperCase())} <strong>${value}</strong></span>`).join("")}</div>
      ${this.monsterFact("Salvaciones", monster.saves)}${this.monsterFact("Habilidades", monster.skills)}
      ${this.monsterFact("Vulnerabilidades", monster.damageVulnerabilities)}${this.monsterFact("Resistencias", monster.damageResistances)}
      ${this.monsterFact("Inmunidades", monster.damageImmunities)}${this.monsterFact("Inmunidad a condiciones", monster.conditionImmunities)}
      ${this.monsterFact("Sentidos", monster.senses)}${this.monsterFact("Idiomas", monster.languages)}
      ${sections.filter(([, entries]) => entries.length).map(([title, entries]) => `<section><strong>${title}</strong>${entries.map((entry) => `<p><b>${escapeHtml(entry.name)}</b> ${escapeHtml(entry.content)} ${this.renderDiceButtons(entry.name, entry.content)}</p>`).join("")}</section>`).join("")}
    </details>`;
  }

  private renderCustomMonsterManager(): string {
    if (!this.runtime.loadCustomMonsters) return "";
    const selected = this.selectedCustomMonsterKey ? this.customMonsters.find((monster) => monster.name === this.selectedCustomMonsterKey) ?? null : null;
    const editing = selected !== null && this.editingCustomMonsterKey === selected.name;
    if (editing || !selected && this.editingCustomMonsterKey === "__new__") {
      return `<section class="gm-editor-surface"><div class="gm-edit-heading"><strong>${selected?.name ?? "Nuevo monstruo"}</strong><button type="button" data-action="cancel-custom-monster">Volver</button></div>${this.renderCustomMonsterForm(selected)}</section>`;
    }
    const filterValues = [...new Set(this.customMonsters.flatMap((monster) => [monster.type ? `tipo:${monster.type}` : "", monster.challenge ? `vd:${monster.challenge}` : ""]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    const monsters = this.customMonsters.filter((monster) => [...this.monsterFilters].every((filter) => filter === `tipo:${monster.type}` || filter === `vd:${monster.challenge}`));
    return `<section class="gm-content-catalog"><div class="spell-search-row gm-content-search-row"><label class="spell-search"><span>Buscar</span><input data-gm-monster-search type="search" value="${escapeHtml(this.monsterSearch)}" placeholder="Nombre, tipo, rasgo, acción…"></label><button type="button" class="description-toggle" data-gm-toggle-monster-descriptions>${this.showMonsterDescriptions ? "Ocultar descripciones" : "Mostrar descripciones"}</button><button type="button" data-action="new-custom-monster">+ monstruo</button></div><nav class="filter-bar property-filter gm-content-filter-bar"><button type="button" data-gm-clear-monster-filters class="${this.monsterFilters.size ? "" : "active"}">Sin filtros</button>${filterValues.map((filter) => `<button type="button" data-gm-monster-filter="${escapeHtml(filter)}" class="${this.monsterFilters.has(filter) ? "active" : ""}">${escapeHtml(filter.replace(/^\w+:/, ""))}</button>`).join("")}</nav><div class="gm-catalog-grid">${monsters.map((monster) => this.renderCustomMonsterCard(monster)).join("")}</div><div class="sheet-empty gm-content-empty" ${monsters.length ? "hidden" : ""}><strong>Sin resultados</strong><p>No hay monstruos que coincidan con los filtros.</p></div></section>`;
  }

  private renderCustomMonsterCard(monster: MonsterDefinition): string {
    const search = [monster.name, monster.type, monster.challenge, ...monster.traits.flatMap((entry) => [entry.name, entry.content]), ...monster.actions.flatMap((entry) => [entry.name, entry.content])].join(" ").toLocaleLowerCase();
    return `<article class="play-card gm-catalog-card gm-monster-card" data-gm-content-card data-search="${escapeHtml(search)}"><header><div><span class="card-kicker">${escapeHtml(monster.type || "Sin tipo")} · VD ${escapeHtml(monster.challenge || "—")}</span><h3>${escapeHtml(monster.name)}</h3></div><div class="card-buttons"><button type="button" data-action="edit-custom-monster" data-monster-key="${escapeHtml(monster.name)}">Editar</button><button type="button" data-action="delete-custom-monster" data-monster-key="${escapeHtml(monster.name)}">Eliminar</button></div></header><div class="gm-card-facts"><span>CA ${monster.armorClass}</span><span>PG ${monster.hitPoints}</span><span>${escapeHtml(monster.speed.join(", ") || "—")}</span></div>${this.showMonsterDescriptions ? `<div class="gm-card-description">${monster.traits.slice(0, 2).map((entry) => `<p><b>${escapeHtml(entry.name)}.</b> ${escapeHtml(entry.content)}</p>`).join("") || monster.actions.slice(0, 2).map((entry) => `<p><b>${escapeHtml(entry.name)}.</b> ${escapeHtml(entry.content)}</p>`).join("") || "<p>Sin descripción.</p>"}</div>` : ""}</article>`;
  }

  private renderCustomMonsterView(monster: MonsterDefinition): string {
    const facts = [monster.type, monster.challenge ? `VD ${monster.challenge}` : "", monster.speed.join(", ")].filter(Boolean);
    const sections = [["Rasgos", monster.traits], ["Acciones", monster.actions], ["Reacciones", monster.reactions], ["Legendarias", monster.legendaryActions]] as const;
    return `<article class="gm-content-view gm-monster-view"><div class="gm-content-facts"><span>CA <strong>${monster.armorClass}</strong></span><span>PG <strong>${monster.hitPoints}</strong>${monster.hitPointFormula ? ` (${escapeHtml(monster.hitPointFormula)})` : ""}</span>${facts.map((fact) => `<span>${escapeHtml(fact)}</span>`).join("")}</div><div class="gm-abilities">${Object.entries(monster.abilities).map(([key, value]) => `<span>${escapeHtml(key.toUpperCase())} <strong>${value}</strong></span>`).join("")}</div>${this.monsterFact("Salvaciones", monster.saves)}${this.monsterFact("Habilidades", monster.skills)}${this.monsterFact("Resistencias", monster.damageResistances)}${this.monsterFact("Inmunidades", monster.damageImmunities)}${sections.filter(([, entries]) => entries.length).map(([title, entries]) => `<section class="gm-monster-view-section"><strong>${title}</strong>${entries.map((entry) => `<p><b>${escapeHtml(entry.name)}.</b> ${escapeHtml(entry.content)}</p>`).join("")}</section>`).join("")}</article>`;
  }

  private renderCustomMonsterForm(monster: MonsterDefinition | null): string {
    const ability = (key: string): number => monster?.abilities[key] ?? monster?.abilities[key.toLocaleLowerCase()] ?? 10;
    const list = (values: string[]): string => escapeHtml(values.join(", "));
    const featureText = (values: MonsterDefinition["traits"]): string => escapeHtml(values.map((entry) => `${entry.name} | ${entry.content}${entry.usage ? ` | ${entry.usage}` : ""}`).join("\n"));
    return `<form data-action="save-custom-monster" class="gm-custom-monster-form">
      <div class="gm-monster-core-fields">
        <label>Nombre<input name="name" required value="${escapeHtml(monster?.name ?? "")}"></label>
        <label>Tipo<input name="type" value="${escapeHtml(monster?.type ?? "")}"></label>
        <label>VD<input name="challenge" value="${escapeHtml(monster?.challenge ?? "0")}"></label>
        <label>CA<input name="armorClass" type="number" min="0" step="1" value="${monster?.armorClass ?? 10}"></label>
        <label>PG<input name="hitPoints" type="number" min="0" step="1" value="${monster?.hitPoints ?? 10}"></label>
        <label>Dados de PG<input name="hitPointFormula" value="${escapeHtml(monster?.hitPointFormula ?? "")}" placeholder="2d8+2"></label>
        <label>INI<input name="initiativeModifier" type="number" step="1" value="${monster?.initiativeModifier ?? 0}"></label>
        <label>Velocidad<input name="speed" value="${list(monster?.speed ?? [])}" placeholder="30 pies, volar 60 pies"></label>
        <label class="checkbox"><input name="initiativeAdvantage" type="checkbox" ${monster?.initiativeAdvantage ? "checked" : ""}> Ventaja en iniciativa</label>
      </div>
      <div class="gm-monster-abilities">${[["Str", "FUE"], ["Dex", "DES"], ["Con", "CON"], ["Int", "INT"], ["Wis", "SAB"], ["Cha", "CAR"]].map(([key, label]) => `<label>${label}<input name="ability${key}" type="number" step="1" value="${ability(key!)}"></label>`).join("")}</div>
      <div class="gm-monster-list-fields">
        <label>Salvaciones<input name="saves" value="${list(monster?.saves ?? [])}"></label>
        <label>Habilidades<input name="skills" value="${list(monster?.skills ?? [])}"></label>
        <label>Sentidos<input name="senses" value="${list(monster?.senses ?? [])}"></label>
        <label>Idiomas<input name="languages" value="${list(monster?.languages ?? [])}"></label>
        <label>Vulnerabilidades<input name="vulnerabilities" value="${list(monster?.damageVulnerabilities ?? [])}"></label>
        <label>Resistencias<input name="resistances" value="${list(monster?.damageResistances ?? [])}"></label>
        <label>Inmunidades<input name="immunities" value="${list(monster?.damageImmunities ?? [])}"></label>
        <label>Inmunidad a condiciones<input name="conditionImmunities" value="${list(monster?.conditionImmunities ?? [])}"></label>
      </div>
      <p class="gm-editor-help">Una entrada por línea: Nombre | descripción | uso opcional</p>
      <label>Rasgos<textarea name="traits">${featureText(monster?.traits ?? [])}</textarea></label>
      <label>Acciones<textarea name="actions">${featureText(monster?.actions ?? [])}</textarea></label>
      <label>Reacciones<textarea name="reactions">${featureText(monster?.reactions ?? [])}</textarea></label>
      <label>Acciones legendarias<textarea name="legendaryActions">${featureText(monster?.legendaryActions ?? [])}</textarea></label>
      <div class="gm-custom-form-actions"><button type="submit">${monster ? "Guardar monstruo" : "Crear monstruo"}</button><button type="button" data-action="cancel-custom-monster">Limpiar</button></div>
    </form>`;
  }

  private monsterFact(label: string, values: string[]): string {
    return values.length ? `<p class="gm-monster-fact"><b>${label}:</b> ${escapeHtml(values.join(", "))}</p>` : "";
  }

  private renderDiceButtons(name: string, content: string): string {
    const expressions = [...new Set(content.match(/\b\d+d\d+(?:\s*[+-]\s*\d+)?/gi) ?? [])];
    return expressions.map((expression) => `<button type="button" class="gm-roll" data-roll-name="${escapeHtml(name)}" data-roll-expression="${escapeHtml(expression.replaceAll(" ", ""))}">${escapeHtml(expression)}</button>`).join(" ");
  }

  private bindEvents(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-gm-color-value]").forEach((button) => button.addEventListener("click", () => this.setGmColor(button.dataset.gmColorValue ?? "")));
    this.root.querySelector<HTMLButtonElement>("#apply-gm-interface-color")?.addEventListener("click", () => this.setGmColor(this.root.querySelector<HTMLInputElement>("#gm-interface-color")?.value ?? ""));
    this.root.querySelectorAll<HTMLButtonElement>("[data-gm-history]").forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.gmHistory === "undo") void this.undoLastAction();
      if (button.dataset.gmHistory === "redo") void this.redoLastAction();
    }));
    this.root.querySelectorAll<HTMLButtonElement>("[data-gm-section]").forEach((button) => button.addEventListener("click", () => {
      this.activeSection = button.dataset.gmSection as GmSection;
      this.render();
    }));
    this.root.querySelectorAll<HTMLButtonElement>("[data-gm-content-kind]").forEach((button) => button.addEventListener("click", () => {
      this.activeContentKind = button.dataset.gmContentKind as GmContentKind;
      this.render();
    }));
    this.root.querySelector('[data-action="new-custom-monster"]')?.addEventListener("click", () => { this.selectedCustomMonsterKey = null; this.editingCustomMonsterKey = "__new__"; this.render(); });
    this.root.querySelectorAll<HTMLElement>('[data-action="edit-custom-monster"]').forEach((button) => button.addEventListener("click", () => {
      this.selectedCustomMonsterKey = button.dataset.monsterKey ?? this.selectedCustomMonsterKey;
      this.editingCustomMonsterKey = this.selectedCustomMonsterKey;
      this.render();
    }));
    this.root.querySelectorAll<HTMLElement>('[data-action="delete-custom-monster"]').forEach((button) => button.addEventListener("click", () => { this.selectedCustomMonsterKey = button.dataset.monsterKey ?? this.selectedCustomMonsterKey; void this.deleteCustomMonster(); }));
    this.root.querySelector('[data-action="cancel-custom-monster"]')?.addEventListener("click", () => {
      this.editingCustomMonsterKey = null;
      this.render();
    });
    this.root.querySelector<HTMLInputElement>("[data-gm-monster-search]")?.addEventListener("input", (event) => { this.monsterSearch = (event.currentTarget as HTMLInputElement).value; this.applyMonsterSearch(); });
    this.root.querySelector("[data-gm-toggle-monster-descriptions]")?.addEventListener("click", () => { this.showMonsterDescriptions = !this.showMonsterDescriptions; this.render(); });
    this.root.querySelectorAll<HTMLButtonElement>("[data-gm-monster-filter]").forEach((button) => button.addEventListener("click", () => { const filter = button.dataset.gmMonsterFilter!; if (this.monsterFilters.has(filter)) this.monsterFilters.delete(filter); else this.monsterFilters.add(filter); this.render(); }));
    this.root.querySelector("[data-gm-clear-monster-filters]")?.addEventListener("click", () => { this.monsterFilters.clear(); this.render(); });
    this.root.querySelector<HTMLFormElement>('[data-action="save-custom-monster"]')?.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.saveCustomMonster(new FormData(event.currentTarget as HTMLFormElement));
    });
    this.root.querySelector<HTMLFormElement>('[data-action="create-encounter"]')?.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = String(new FormData(event.currentTarget as HTMLFormElement).get("name") ?? "").trim();
      if (name) void this.execute(async () => {
        const snapshot = await this.application.createEncounter(name, this.requireSnapshot().checksum);
        this.selectedEncounterId = Object.values(snapshot.campaign.encounters).find((encounter) => encounter.name === name)?.id ?? null;
        return snapshot;
      }, "Encuentro creado.");
    });
    this.root.querySelector<HTMLSelectElement>('[data-action="select-encounter"]')?.addEventListener("change", (event) => {
      this.selectedEncounterId = (event.currentTarget as HTMLSelectElement).value;
      this.render();
      const selected = this.requireEncounter();
      void this.runtime.publishEncounter?.(selected);
    });
    this.root.querySelector('[data-action="refresh-players"]')?.addEventListener("click", () => void this.runtime.refreshPlayers?.());
    this.root.querySelector('[data-action="request-summaries"]')?.addEventListener("click", () => void this.runtime.requestCharacterSummaries?.().catch((error) => {
      this.message = { kind: "error", text: this.formatError(error) };
      this.render();
    }));
    this.root.querySelector<HTMLButtonElement>('[data-action="delete-encounter"]')?.addEventListener("click", () => {
      const encounter = this.requireEncounter();
      if (globalThis.confirm && !globalThis.confirm(`¿Eliminar ${encounter.name}?`)) return;
      void this.execute(() => this.application.deleteEncounter(encounter.id, this.requireSnapshot().checksum), "Encuentro eliminado.");
    });
    this.root.querySelector<HTMLFormElement>('[data-action="add-combatant"]')?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget as HTMLFormElement);
      const encounter = this.requireEncounter();
      const kind = String(data.get("kind"));
      const name = String(data.get("name") ?? "").trim();
      const maximum = Math.max(0, integer(data.get("maximumHitPoints"), 1));
      const initiativeText = String(data.get("initiative") ?? "").trim();
      const base = {
        name,
        initiative: initiativeText ? integer(initiativeText) : null,
        armorClass: String(data.get("armorClass") ?? "").trim() ? Math.max(0, integer(data.get("armorClass"))) : null,
        hitPoints: { current: maximum, maximum, temporary: 0 },
        conditions: [],
        visibleToPlayers: true,
      };
      const monster = this.findMonster(name);
      const connectedPlayer = this.players.find((player) => player.label === name) ?? null;
      const summary = connectedPlayer ? this.playerSummaries.get(connectedPlayer.id) ?? null : null;
      const character = Object.values(this.requireSnapshot().campaign.characters).find((entry) => entry.name === name) ?? null;
      const combatant = kind === "monster" && monster
        ? { ...base, name: monster.name, armorClass: monster.armorClass, hitPoints: { current: monster.hitPoints, maximum: monster.hitPoints, temporary: 0 }, kind: "monster" as const, monsterDefinitionId: monster.id }
        : kind === "monster"
          ? { ...base, kind: "monster" as const, monsterDefinitionId: name }
          : kind === "player"
            ? {
                ...base,
                name: summary?.name ?? character?.name ?? name,
                armorClass: summary?.armorClass ?? character?.combat.armorClass ?? base.armorClass,
                hitPoints: summary
                  ? { current: summary.currentHitPoints, maximum: summary.maximumHitPoints, temporary: summary.temporaryHitPoints }
                  : character?.combat.hitPoints ?? base.hitPoints,
                initiative: base.initiative,
                kind: "player" as const,
                characterId: character?.id ?? summary?.characterId ?? null,
                taleSpireClientId: connectedPlayer?.id ?? null,
              }
          : { ...base, kind: "custom" as const };
      void this.execute(() => this.application.addCombatant({
        encounterId: encounter.id,
        expectedEncounterRevision: encounter.revision,
        expectedCampaignChecksum: this.requireSnapshot().checksum,
        combatant,
      }), "Combatiente agregado.");
    });
    this.root.querySelectorAll<HTMLElement>("[data-command]").forEach((button) => button.addEventListener("click", () => {
      const command = button.dataset.command;
      if (command === "advance-turn" || command === "previous-turn") void this.apply({ kind: command });
    }));
    this.root.querySelectorAll<HTMLElement>("[data-combatant-id]").forEach((card) => {
      const combatantId = card.dataset.combatantId!;
      card.querySelector<HTMLElement>(".gm-combatant-summary")?.addEventListener("click", (event) => {
        event.preventDefault(); event.stopPropagation();
        const details = card as HTMLDetailsElement;
        if (details.open) { this.render(); return; }
        this.root.querySelectorAll<HTMLDetailsElement>(".gm-combatant[open]").forEach((entry) => { entry.open = false; });
        details.open = true;
        this.positionCombatantPopover(details);
      });
      card.querySelector('[data-action="activate-combatant"]')?.addEventListener("click", () => void this.apply({ kind: "set-active-combatant", combatantId }));
      card.querySelector('[data-action="save-initiative"]')?.addEventListener("click", () => {
        const input = card.querySelector<HTMLInputElement>('[data-action="initiative"]');
        if (input) void this.apply({ kind: "set-initiative", combatantId, initiative: input.value === "" ? null : integer(input.value) });
      });
      card.querySelector('[data-action="remove-combatant"]')?.addEventListener("click", () => {
        const combatant = this.requireEncounter().combatants.find((entry) => entry.id === combatantId);
        if (combatant && (!globalThis.confirm || globalThis.confirm(`¿Quitar a ${combatant.name} del encuentro?`))) {
          void this.apply({ kind: "remove-combatant", combatantId });
        }
      });
      card.querySelector('[data-action="roll-initiative"]')?.addEventListener("click", () => { void this.rollCombatantInitiative(combatantId); });
      for (const kind of ["damage", "heal", "grant-temporary-hit-points"] as const) {
        const action = kind === "grant-temporary-hit-points" ? "temporary-hit-points" : kind;
        card.querySelector(`[data-action="${action}"]`)?.addEventListener("click", () => {
          const amount = integer(card.querySelector<HTMLInputElement>('[data-action="hp-amount"]')?.value ?? null);
          if (amount > 0) void this.apply({ kind, combatantId, amount });
        });
      }
      const hpAmount = card.querySelector<HTMLInputElement>('[data-action="hp-amount"]');
      hpAmount?.addEventListener("input", () => {
        const valid = Number.isSafeInteger(Number(hpAmount.value)) && Number(hpAmount.value) > 0;
        for (const action of ["damage", "heal", "temporary-hit-points"]) {
          const button = card.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
          if (button) button.disabled = !valid;
        }
      });
      card.querySelector('[data-action="toggle-visibility"]')?.addEventListener("click", () => {
        const combatant = this.requireEncounter().combatants.find((entry) => entry.id === combatantId);
        if (combatant) void this.apply({ kind: "set-visibility", combatantId, visibleToPlayers: !combatant.visibleToPlayers });
      });
      card.querySelector('[data-action="add-condition"]')?.addEventListener("click", () => { void this.addCondition(combatantId, card); });
      card.querySelectorAll<HTMLElement>('[data-action="remove-condition"]').forEach((button) => button.addEventListener("click", () => {
        const conditionId = button.dataset.conditionId;
        if (conditionId) void this.apply({ kind: "remove-condition", combatantId, conditionId });
      }));
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-roll-expression]").forEach((button) => button.addEventListener("click", () => {
      const expression = button.dataset.rollExpression;
      if (!expression) return;
      void this.runtime.diceRoller.roll({ name: button.dataset.rollName || "Monstruo", expressions: [expression], mode: "normal" })
        .then((result) => { this.appendActionLog(`${button.dataset.rollName || "Tirada"}: ${result.summary}`, "roll"); this.message = { kind: "success", text: result.summary }; this.render(); })
        .catch((error) => { this.message = { kind: "error", text: this.formatError(error) }; this.render(); });
    }));
    this.applyMonsterSearch();
  }

  private applyMonsterSearch(): void {
    const input = this.root.querySelector<HTMLInputElement>("[data-gm-monster-search]");
    if (!input) return;
    const query = input.value.trim().toLocaleLowerCase();
    let visible = 0;
    this.root.querySelectorAll<HTMLElement>(".gm-monster-card[data-gm-content-card]").forEach((card) => {
      const matches = !query || (card.dataset.search ?? "").includes(query);
      card.hidden = !matches;
      if (matches) visible += 1;
    });
    const empty = this.root.querySelector<HTMLElement>(".gm-content-empty");
    if (empty) empty.hidden = visible > 0;
  }

  private positionCombatantPopover(details: HTMLDetailsElement): void {
    const popup = details.querySelector<HTMLElement>(".gm-combatant-popover");
    const summary = details.querySelector<HTMLElement>(".gm-combatant-summary");
    if (!popup || !summary) return;
    popup.style.visibility = "hidden";
    popup.style.left = "0px";
    popup.style.top = "0px";
    const margin = 6;
    const anchor = summary.getBoundingClientRect();
    const bounds = popup.getBoundingClientRect();
    const position = calculateFloatingPanelPosition(
      { width: window.innerWidth, height: window.innerHeight },
      anchor,
      bounds,
      margin,
    );
    popup.style.maxHeight = `${position.maxHeight}px`;
    popup.style.left = `${position.left}px`;
    popup.style.top = `${position.top}px`;
    popup.style.visibility = "visible";
  }

  private apply(action: Parameters<EncounterApplication["apply"]>[0]["action"]): Promise<void> {
    const encounter = this.requireEncounter();
    return this.execute(async () => (await this.application.apply({
      encounterId: encounter.id,
      expectedEncounterRevision: encounter.revision,
      expectedCampaignChecksum: this.requireSnapshot().checksum,
      action,
    })).snapshot, this.describeEncounterAction(action));
  }

  private async execute(operation: () => Promise<CampaignSnapshot>, success?: string): Promise<void> {
    const before = this.snapshot ? this.captureHistoryState(this.snapshot) : null;
    try {
      const snapshot = await operation();
      if (before) this.recordReversibleAction(success ?? "Actualizar encuentro", before, this.captureHistoryState(snapshot));
      this.snapshot = snapshot;
      this.message = success ? { kind: "success", text: success } : null;
      this.selectAvailableEncounter();
      const active = this.selectedEncounterId ? this.snapshot.campaign.encounters[this.selectedEncounterId] : null;
      if (active) await this.runtime.publishEncounter?.(active);
    } catch (error) {
      this.message = { kind: "error", text: this.formatError(error) };
      this.snapshot = await this.application.loadCampaign();
    }
    this.selectAvailableEncounter();
    this.render();
  }

  private captureHistoryState(snapshot: CampaignSnapshot): GmHistoryState {
    return { encounters: structuredClone(snapshot.campaign.encounters), workspace: structuredClone(snapshot.campaign.gm) };
  }

  private acceptSnapshot(snapshot: CampaignSnapshot, label: string): void {
    if (this.snapshot) this.recordReversibleAction(label, this.captureHistoryState(this.snapshot), this.captureHistoryState(snapshot));
    this.snapshot = snapshot;
  }

  private recordReversibleAction(label: string, before: GmHistoryState, after: GmHistoryState): void {
    this.undoStack.push({ id: this.nextHistoryId++, label, before, after, occurredAt: new Date().toISOString() });
    if (this.undoStack.length > 30) this.undoStack.shift();
    this.redoStack = [];
    this.appendActionLog(label);
  }

  private appendActionLog(label: string, kind: GmLogEntry["kind"] = "action"): void {
    this.actionLog.push({ id: this.nextHistoryId++, label, occurredAt: new Date().toISOString(), kind });
    if (this.actionLog.length > 150) this.actionLog.splice(0, this.actionLog.length - 150);
  }

  private async restoreHistoryEntry(entry: ReversibleGmAction, state: "before" | "after"): Promise<CampaignSnapshot> {
    const target = entry[state];
    return this.application.restoreGmControlState({
      expectedCampaignChecksum: this.requireSnapshot().checksum,
      encounters: target.encounters,
      workspace: target.workspace,
    });
  }

  private async undoLastAction(): Promise<void> {
    const entry = this.undoStack.pop();
    if (!entry) return;
    try {
      this.snapshot = await this.restoreHistoryEntry(entry, "before");
      this.redoStack.push(entry);
      this.appendActionLog(`Deshacer: ${entry.label}`, "undo");
      this.message = { kind: "success", text: `Deshecho: ${entry.label}` };
      this.selectAvailableEncounter();
      this.render();
    } catch (error) {
      this.undoStack.push(entry);
      this.message = { kind: "error", text: this.formatError(error) };
      this.snapshot = await this.application.loadCampaign();
      this.render();
    }
  }

  private async redoLastAction(): Promise<void> {
    const entry = this.redoStack.pop();
    if (!entry) return;
    try {
      this.snapshot = await this.restoreHistoryEntry(entry, "after");
      this.undoStack.push(entry);
      this.appendActionLog(`Rehacer: ${entry.label}`, "redo");
      this.message = { kind: "success", text: `Rehecho: ${entry.label}` };
      this.selectAvailableEncounter();
      this.render();
    } catch (error) {
      this.redoStack.push(entry);
      this.message = { kind: "error", text: this.formatError(error) };
      this.snapshot = await this.application.loadCampaign();
      this.render();
    }
  }

  private setGmColor(candidate: string): void {
    const color = candidate.startsWith("#") ? candidate : `#${candidate}`;
    if (!/^#[0-9a-f]{6}$/i.test(color)) {
      this.message = { kind: "error", text: "Ingresá un color hexadecimal válido, por ejemplo #6f96c4." };
      this.render();
      return;
    }
    this.gmColor = color.toLowerCase();
    try { window.localStorage.setItem("talespire-5e-toolset:v2:gm:color", this.gmColor); } catch { /* Persiste durante la sesión. */ }
    this.appendActionLog(`Cambiar color GM a ${this.gmColor}`, "system");
    this.render();
  }

  private describeEncounterAction(action: Parameters<EncounterApplication["apply"]>[0]["action"]): string {
    const labels: Record<string, string> = {
      "advance-turn": "Avanzar turno", "previous-turn": "Retroceder turno", "set-active-combatant": "Cambiar combatiente activo",
      "set-initiative": "Actualizar iniciativa", "remove-combatant": "Quitar combatiente", damage: "Aplicar daño", heal: "Curar combatiente",
      "grant-temporary-hit-points": "Agregar PG temporales", "set-visibility": "Cambiar visibilidad", "add-condition": "Agregar condición", "remove-condition": "Quitar condición",
      "add-combatant": "Agregar combatiente", "update-combatant-stats": "Actualizar estadísticas",
    };
    return labels[action.kind] ?? "Actualizar encuentro";
  }

  private findMonster(nameOrId: string): MonsterDefinition | null {
    const normalized = nameOrId.trim().toLocaleLowerCase();
    return this.monsterCatalog().find((monster) => monster.id.toLocaleLowerCase() === normalized || monster.name.toLocaleLowerCase() === normalized) ?? null;
  }

  private monsterCatalog(): MonsterDefinition[] {
    const catalog = new Map<string, MonsterDefinition>();
    for (const monster of this.runtime.monsters) catalog.set(monster.name.toLocaleLowerCase(), monster);
    for (const monster of this.customMonsters) catalog.set(monster.name.toLocaleLowerCase(), monster);
    return [...catalog.values()].sort((left, right) => left.name.localeCompare(right.name, "es", { sensitivity: "base" }));
  }

  private async saveCustomMonster(data: FormData): Promise<void> {
    if (!this.runtime.saveCustomMonster) return;
    const name = String(data.get("name") ?? "").trim();
    if (!name) return;
    const duplicate = this.customMonsters.find((monster) => monster.name.toLocaleLowerCase() === name.toLocaleLowerCase() && monster.name !== this.editingCustomMonsterKey);
    if (duplicate && globalThis.confirm && !globalThis.confirm(`Ya existe ${duplicate.name}. ¿Sobrescribirlo?`)) return;
    const featureData = (key: string) => String(data.get(key) ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [entryName = "", content = "", usage = ""] = line.split("|").map((part) => part.trim());
      return { Name: entryName, Content: content, Usage: usage };
    });
    const list = (key: string): string[] => String(data.get(key) ?? "").split(/[,\r\n]+/).map((entry) => entry.trim()).filter(Boolean);
    const definition = normalizeMonsterDefinition({
      Id: name,
      Name: name,
      Source: "Homebrew",
      Type: String(data.get("type") ?? "").trim(),
      Challenge: String(data.get("challenge") ?? "0").trim(),
      HP: { Value: Math.max(0, integer(data.get("hitPoints"), 10)), Notes: String(data.get("hitPointFormula") ?? "").trim() },
      AC: { Value: Math.max(0, integer(data.get("armorClass"), 10)), Notes: "" },
      InitiativeModifier: integer(data.get("initiativeModifier")),
      InitiativeAdvantage: data.get("initiativeAdvantage") === "on",
      Speed: list("speed"),
      Abilities: Object.fromEntries(["Str", "Dex", "Con", "Int", "Wis", "Cha"].map((key) => [key, integer(data.get(`ability${key}`), 10)])),
      Saves: list("saves"), Skills: list("skills"), Senses: list("senses"), Languages: list("languages"),
      DamageVulnerabilities: list("vulnerabilities"), DamageResistances: list("resistances"),
      DamageImmunities: list("immunities"), ConditionImmunities: list("conditionImmunities"),
      Traits: featureData("traits"), Actions: featureData("actions"), Reactions: featureData("reactions"),
      LegendaryActions: featureData("legendaryActions"),
    });
    try {
      const previousKey = this.editingCustomMonsterKey === "__new__" ? null : this.editingCustomMonsterKey ?? this.selectedCustomMonsterKey ?? duplicate?.name ?? null;
      await this.runtime.saveCustomMonster(definition, previousKey);
      this.customMonsters = [...this.customMonsters.filter((monster) =>
        monster.name !== previousKey && monster.name.toLocaleLowerCase() !== definition.name.toLocaleLowerCase()), definition];
      this.selectedCustomMonsterKey = definition.name;
      this.editingCustomMonsterKey = null;
      this.appendActionLog(`Guardar monstruo: ${definition.name}`);
      this.message = { kind: "success", text: `${definition.name} guardado en el contenido global.` };
    } catch (error) {
      this.message = { kind: "error", text: this.formatError(error) };
    }
    this.render();
  }

  private async deleteCustomMonster(): Promise<void> {
    const key = this.selectedCustomMonsterKey;
    if (!key || !this.runtime.deleteCustomMonster) return;
    if (globalThis.confirm && !globalThis.confirm(`¿Eliminar definitivamente ${key}?`)) return;
    try {
      await this.runtime.deleteCustomMonster(key);
      this.customMonsters = this.customMonsters.filter((monster) => monster.name !== key);
      this.selectedCustomMonsterKey = this.customMonsters[0]?.name ?? null;
      this.editingCustomMonsterKey = null;
      this.appendActionLog(`Eliminar monstruo: ${key}`);
      this.message = { kind: "success", text: `${key} eliminado del contenido global.` };
    } catch (error) {
      this.message = { kind: "error", text: this.formatError(error) };
    }
    this.render();
  }

  private async applyReceivedSummary(received: ReceivedCharacterSummary): Promise<void> {
    const encounter = this.selectedEncounterId ? this.snapshot?.campaign.encounters[this.selectedEncounterId] : null;
    const combatant = encounter?.combatants.find((entry) => entry.kind === "player" && entry.taleSpireClientId === received.clientId);
    if (!encounter || !combatant || !this.snapshot) { this.render(); return; }
    await this.execute(() => this.application.updateConnectedPlayer({
      encounterId: encounter.id,
      combatantId: combatant.id,
      summary: received.summary,
      expectedEncounterRevision: encounter.revision,
      expectedCampaignChecksum: this.snapshot!.checksum,
    }), `Estadísticas de ${received.summary.name} actualizadas.`);
  }

  private async applyReceivedInitiative(clientId: string, initiative: number): Promise<void> {
    const encounter = this.selectedEncounterId ? this.snapshot?.campaign.encounters[this.selectedEncounterId] : null;
    const combatant = encounter?.combatants.find((entry) => entry.kind === "player" && entry.taleSpireClientId === clientId);
    if (encounter && combatant) await this.apply({ kind: "set-initiative", combatantId: combatant.id, initiative });
  }

  private async rollCombatantInitiative(combatantId: string): Promise<void> {
    const encounter = this.requireEncounter();
    const combatant = encounter.combatants.find((entry) => entry.id === combatantId);
    if (!combatant) return;
    const monster = combatant.kind === "monster" ? this.findMonster(combatant.monsterDefinitionId) : null;
    const character = combatant.kind === "player" && combatant.characterId
      ? this.requireSnapshot().campaign.characters[combatant.characterId] ?? null
      : null;
    const modifier = monster?.initiativeModifier ?? (character ? projectCharacterStatistics(character).initiativeModifier : 0);
    try {
      const result = await this.runtime.diceRoller.roll({
        name: `Iniciativa: ${combatant.name}`,
        expressions: [`1d20${modifier >= 0 ? "+" : ""}${modifier}`],
        mode: monster?.initiativeAdvantage ? "advantage" : "normal",
      });
      const initiative = result.totals[0];
      this.appendActionLog(`Iniciativa de ${combatant.name}: ${result.summary}`, "roll");
      if (initiative !== undefined) await this.apply({ kind: "set-initiative", combatantId, initiative });
    } catch (error) {
      this.message = { kind: "error", text: this.formatError(error) };
      this.render();
    }
  }

  private async addCondition(combatantId: string, card: HTMLElement): Promise<void> {
    const select = card.querySelector<HTMLSelectElement>('[data-action="condition-select"]');
    const definition = GM_CONDITIONS.find(([key]) => key === select?.value);
    if (!definition) return;
    const encounter = this.requireEncounter();
    await this.execute(() => this.application.addCondition({
      encounterId: encounter.id,
      combatantId,
      key: definition[0],
      label: definition[1],
      expectedEncounterRevision: encounter.revision,
      expectedCampaignChecksum: this.requireSnapshot().checksum,
    }));
  }

  private requireSnapshot(): CampaignSnapshot {
    if (!this.snapshot) throw new Error("CAMPAIGN_NOT_FOUND");
    return this.snapshot;
  }

  private requireEncounter(): Encounter {
    const encounter = this.selectedEncounterId ? this.requireSnapshot().campaign.encounters[this.selectedEncounterId] : null;
    if (!encounter) throw new Error("ENCOUNTER_NOT_FOUND");
    return encounter;
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
