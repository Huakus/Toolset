import type { CampaignSnapshot } from "../application/ports/campaign-repository";
import type { SpellDefinition } from "../domain/character/character-spell-model";
import type { EquipmentCatalogDraft } from "../domain/equipment/equipment-catalog";
import { normalizeEquipmentDefinition } from "../domain/equipment/equipment-catalog";
import type { GmChecklistItem, GmShop } from "../domain/gm/gm-global-content";
import { removeGmNoteGroup, type GmWorkspace } from "../domain/gm/gm-workspace";
import type { GlobalCustomContent } from "../infrastructure/talespire/talespire-global-content";
import { createRandomId } from "../shared/id";

export type GmSection = "encounter" | "content" | "notes" | "tools";
export type GmContentSection = "spell" | "equipment" | "shop";
export type GmToolSection = "checklist" | "tables" | "travel" | "npc" | "reference" | "docs";

export interface GmToolsRuntime {
  loadGmContent?: () => Promise<GlobalCustomContent>;
  saveCustomSpell?: (definition: SpellDefinition, previousKey: string | null) => Promise<void>;
  deleteCustomSpell?: (key: string) => Promise<void>;
  saveCustomEquipment?: (definition: EquipmentCatalogDraft, previousKey: string | null) => Promise<void>;
  deleteCustomEquipment?: (key: string) => Promise<void>;
  saveShop?: (shop: GmShop, previousKey: string | null) => Promise<void>;
  deleteShop?: (key: string) => Promise<void>;
  saveChecklistItem?: (item: GmChecklistItem) => Promise<void>;
  deleteChecklistItem?: (key: string) => Promise<void>;
  saveGmWorkspace?: (workspace: GmWorkspace, expectedChecksum: string) => Promise<CampaignSnapshot>;
}

type Message = { kind: "success" | "error"; text: string };

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function number(value: FormDataEntryValue | null, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class GmToolsPanel {
  private content: GlobalCustomContent = { spells: [], equipment: [], monsters: [], shops: [], checklist: [] };
  private selectedSpell = "";
  private selectedEquipment = "";
  private selectedShop = "";
  private activeTool: GmToolSection = "checklist";
  private editingContent: GmContentSection | null = null;
  private contentSearch: Record<GmContentSection, string> = { spell: "", equipment: "", shop: "" };
  private contentFilters: Record<GmContentSection, Set<string>> = { spell: new Set(), equipment: new Set(), shop: new Set() };
  private showContentDescriptions = true;

  constructor(
    private readonly root: HTMLElement,
    private readonly runtime: GmToolsRuntime,
    private readonly updateSnapshot: (snapshot: CampaignSnapshot, label?: string) => void,
    private readonly setMessage: (message: Message) => void,
    private readonly rerender: () => void,
    private readonly recordAction: (label: string, kind?: "action" | "roll" | "system") => void = () => undefined,
  ) {}

  async load(): Promise<void> {
    if (!this.runtime.loadGmContent) return;
    this.content = await this.runtime.loadGmContent();
    this.selectedSpell = this.content.spells[0]?.name ?? "";
    this.selectedEquipment = this.content.equipment[0]?.name ?? "";
    this.selectedShop = this.content.shops[0]?.name ?? "";
  }

  contentCount(section: GmContentSection): number {
    return section === "spell" ? this.content.spells.length : section === "equipment" ? this.content.equipment.length : this.content.shops.length;
  }

  render(section: GmSection, workspace: GmWorkspace, contentSection: GmContentSection = "spell"): string {
    if (section === "content") return this.renderContent(contentSection);
    if (section === "notes") return this.renderNotes(workspace);
    if (section === "tools") return this.renderTools(workspace);
    return "";
  }

  bind(section: GmSection, workspace: GmWorkspace, checksum: string): void {
    if (section === "content") this.bindContent();
    if (section === "notes") this.bindNotes(workspace, checksum);
    if (section === "tools") this.bindTools(workspace, checksum);
  }

  private renderContent(section: GmContentSection): string {
    const spell = this.content.spells.find((entry) => entry.name === this.selectedSpell) ?? null;
    const equipment = this.content.equipment.find((entry) => entry.name === this.selectedEquipment) ?? null;
    const shop = this.content.shops.find((entry) => entry.name === this.selectedShop) ?? null;
    const editing = this.editingContent === section;
    if (editing) {
      const form = section === "spell" ? this.renderSpellForm(spell) : section === "equipment" ? this.renderEquipmentForm(equipment) : this.renderShopForm(shop);
      return `<section class="gm-editor-surface"><div class="gm-edit-heading"><strong>${spell?.name ?? equipment?.name ?? shop?.name ?? (section === "spell" ? "Nuevo conjuro" : section === "equipment" ? "Nuevo objeto" : "Nueva tienda")}</strong><button type="button" data-gm-cancel-edit>Volver</button></div>${form}</section>`;
    }
    const cards = section === "spell"
      ? this.content.spells.filter((entry) => this.matchesSpellFilters(entry)).map((entry) => this.renderSpellCard(entry)).join("")
      : section === "equipment"
        ? this.content.equipment.filter((entry) => this.matchesEquipmentFilters(entry)).map((entry) => this.renderEquipmentCard(entry)).join("")
        : this.content.shops.filter((entry) => this.matchesShopFilters(entry)).map((entry) => this.renderShopCard(entry)).join("");
    const label = section === "spell" ? "conjuro" : section === "equipment" ? "objeto" : "tienda";
    return `<section class="gm-content-catalog">${this.renderContentDiscovery(section, label)}${this.renderContentFilterBar(section)}<div class="gm-catalog-grid">${cards}</div><div class="sheet-empty gm-content-empty" ${cards ? "hidden" : ""}><strong>Sin resultados</strong><p>No hay ${label}s que coincidan con los filtros.</p></div></section>`;
  }

  private renderContentDiscovery(section: GmContentSection, label: string): string {
    return `<div class="spell-search-row gm-content-search-row"><label class="spell-search"><span>Buscar</span><input data-gm-content-search="${section}" type="search" value="${escapeHtml(this.contentSearch[section])}" placeholder="Nombre, tipo, propiedad…"></label><button type="button" class="description-toggle" data-gm-toggle-descriptions>${this.showContentDescriptions ? "Ocultar descripciones" : "Mostrar descripciones"}</button><button type="button" data-gm-new="${section}">+ ${label}</button></div>`;
  }

  private renderContentFilterBar(section: GmContentSection): string {
    const values = section === "spell"
      ? [...new Set(this.content.spells.flatMap((spell) => [`nivel:${spell.level}`, spell.school ? `escuela:${spell.school}` : "", spell.ritual ? "ritual" : "", spell.concentration ? "concentración" : ""]).filter(Boolean))]
      : section === "equipment"
        ? [...new Set(this.content.equipment.flatMap((item) => [`categoría:${item.category}`, item.weapon ? "arma" : "", item.armor ? "armadura" : "", item.consumable ? "consumible" : "", item.requiresAttunement ? "sintonización" : ""]).filter(Boolean))]
        : [...new Set(this.content.shops.flatMap((entry) => Object.keys(entry.categories).map((category) => `categoría:${category}`)))];
    const active = this.contentFilters[section];
    return `<nav class="filter-bar property-filter gm-content-filter-bar"><button type="button" data-gm-clear-content-filters="${section}" class="${active.size ? "" : "active"}">Sin filtros</button>${values.sort((a, b) => a.localeCompare(b, "es")).map((value) => `<button type="button" data-gm-content-filter="${escapeHtml(value)}" data-gm-filter-section="${section}" class="${active.has(value) ? "active" : ""}">${escapeHtml(value.includes(":") ? value.slice(value.indexOf(":") + 1) : value)}</button>`).join("")}</nav>`;
  }

  private matchesSpellFilters(spell: SpellDefinition): boolean {
    return [...this.contentFilters.spell].every((filter) => filter === `nivel:${spell.level}` || filter === `escuela:${spell.school}` || filter === "ritual" && spell.ritual || filter === "concentración" && spell.concentration);
  }

  private matchesEquipmentFilters(item: EquipmentCatalogDraft): boolean {
    return [...this.contentFilters.equipment].every((filter) => filter === `categoría:${item.category}` || filter === "arma" && item.weapon !== null || filter === "armadura" && item.armor !== null || filter === "consumible" && item.consumable || filter === "sintonización" && item.requiresAttunement);
  }

  private matchesShopFilters(shop: GmShop): boolean {
    return [...this.contentFilters.shop].every((filter) => filter.startsWith("categoría:") && Object.hasOwn(shop.categories, filter.slice("categoría:".length)));
  }

  private renderSpellCard(spell: SpellDefinition): string {
    const search = [spell.name, spell.school, spell.description, spell.damageType, spell.classes].join(" ").toLocaleLowerCase();
    return `<article class="play-card spell-play-card gm-catalog-card" data-gm-content-card data-search="${escapeHtml(search)}"><header class="spell-play-header"><div class="spell-title"><div class="spell-meta-line"><span class="school-badge">${escapeHtml(spell.school || "Sin escuela")}</span><span class="action-kind-label">Nivel ${spell.level}</span></div><div class="spell-name-line"><h3>${escapeHtml(spell.name)}</h3></div></div><div class="card-buttons"><button type="button" data-gm-edit="spell" data-gm-content-key="${escapeHtml(spell.name)}">Editar</button><button type="button" data-gm-delete="spell" data-gm-content-key="${escapeHtml(spell.name)}">Eliminar</button></div></header><div class="gm-card-facts"><span>${escapeHtml(spell.castingTime || "—")}</span><span>${escapeHtml(spell.range || "—")}</span><span>${escapeHtml(spell.duration || "—")}</span>${spell.ritual ? "<span>Ritual</span>" : ""}${spell.concentration ? "<span>Concentración</span>" : ""}</div>${this.showContentDescriptions ? `<p class="card-description">${escapeHtml(spell.description || "Sin descripción.")}</p>` : ""}</article>`;
  }

  private renderEquipmentCard(item: EquipmentCatalogDraft): string {
    const search = [item.name, item.category, item.description, ...item.properties].join(" ").toLocaleLowerCase();
    return `<article class="inventory-row gm-catalog-card" data-gm-content-card data-search="${escapeHtml(search)}"><header class="inventory-row-header"><div class="inventory-row-main"><strong>${escapeHtml(item.name)}</strong><span class="inventory-category">${escapeHtml(item.category)}</span></div><div class="card-buttons"><button type="button" data-gm-edit="equipment" data-gm-content-key="${escapeHtml(item.name)}">Editar</button><button type="button" data-gm-delete="equipment" data-gm-content-key="${escapeHtml(item.name)}">Eliminar</button></div></header><div class="inventory-row-stats"><span>${item.unitWeight} lb</span><span>${item.cost.quantity} ${escapeHtml(item.cost.unit)}</span>${item.weapon ? `<span>${escapeHtml(item.weapon.damageExpression)} ${escapeHtml(item.weapon.damageType)}</span>` : ""}${item.consumable ? "<span>Consumible</span>" : ""}</div>${this.showContentDescriptions ? `<p class="card-description">${escapeHtml(item.description || "Sin descripción.")}</p>` : ""}</article>`;
  }

  private renderShopCard(shop: GmShop): string {
    const items = Object.values(shop.categories).flat();
    const search = [shop.name, ...Object.keys(shop.categories), ...items].join(" ").toLocaleLowerCase();
    return `<article class="play-card gm-catalog-card gm-shop-card" data-gm-content-card data-search="${escapeHtml(search)}"><header><div><span class="card-kicker">${Object.keys(shop.categories).length} categorías · ${items.length} objetos</span><h3>${escapeHtml(shop.name)}</h3></div><div class="card-buttons"><button type="button" data-gm-edit="shop" data-gm-content-key="${escapeHtml(shop.name)}">Editar</button><button type="button" data-gm-delete="shop" data-gm-content-key="${escapeHtml(shop.name)}">Eliminar</button></div></header><div class="gm-shop-category-tags">${Object.keys(shop.categories).map((category) => `<span>${escapeHtml(category)}</span>`).join("")}</div>${this.showContentDescriptions ? `<p class="card-description">${escapeHtml(items.slice(0, 8).join(" · ") || "Sin objetos")}${items.length > 8 ? "…" : ""}</p>` : ""}</article>`;
  }

  private renderSpellView(spell: SpellDefinition): string {
    const flags = [spell.ritual ? "Ritual" : "", spell.concentration ? "Concentración" : "", spell.attackType === "attack" ? "Ataque" : spell.attackType === "save" ? "Salvación" : ""].filter(Boolean);
    return `<article class="gm-content-view"><div class="gm-content-facts"><span>Nivel <strong>${spell.level}</strong></span><span>${escapeHtml(spell.school || "Sin escuela")}</span><span>${escapeHtml(spell.castingTime || "—")}</span><span>${escapeHtml(spell.range || "—")}</span><span>${escapeHtml(spell.duration || "—")}</span></div>${flags.length ? `<p class="gm-content-tags">${flags.join(" · ")}</p>` : ""}${spell.damageExpression ? `<p><b>Daño:</b> ${escapeHtml(spell.damageExpression)} ${escapeHtml(spell.damageType)}</p>` : ""}<p>${escapeHtml(spell.description || "Sin descripción.")}</p>${spell.higherLevels ? `<p><b>A niveles superiores:</b> ${escapeHtml(spell.higherLevels)}</p>` : ""}</article>`;
  }

  private renderEquipmentView(item: EquipmentCatalogDraft): string {
    return `<article class="gm-content-view"><div class="gm-content-facts"><span>${escapeHtml(item.category)}</span><span>Peso <strong>${item.unitWeight}</strong></span><span>Costo <strong>${item.cost.quantity} ${escapeHtml(item.cost.unit)}</strong></span>${item.consumable ? "<span>Consumible</span>" : ""}${item.requiresAttunement ? "<span>Sintonización</span>" : ""}</div>${item.weapon ? `<p><b>Daño:</b> ${escapeHtml(item.weapon.damageExpression)} ${escapeHtml(item.weapon.damageType)}</p>` : ""}${item.properties.length ? `<p><b>Propiedades:</b> ${escapeHtml(item.properties.join(", "))}</p>` : ""}<p>${escapeHtml(item.description || "Sin descripción.")}</p></article>`;
  }

  private renderShopView(shop: GmShop): string {
    return `<div class="gm-shop-view">${Object.entries(shop.categories).length ? Object.entries(shop.categories).map(([category, items]) => `<section><strong>${escapeHtml(category)}</strong><div>${items.map((item) => `<span>${escapeHtml(item)}</span>`).join("") || "<small>Sin objetos</small>"}</div></section>`).join("") : "<p>La tienda no tiene categorías.</p>"}</div>`;
  }

  private renderSpellForm(spell: SpellDefinition | null): string {
    return `<form data-gm-form="spell" class="gm-editor-form">
      <input type="hidden" name="previousKey" value="${escapeHtml(spell?.name ?? "")}">
      <div class="gm-form-grid"><label>Nombre<input name="name" required value="${escapeHtml(spell?.name ?? "")}"></label><label>Nivel<input name="level" type="number" min="0" max="9" step="1" value="${spell?.level ?? 0}"></label><label>Escuela<input name="school" value="${escapeHtml(spell?.school ?? "")}"></label><label>Tiempo<input name="castingTime" value="${escapeHtml(spell?.castingTime ?? "1 acción")}"></label><label>Alcance<input name="range" value="${escapeHtml(spell?.range ?? "")}"></label><label>Duración<input name="duration" value="${escapeHtml(spell?.duration ?? "")}"></label><label>Componentes<input name="components" value="${escapeHtml(spell?.components ?? "")}"></label><label>Clases<input name="classes" value="${escapeHtml(spell?.classes ?? "")}"></label><label>Daño<input name="damageExpression" value="${escapeHtml(spell?.damageExpression ?? "")}" placeholder="2d6"></label><label>Daño al escalar<input name="upcastDamageExpression" value="${escapeHtml(spell?.upcastDamageExpression ?? "")}" placeholder="1d6"></label><label>Tipo de daño<input name="damageType" value="${escapeHtml(spell?.damageType ?? "")}"></label><label>Tipo de ataque<select name="attackType"><option value="none">Ninguno</option><option value="attack" ${spell?.attackType === "attack" ? "selected" : ""}>Ataque</option><option value="save" ${spell?.attackType === "save" ? "selected" : ""}>Salvación</option></select></label></div>
      <div class="gm-check-row"><label><input name="ritual" type="checkbox" ${spell?.ritual ? "checked" : ""}> Ritual</label><label><input name="concentration" type="checkbox" ${spell?.concentration ? "checked" : ""}> Concentración</label></div>
      <label>Descripción<textarea name="description">${escapeHtml(spell?.description ?? "")}</textarea></label><label>A niveles superiores<textarea name="higherLevels">${escapeHtml(spell?.higherLevels ?? "")}</textarea></label><button type="submit">Guardar conjuro</button>
    </form>`;
  }

  private renderEquipmentForm(item: EquipmentCatalogDraft | null): string {
    return `<form data-gm-form="equipment" class="gm-editor-form"><input type="hidden" name="previousKey" value="${escapeHtml(item?.name ?? "")}">
      <div class="gm-form-grid"><label>Nombre<input name="name" required value="${escapeHtml(item?.name ?? "")}"></label><label>Categoría<input name="category" value="${escapeHtml(item?.category ?? "adventuring-gear")}"></label><label>Peso<input name="weight" type="number" min="0" step="0.01" value="${item?.unitWeight ?? 0}"></label><label>Costo<input name="costQuantity" type="number" min="0" step="0.01" value="${item?.cost.quantity ?? 0}"></label><label>Moneda<select name="costUnit">${["cp","sp","ep","gp","pp"].map((unit) => `<option ${item?.cost.unit === unit ? "selected" : ""}>${unit}</option>`).join("")}</select></label><label>Propiedades<input name="properties" value="${escapeHtml(item?.properties.join(", ") ?? "")}"></label><label>Daño<input name="damageExpression" value="${escapeHtml(item?.weapon?.damageExpression ?? "")}"></label><label>Tipo de daño<input name="damageType" value="${escapeHtml(item?.weapon?.damageType ?? "")}"></label></div>
      <div class="gm-check-row"><label><input name="usable" type="checkbox" ${item?.usable ? "checked" : ""}> Usable</label><label><input name="consumable" type="checkbox" ${item?.consumable ? "checked" : ""}> Consumible</label><label><input name="requiresAttunement" type="checkbox" ${item?.requiresAttunement ? "checked" : ""}> Requiere sintonización</label></div>
      <label>Descripción<textarea name="description">${escapeHtml(item?.description ?? "")}</textarea></label><button type="submit">Guardar objeto</button>
    </form>`;
  }

  private renderShopForm(shop: GmShop | null): string {
    const rows = shop ? Object.entries(shop.categories).map(([category, items]) => `${category} | ${items.join(", ")}`).join("\n") : "";
    const count = shop ? Object.values(shop.categories).reduce((sum, entries) => sum + entries.length, 0) : 0;
    return `<form data-gm-form="shop" class="gm-editor-form"><input type="hidden" name="previousKey" value="${escapeHtml(shop?.name ?? "")}"><label>Nombre<input name="name" required value="${escapeHtml(shop?.name ?? "")}"></label><label>Categorías y objetos<textarea name="categories" placeholder="Armas | espada larga, daga\nPociones | poción de curación">${escapeHtml(rows)}</textarea></label><small>${count} objetos. Una categoría por línea; separá categoría y objetos con |.</small><button type="submit">Guardar tienda</button></form>`;
  }

  private renderNotes(workspace: GmWorkspace): string {
    return `<section class="gm-notes"><form data-gm-add="note-group" class="gm-inline-form"><input name="title" required placeholder="Nuevo grupo de notas"><button>Agregar grupo</button></form>${workspace.noteGroups.length ? workspace.noteGroups.map((group) => `<details class="gm-tool-card" open data-note-group="${group.id}"><summary>${escapeHtml(group.title)} <small>${group.notes.length}</small></summary><form data-gm-group="${group.id}" class="gm-group-actions"><input name="title" required value="${escapeHtml(group.title)}"><button>Renombrar</button><button type="button" data-gm-delete-group="${group.id}">Eliminar grupo</button></form><div class="gm-note-grid">${group.notes.map((note) => `<form data-gm-note="${note.id}" class="gm-note-card"><input name="title" required value="${escapeHtml(note.title)}"><textarea name="content">${escapeHtml(note.content)}</textarea><div><button>Guardar</button><button type="button" data-gm-delete-note="${note.id}">Eliminar</button></div></form>`).join("")}<form data-gm-add-note="${group.id}" class="gm-note-card new"><input name="title" required placeholder="Título"><textarea name="content" placeholder="Contenido"></textarea><button>Agregar nota</button></form></div></details>`).join("") : '<div class="sheet-empty"><strong>No hay notas de GM</strong><p>Creá un grupo para organizar la campaña.</p></div>'}</section>`;
  }

  private renderTools(workspace: GmWorkspace): string {
    const docUrl = this.validGoogleDocsUrl(workspace.googleDocsUrl) ? workspace.googleDocsUrl : "";
    const tabs: [GmToolSection, string, string][] = [
      ["checklist", "Checklist", `${this.content.checklist.filter((item) => item.checked).length}/${this.content.checklist.length}`],
      ["tables", "Tablas", String(workspace.randomTables.length)], ["travel", "Viaje y salto", ""],
      ["npc", "PNJ", ""], ["reference", "Referencia", ""], ["docs", "Google Docs", ""],
    ];
    const content = this.activeTool === "checklist"
      ? `<section class="gm-tool-surface"><form data-gm-add="checklist" class="gm-inline-form"><input name="text" required placeholder="Nueva tarea"><button>Agregar</button></form><div class="gm-checklist">${this.content.checklist.map((item) => `<label class="${item.checked ? "done" : ""}"><input type="checkbox" data-gm-check="${escapeHtml(item.id)}" ${item.checked ? "checked" : ""}><span>${escapeHtml(item.text)}</span><button type="button" data-gm-delete-check="${escapeHtml(item.id)}">×</button></label>`).join("")}</div></section>`
      : this.activeTool === "tables"
        ? `<section class="gm-tool-surface"><form data-gm-add="table" class="gm-editor-form gm-create-table"><input name="name" required placeholder="Nombre de la tabla"><textarea name="entries" required placeholder="Una opción por línea"></textarea><button>Crear tabla</button></form><div class="gm-random-tables">${workspace.randomTables.map((table) => `<form data-gm-table="${table.id}" class="gm-table-editor"><input name="name" required value="${escapeHtml(table.name)}"><textarea name="entries">${escapeHtml(table.entries.join("\n"))}</textarea><small>${table.entries.length} resultados</small><button>Guardar</button><button type="button" data-gm-roll-table="${table.id}">Tirar</button><button type="button" data-gm-delete-table="${table.id}">Eliminar</button></form>`).join("")}</div></section>`
        : this.activeTool === "travel"
          ? `<section class="gm-tool-surface"><div class="gm-calculators"><form data-gm-calc="travel"><label>Distancia (km)<input name="distance" type="number" min="0" step="0.1" value="40"></label><label>Velocidad (km/h)<input name="speed" type="number" min="0.1" step="0.1" value="4"></label><label>Horas por día<input name="hours" type="number" min="0.1" step="0.1" value="8"></label><button>Calcular</button><output data-gm-output="travel"></output></form><form data-gm-calc="jump"><label>FUE<input name="strength" type="number" min="1" step="1" value="10"></label><label>Altura (cm)<input name="height" type="number" min="1" step="1" value="175"></label><button>Calcular</button><output data-gm-output="jump"></output></form></div></section>`
          : this.activeTool === "npc"
            ? `<section class="gm-tool-surface"><form data-gm-calc="npc" class="gm-npc-generator"><label>Nombre opcional<input name="name" placeholder="Aleatorio"></label><label>Rol<select name="role"><option value="random">Aleatorio</option><option>Aliado</option><option>Neutral</option><option>Rival</option><option>Villano</option></select></label><button>Generar</button><output data-gm-output="npc"></output></form></section>`
            : this.activeTool === "reference"
              ? `<section class="gm-tool-surface gm-reference"><p><b>Condiciones:</b> Cegado, hechizado, ensordecido, asustado, agarrado, incapacitado, invisible, paralizado, petrificado, envenenado, derribado, apresado, aturdido e inconsciente.</p><p><b>Escuelas:</b> Abjuración, adivinación, conjuración, encantamiento, evocación, ilusión, nigromancia y transmutación.</p><p><b>Concentración:</b> termina al quedar incapacitado, morir o fallar la salvación de CON tras recibir daño.</p></section>`
              : `<section class="gm-tool-surface"><form data-gm-form="google-doc" class="gm-inline-form"><input name="url" type="url" placeholder="https://docs.google.com/document/..." value="${escapeHtml(workspace.googleDocsUrl)}"><button>Guardar</button></form>${docUrl ? `<p class="gm-doc-link"><a href="${escapeHtml(docUrl)}" target="_blank" rel="noreferrer">Abrir documento</a></p><iframe class="gm-doc-frame" src="${escapeHtml(docUrl)}" title="Documento de campaña"></iframe>` : ""}</section>`;
    return `<section class="gm-tools-grid"><nav class="filter-bar gm-subsection-nav" aria-label="Tipo de herramienta">${tabs.map(([key, label, count]) => `<button type="button" data-gm-tool="${key}" class="${this.activeTool === key ? "active" : ""}"><span>${label}</span>${count ? `<strong>${count}</strong>` : ""}</button>`).join("")}</nav>${content}</section>`;
  }

  private bindContent(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-gm-new]").forEach((button) => button.addEventListener("click", () => {
      const section = button.dataset.gmNew as GmContentSection;
      if (section === "spell") this.selectedSpell = "";
      if (section === "equipment") this.selectedEquipment = "";
      if (section === "shop") this.selectedShop = "";
      this.editingContent = section;
      this.rerender();
    }));
    this.root.querySelectorAll<HTMLButtonElement>("[data-gm-edit]").forEach((button) => button.addEventListener("click", () => {
      const section = button.dataset.gmEdit as GmContentSection;
      const key = button.dataset.gmContentKey ?? "";
      if (section === "spell") this.selectedSpell = key;
      if (section === "equipment") this.selectedEquipment = key;
      if (section === "shop") this.selectedShop = key;
      this.editingContent = section;
      this.rerender();
    }));
    this.root.querySelector("[data-gm-cancel-edit]")?.addEventListener("click", () => { this.editingContent = null; this.rerender(); });
    this.root.querySelector<HTMLInputElement>("[data-gm-content-search]")?.addEventListener("input", (event) => {
      const input = event.currentTarget as HTMLInputElement;
      const section = input.dataset.gmContentSearch as GmContentSection;
      this.contentSearch[section] = input.value;
      this.applyContentSearch();
    });
    this.root.querySelector("[data-gm-toggle-descriptions]")?.addEventListener("click", () => { this.showContentDescriptions = !this.showContentDescriptions; this.rerender(); });
    this.root.querySelectorAll<HTMLButtonElement>("[data-gm-content-filter]").forEach((button) => button.addEventListener("click", () => {
      const section = button.dataset.gmFilterSection as GmContentSection;
      const filter = button.dataset.gmContentFilter!;
      if (this.contentFilters[section].has(filter)) this.contentFilters[section].delete(filter); else this.contentFilters[section].add(filter);
      this.rerender();
    }));
    this.root.querySelectorAll<HTMLButtonElement>("[data-gm-clear-content-filters]").forEach((button) => button.addEventListener("click", () => { this.contentFilters[button.dataset.gmClearContentFilters as GmContentSection].clear(); this.rerender(); }));
    this.root.querySelector<HTMLFormElement>('[data-gm-form="spell"]')?.addEventListener("submit", (event) => { event.preventDefault(); void this.saveSpell(new FormData(event.currentTarget as HTMLFormElement)); });
    this.root.querySelector<HTMLFormElement>('[data-gm-form="equipment"]')?.addEventListener("submit", (event) => { event.preventDefault(); void this.saveEquipment(new FormData(event.currentTarget as HTMLFormElement)); });
    this.root.querySelector<HTMLFormElement>('[data-gm-form="shop"]')?.addEventListener("submit", (event) => { event.preventDefault(); void this.saveShop(new FormData(event.currentTarget as HTMLFormElement)); });
    this.root.querySelectorAll<HTMLButtonElement>("[data-gm-delete]").forEach((button) => button.addEventListener("click", () => {
      const section = button.dataset.gmDelete as GmContentSection;
      const key = button.dataset.gmContentKey ?? "";
      if (section === "spell") this.selectedSpell = key;
      if (section === "equipment") this.selectedEquipment = key;
      if (section === "shop") this.selectedShop = key;
      void this.deleteContent(section);
    }));
    this.applyContentSearch();
  }

  private applyContentSearch(): void {
    const input = this.root.querySelector<HTMLInputElement>("[data-gm-content-search]");
    if (!input) return;
    const query = input.value.trim().toLocaleLowerCase();
    let visible = 0;
    this.root.querySelectorAll<HTMLElement>("[data-gm-content-card]").forEach((card) => {
      const matches = !query || (card.dataset.search ?? "").includes(query);
      card.hidden = !matches;
      if (matches) visible += 1;
    });
    const empty = this.root.querySelector<HTMLElement>(".gm-content-empty");
    if (empty) empty.hidden = visible > 0;
  }

  private bindNotes(workspace: GmWorkspace, checksum: string): void {
    this.root.querySelector<HTMLFormElement>('[data-gm-add="note-group"]')?.addEventListener("submit", (event) => { event.preventDefault(); void (async () => { const title = String(new FormData(event.currentTarget as HTMLFormElement).get("title") ?? "").trim(); if (title) await this.saveWorkspace({ ...workspace, noteGroups: [...workspace.noteGroups, { id: await createRandomId("gmg"), title, notes: [] }] }, checksum, "Grupo agregado."); })(); });
    this.root.querySelectorAll<HTMLFormElement>("[data-gm-add-note]").forEach((form) => form.addEventListener("submit", (event) => { event.preventDefault(); void (async () => { const data = new FormData(form); const title = String(data.get("title") ?? "").trim(); const groupId = form.dataset.gmAddNote!; if (!title) return; const note = { id: await createRandomId("gmn"), title, content: String(data.get("content") ?? "") }; await this.saveWorkspace({ ...workspace, noteGroups: workspace.noteGroups.map((group) => group.id === groupId ? { ...group, notes: [...group.notes, note] } : group) }, checksum, "Nota agregada."); })(); }));
    this.root.querySelectorAll<HTMLFormElement>("[data-gm-note]").forEach((form) => form.addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(form); const noteId = form.dataset.gmNote!; const updated = { ...workspace, noteGroups: workspace.noteGroups.map((group) => ({ ...group, notes: group.notes.map((note) => note.id === noteId ? { ...note, title: String(data.get("title") ?? "").trim(), content: String(data.get("content") ?? "") } : note) })) }; void this.saveWorkspace(updated, checksum, "Nota guardada."); }));
    this.root.querySelectorAll<HTMLFormElement>("[data-gm-group]").forEach((form) => form.addEventListener("submit", (event) => { event.preventDefault(); const title = String(new FormData(form).get("title") ?? "").trim(); if (title) void this.saveWorkspace({ ...workspace, noteGroups: workspace.noteGroups.map((group) => group.id === form.dataset.gmGroup ? { ...group, title } : group) }, checksum, "Grupo renombrado."); }));
    this.root.querySelectorAll<HTMLButtonElement>("[data-gm-delete-note]").forEach((button) => button.addEventListener("click", () => { const id = button.dataset.gmDeleteNote!; void this.saveWorkspace({ ...workspace, noteGroups: workspace.noteGroups.map((group) => ({ ...group, notes: group.notes.filter((note) => note.id !== id) })) }, checksum, "Nota eliminada."); }));
    this.root.querySelectorAll<HTMLButtonElement>("[data-gm-delete-group]").forEach((button) => button.addEventListener("click", (event) => {
      event.preventDefault(); event.stopPropagation();
      const id = button.dataset.gmDeleteGroup!;
      if (globalThis.confirm && !globalThis.confirm("¿Eliminar el grupo y todas sus notas?")) return;
      button.disabled = true;
      void this.saveWorkspace(removeGmNoteGroup(workspace, id), checksum, "Grupo eliminado.");
    }));
  }

  private bindTools(workspace: GmWorkspace, checksum: string): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-gm-tool]").forEach((button) => button.addEventListener("click", () => { this.activeTool = button.dataset.gmTool as GmToolSection; this.rerender(); }));
    this.root.querySelector<HTMLFormElement>('[data-gm-add="checklist"]')?.addEventListener("submit", (event) => { event.preventDefault(); void (async () => { const text = String(new FormData(event.currentTarget as HTMLFormElement).get("text") ?? "").trim(); if (!text || !this.runtime.saveChecklistItem) return; const item = { id: await createRandomId("chk"), text, checked: false }; await this.runtime.saveChecklistItem(item); this.content.checklist.push(item); this.recordAction(`Agregar tarea: ${text}`); this.success("Tarea agregada."); })(); });
    this.root.querySelectorAll<HTMLInputElement>("[data-gm-check]").forEach((input) => input.addEventListener("change", () => { const item = this.content.checklist.find((entry) => entry.id === input.dataset.gmCheck); if (item && this.runtime.saveChecklistItem) void this.runtime.saveChecklistItem({ ...item, checked: input.checked }).then(() => { item.checked = input.checked; this.recordAction(`${input.checked ? "Completar" : "Reabrir"} tarea: ${item.text}`); this.rerender(); }).catch((error) => this.failure(error)); }));
    this.root.querySelectorAll<HTMLButtonElement>("[data-gm-delete-check]").forEach((button) => button.addEventListener("click", () => { const id = button.dataset.gmDeleteCheck!; const item = this.content.checklist.find((entry) => entry.id === id); if (this.runtime.deleteChecklistItem) void this.runtime.deleteChecklistItem(id).then(() => { this.content.checklist = this.content.checklist.filter((entry) => entry.id !== id); this.recordAction(`Eliminar tarea: ${item?.text ?? id}`); this.success("Tarea eliminada."); }).catch((error) => this.failure(error)); }));
    this.root.querySelector<HTMLFormElement>('[data-gm-add="table"]')?.addEventListener("submit", (event) => { event.preventDefault(); void (async () => { const data = new FormData(event.currentTarget as HTMLFormElement); const name = String(data.get("name") ?? "").trim(); const entries = String(data.get("entries") ?? "").split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean); if (!name || !entries.length) return; await this.saveWorkspace({ ...workspace, randomTables: [...workspace.randomTables, { id: await createRandomId("gmt"), name, entries }] }, checksum, "Tabla creada."); })(); });
    this.root.querySelectorAll<HTMLButtonElement>("[data-gm-roll-table]").forEach((button) => button.addEventListener("click", () => { const table = workspace.randomTables.find((entry) => entry.id === button.dataset.gmRollTable); if (table?.entries.length) { const result = `${table.name}: ${table.entries[Math.floor(Math.random() * table.entries.length)]}`; this.recordAction(result, "roll"); this.success(result); } }));
    this.root.querySelectorAll<HTMLFormElement>("[data-gm-table]").forEach((form) => form.addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(form); const name = String(data.get("name") ?? "").trim(); const entries = String(data.get("entries") ?? "").split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean); if (name && entries.length) void this.saveWorkspace({ ...workspace, randomTables: workspace.randomTables.map((table) => table.id === form.dataset.gmTable ? { ...table, name, entries } : table) }, checksum, "Tabla guardada."); }));
    this.root.querySelectorAll<HTMLButtonElement>("[data-gm-delete-table]").forEach((button) => button.addEventListener("click", () => void this.saveWorkspace({ ...workspace, randomTables: workspace.randomTables.filter((entry) => entry.id !== button.dataset.gmDeleteTable) }, checksum, "Tabla eliminada.")));
    this.root.querySelector<HTMLFormElement>('[data-gm-form="google-doc"]')?.addEventListener("submit", (event) => { event.preventDefault(); const url = String(new FormData(event.currentTarget as HTMLFormElement).get("url") ?? "").trim(); if (url && !this.validGoogleDocsUrl(url)) { this.failure(new Error("La URL debe pertenecer a docs.google.com.")); return; } void this.saveWorkspace({ ...workspace, googleDocsUrl: url }, checksum, "Documento guardado."); });
    this.root.querySelectorAll<HTMLFormElement>("[data-gm-calc]").forEach((form) => form.addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(form); const output = form.querySelector<HTMLOutputElement>("output")!; if (form.dataset.gmCalc === "travel") { const distance = number(data.get("distance")); const speed = number(data.get("speed")); const hours = number(data.get("hours")); output.value = speed > 0 && hours > 0 ? `${(distance / speed).toFixed(1)} h · ${(distance / speed / hours).toFixed(1)} días` : "Valores inválidos"; } else if (form.dataset.gmCalc === "jump") { const strength = number(data.get("strength")); const heightCm = number(data.get("height")); const modifier = Math.floor((strength - 10) / 2); const high = Math.max(0, 3 + modifier); output.value = `Con carrera: largo ${strength} pies · alto ${high} pies · alcance ${Math.floor(high + heightCm / 30.48 * 1.5)} pies. Sin carrera: la mitad.`; } else { const pick = (values: string[]) => values[Math.floor(Math.random() * values.length)]!; const givenName = String(data.get("name") ?? "").trim(); const role = String(data.get("role")) === "random" ? pick(["Aliado", "Neutral", "Rival", "Villano"]) : String(data.get("role")); output.value = `${givenName || pick(["Aldren", "Brina", "Corvin", "Dalia", "Edrik", "Fara"])} · ${role} · ${pick(["mercader", "soldado", "erudito", "artesano", "noble", "viajero"])} · ${pick(["amable pero reservado", "directo y desconfiado", "curioso y parlanchín", "sereno y calculador"])} · busca ${pick(["seguridad", "riqueza", "respuestas", "venganza", "reconocimiento"])}.`; } }));
  }

  private async saveSpell(data: FormData): Promise<void> {
    if (!this.runtime.saveCustomSpell) return;
    const definition: SpellDefinition = { name: String(data.get("name") ?? "").trim(), level: Math.max(0, Math.min(9, Math.trunc(number(data.get("level"))))), description: String(data.get("description") ?? ""), higherLevels: String(data.get("higherLevels") ?? ""), range: String(data.get("range") ?? ""), components: String(data.get("components") ?? ""), material: "", ritual: data.get("ritual") === "on", duration: String(data.get("duration") ?? ""), concentration: data.get("concentration") === "on", castingTime: String(data.get("castingTime") ?? ""), school: String(data.get("school") ?? ""), classes: String(data.get("classes") ?? ""), attackType: String(data.get("attackType")) as SpellDefinition["attackType"], saveAbility: "", damageExpression: String(data.get("damageExpression") ?? ""), upcastDamageExpression: String(data.get("upcastDamageExpression") ?? ""), addAbilityModifier: false, damageType: String(data.get("damageType") ?? ""), year: "2014", legacyData: {} };
    try { await this.runtime.saveCustomSpell(definition, String(data.get("previousKey") ?? "") || null); this.content.spells = [...this.content.spells.filter((entry) => entry.name !== String(data.get("previousKey") ?? "") && entry.name !== definition.name), definition].sort((a, b) => a.name.localeCompare(b.name, "es")); this.selectedSpell = definition.name; this.editingContent = null; this.recordAction(`Guardar conjuro: ${definition.name}`); this.success("Conjuro guardado."); } catch (error) { this.failure(error); }
  }

  private async saveEquipment(data: FormData): Promise<void> {
    if (!this.runtime.saveCustomEquipment) return;
    const base = normalizeEquipmentDefinition({ name: String(data.get("name") ?? "").trim(), weight: number(data.get("weight")), cost: { quantity: number(data.get("costQuantity")), unit: String(data.get("costUnit") ?? "gp") }, equipment_category: { index: String(data.get("category") ?? "adventuring-gear") }, description: String(data.get("description") ?? "") });
    const damageExpression = String(data.get("damageExpression") ?? "");
    const definition: EquipmentCatalogDraft = { ...base, properties: String(data.get("properties") ?? "").split(",").map((entry) => entry.trim()).filter(Boolean), usable: data.get("usable") === "on", consumable: data.get("consumable") === "on", requiresAttunement: data.get("requiresAttunement") === "on", weapon: damageExpression ? { category: "", range: "", normalRange: null, longRange: null, damageExpression, versatileDamageExpression: "", damageType: String(data.get("damageType") ?? ""), attackBonus: 0, damageBonus: 0 } : null };
    try { const previous = String(data.get("previousKey") ?? "") || null; await this.runtime.saveCustomEquipment(definition, previous); this.content.equipment = [...this.content.equipment.filter((entry) => entry.name !== previous && entry.name !== definition.name), definition].sort((a, b) => a.name.localeCompare(b.name, "es")); this.selectedEquipment = definition.name; this.editingContent = null; this.recordAction(`Guardar objeto: ${definition.name}`); this.success("Objeto guardado."); } catch (error) { this.failure(error); }
  }

  private async saveShop(data: FormData): Promise<void> {
    if (!this.runtime.saveShop) return;
    const categories: Record<string, string[]> = {}; for (const row of String(data.get("categories") ?? "").split(/\r?\n/)) { const [category, items = ""] = row.split("|"); const name = category?.trim(); if (name) categories[name] = items.split(",").map((entry) => entry.trim()).filter(Boolean); }
    const shop = { name: String(data.get("name") ?? "").trim(), categories };
    try { const previous = String(data.get("previousKey") ?? "") || null; await this.runtime.saveShop(shop, previous); this.content.shops = [...this.content.shops.filter((entry) => entry.name !== previous && entry.name !== shop.name), shop].sort((a, b) => a.name.localeCompare(b.name, "es")); this.selectedShop = shop.name; this.editingContent = null; this.recordAction(`Guardar tienda: ${shop.name}`); this.success("Tienda guardada."); } catch (error) { this.failure(error); }
  }

  private async deleteContent(kind: string): Promise<void> {
    try {
      if (kind === "spell" && this.selectedSpell && this.runtime.deleteCustomSpell) { await this.runtime.deleteCustomSpell(this.selectedSpell); this.content.spells = this.content.spells.filter((entry) => entry.name !== this.selectedSpell); this.selectedSpell = this.content.spells[0]?.name ?? ""; }
      if (kind === "equipment" && this.selectedEquipment && this.runtime.deleteCustomEquipment) { await this.runtime.deleteCustomEquipment(this.selectedEquipment); this.content.equipment = this.content.equipment.filter((entry) => entry.name !== this.selectedEquipment); this.selectedEquipment = this.content.equipment[0]?.name ?? ""; }
      if (kind === "shop" && this.selectedShop && this.runtime.deleteShop) { await this.runtime.deleteShop(this.selectedShop); this.content.shops = this.content.shops.filter((entry) => entry.name !== this.selectedShop); this.selectedShop = this.content.shops[0]?.name ?? ""; }
      this.recordAction(`Eliminar contenido: ${kind}`);
      this.success("Contenido eliminado.");
    } catch (error) { this.failure(error); }
  }

  private async saveWorkspace(workspace: GmWorkspace, checksum: string, message: string): Promise<void> { if (!this.runtime.saveGmWorkspace) return; try { this.updateSnapshot(await this.runtime.saveGmWorkspace(workspace, checksum), message.replace(/\.$/, "")); this.success(message); } catch (error) { this.failure(error); } }
  private validGoogleDocsUrl(value: string): boolean { try { return new URL(value).hostname === "docs.google.com"; } catch { return false; } }
  private success(text: string): void { this.setMessage({ kind: "success", text }); this.rerender(); }
  private failure(error: unknown): void { this.setMessage({ kind: "error", text: error instanceof Error ? error.message : String(error) }); this.rerender(); }
}
