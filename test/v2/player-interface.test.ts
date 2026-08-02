import { describe, expect, it } from "vitest";
import { CampaignApplication } from "../../src/application/campaign/campaign-application";
import { createCharacter } from "../../src/domain/character/create-character";
import type { CharacterSpellV2, SpellDefinition } from "../../src/domain/character/character-spell-model";
import { normalizeEquipmentDefinition } from "../../src/domain/equipment/equipment-catalog";
import type { CampaignSnapshot } from "../../src/application/ports/campaign-repository";
import { InMemoryCampaignRepository } from "../../src/infrastructure/persistence/in-memory-campaign-repository";
import { BrowserApp, inspiredRollMode, isValidHitPointAmount, type BrowserAppRuntime } from "../../src/ui/browser-app";
import type { TaleSpireTransportDiagnostics } from "../../src/infrastructure/talespire/talespire-player-collaboration";

interface BrowserAppViewHarness {
  sheetMode: "play" | "edit";
  activeSheetTab: "summary" | "actions" | "spells" | "inventory" | "extras";
  customSpells: SpellDefinition[];
  customEquipment: ReturnType<typeof normalizeEquipmentDefinition>[];
  includeUnknownSpells: boolean;
  spellPropertyFilters: Set<string>;
  spellSearch: string;
  showSpellDescriptions: boolean;
  expandedSpellDescriptions: Set<string>;
  inventoryFilters: Set<string>;
  inventorySearch: string;
  includeUnownedInventory: boolean;
  showInventoryDescriptions: boolean;
  armedInspirationCharacterIds: Set<string>;
  combatExecutions: Map<string, Set<"attack" | "damage">>;
  combatExecutionDamage: Map<string, string>;
  snapshot: CampaignSnapshot | null;
  selectedCharacterId: string | null;
  undoStacks: Map<string, unknown[]>;
  redoStacks: Map<string, unknown[]>;
  actionLogs: Map<string, { id: number; label: string; occurredAt: string; kind: "action" }[]>;
  transportDiagnostics: TaleSpireTransportDiagnostics | null;
  renderCharacterForm(character: ReturnType<typeof createCharacter>): string;
}

function spell(id: string, name: string, prepared: boolean, definition: SpellDefinition | null = null, level = definition?.level ?? 1): CharacterSpellV2 {
  return {
    id,
    order: 0,
    name,
    level,
    prepared,
    source: definition ? "custom" : "legacy-unresolved",
    definition,
    effect: { description: "", active: false },
  };
}

const ritualDefinition: SpellDefinition = {
  name: "Omega ritual",
  level: 1,
  description: "Una prueba ritual.",
  higherLevels: "",
  range: "30 pies",
  components: "V, S",
  material: "",
  ritual: true,
  duration: "10 minutos",
  concentration: false,
  castingTime: "1 acción",
  school: "Adivinación",
  classes: "Mago",
  attackType: "none",
  saveAbility: "",
  damageExpression: "",
  upcastDamageExpression: "",
  addAbilityModifier: false,
  damageType: "",
  year: "2014",
  legacyData: {},
};

function harness(runtime: Partial<BrowserAppRuntime> = {}): BrowserAppViewHarness {
  const app = new BrowserApp(
    {} as HTMLElement,
    new CampaignApplication(new InMemoryCampaignRepository()),
    {
      storageLabel: "test",
      diceRoller: {
        roll: async () => ({ kind: "rolled", summary: "ok", totals: [10] }),
      },
      ...runtime,
    },
  );
  return app as unknown as BrowserAppViewHarness;
}

describe("player interface shell", () => {
  it("starts as a compact play sheet with stable section navigation", () => {
    const view = harness();
    const character = createCharacter(
      "chr_11111111111111111111111111111111",
      "Hero",
      "2026-07-26T00:00:00.000Z",
    );
    const html = view.renderCharacterForm(character);

    expect(html).toContain('data-sheet-mode="play"');
    expect(html).toContain('id="character-title-select"');
    expect(html).toContain('id="character-color"');
    expect(html).toContain('<details class="color-picker"><summary title="Cambiar color del personaje"><span>Color</span>');
    expect(html).toContain('data-character-color-value="#6f96c4"');
    expect(html).toContain('id="apply-character-color"');
    expect(html).toContain('aria-label="Color hexadecimal"');
    expect(html).toContain('data-history-action="undo"');
    expect(html).toContain('data-history-action="redo"');
    expect(html).toContain('class="action-log"');
    expect(html).toContain('data-active-sheet-tab="summary"');
    for (const tab of ["summary", "actions", "inventory", "traits", "notes", "extras", "initiative"]) {
      expect(html).toContain(`data-sheet-tab="${tab}"`);
    }
    expect(html).not.toContain('data-sheet-tab="spells"');
    expect(html).toContain('<span>Acciones y conjuros</span>');
    expect(html).toContain('aria-label="Características, habilidades y salvaciones"');
    expect(html).toContain('data-roll-name="Prueba de FUE"');
    expect(html).not.toContain('id="character-form"');
  });

  it("shows TaleSpire transport diagnostics only when collaboration is available", () => {
    const view = harness({
      runSyncTransportProbe: async () => undefined,
      refreshSyncPeers: async () => undefined,
      subscribeTransportDiagnostics: () => () => undefined,
    });
    view.transportDiagnostics = {
      ownClientId: "local",
      peers: [{ id: "remote", label: "Ana", clientMode: "player" }],
      probes: [{
        probeId: "probe_1",
        targetClientId: "remote",
        targetLabel: "Ana",
        requestedCharacters: 480,
        sentCharacters: 480,
        receivedCharacters: 480,
        roundTripMs: 12,
        status: "received",
        error: null,
        startedAt: "2026-07-26T00:00:00.000Z",
      }],
      updatedAt: "2026-07-26T00:00:00.000Z",
    };
    const html = view.renderCharacterForm(createCharacter(
      "chr_12121212121212121212121212121212",
      "Hero",
      "2026-07-26T00:00:00.000Z",
    ));

    expect(html).toContain("Diagnóstico de sincronización");
    expect(html).toContain("Ana");
    expect(html).toContain('id="sync-probe-size"');
    expect(html).toContain('value="480" selected');
    expect(html).toContain('value="500"');
    expect(html).toContain('id="run-sync-probe"');
    expect(html).toContain('data-probe-status="received"');
    expect(html).toContain("480 car. → 480 car.");
    expect(html).toContain("12 ms");
  });

  it("renders compact hit-point controls and the three inspiration states", () => {
    const view = harness();
    const character = createCharacter(
      "chr_88888888888888888888888888888888",
      "Inspired Hero",
      "2026-07-26T00:00:00.000Z",
    );
    character.combat.hitPoints = { current: 12, maximum: 20, temporary: 3 };
    character.currency = { platinum: 0, gold: 0, electrum: 0, silver: 0, copper: 1_199 };
    character.combat.conditions = [{
      id: "cnd_11111111111111111111111111111111",
      key: "poisoned",
      label: "Envenenado",
      level: null,
      addedAt: "2026-07-26T00:00:00.000Z",
    }];

    const inactive = view.renderCharacterForm(character);
    expect(inactive).toContain('<span>PG total</span><strong>15<small> / 20</small>');
    expect(inactive).toContain("12<b> + 3</b><small> / 20</small>");
    expect(inactive).toContain("--hp-level:60%");
    expect(inactive).toContain("--hp-temp-level:15%;--hp-temp-bottom:60%");
    expect(inactive).toContain('role="meter" aria-label="Puntos de golpe"');
    expect(inactive.indexOf('data-resource-action="temporary"')).toBeLessThan(inactive.indexOf('data-resource-action="heal"'));
    expect(inactive.indexOf('data-resource-action="heal"')).toBeLessThan(inactive.indexOf('id="resource-amount"'));
    expect(inactive.indexOf('id="resource-amount"')).toBeLessThan(inactive.indexOf('data-resource-action="damage"'));
    expect(inactive).toContain('class="inspiration-button hero-inspiration inactive"');
    expect(inactive).toContain("<strong>Activar</strong>");
    expect(inactive).toContain('class="hero-hit-points"');
    expect(inactive).toContain('class="header-stat-button hero-initiative roll-button"');
    expect(inactive).toContain("<span>INIC</span>");
    expect(inactive).toContain('class="hero-currency-indicator"');
    expect(inactive).toContain('class="hero-vitals sheet-hero-secondary"');
    expect(inactive).toContain('title="1 PPL, 1 PO, 1 PE, 4 PP, 9 PC"');
    expect(inactive).not.toContain("1199 PC");
    for (const coin of ["platinum", "gold", "electrum", "silver", "copper"]) {
      expect(inactive).toContain(`data-coin-kind="${coin}"`);
    }
    expect(inactive).not.toContain('class="coin-icon"');
    expect(inactive).not.toContain('id="currency-denomination"');
    expect(inactive.indexOf('class="death-save-control"')).toBeLessThan(inactive.indexOf('class="condition-toggle-panel"'));
    expect(inactive.indexOf('class="combat-passive-readouts"')).toBeLessThan(inactive.indexOf('checks-play-section"'));
    expect(inactive.indexOf('class="checks-roll-layout"')).toBeLessThan(inactive.indexOf('class="condition-toggle-panel"'));
    expect(inactive).toContain('<span>Velocidad</span><strong>30 ft</strong>');
    expect(inactive).toContain('<span>Percepción</span><strong>10</strong>');
    expect(inactive.indexOf('class="death-save-meter"')).toBeLessThan(inactive.indexOf('class="death-save-actions"'));
    expect(inactive.indexOf('class="death-save-title"')).toBeLessThan(inactive.indexOf('data-add-death-save="success"'));
    expect(inactive).toContain('class="condition-toggle active" data-toggle-condition="poisoned"');
    expect(inactive.indexOf('data-toggle-condition="poisoned"')).toBeLessThan(inactive.indexOf('data-toggle-condition="blinded"'));
    expect(inactive.indexOf(">Acelerar</button>")).toBeLessThan(inactive.indexOf(">Agarrado</button>"));
    expect(inactive).toContain("Descanso corto");
    expect(inactive).toContain("Descanso largo");
    expect(inactive).toContain('<span>Descanso</span><strong>corto</strong>');
    expect(inactive).toContain('<span>Descanso</span><strong>largo</strong>');
    expect(inactive.indexOf('class="hero-rest-buttons"')).toBeLessThan(inactive.indexOf('class="sheet-tabs"'));
    expect(inactive).not.toContain("Descansos y recursos secundarios");
    expect(inactive).not.toContain("Dados de golpe");
    expect(inactive).not.toContain("Agotamiento");
    expect(inactive).not.toContain("<h2>Monedas</h2>");
    expect(inactive).not.toContain("<h2>Habilidades</h2>");
    expect(inactive).not.toContain("<h2>Salvaciones</h2>");
    for (const ability of ["FUE", "DES", "CON", "INT", "SAB", "CAR"]) expect(inactive).toContain(`Sal. de ${ability}`);
    expect(inactive).not.toContain("Sal. de Fuerza");

    view.activeSheetTab = "inventory";
    const inventory = view.renderCharacterForm(character);
    expect(inventory).not.toContain('class="inventory-currency-panel"');
    expect(inventory).toContain('class="inventory-resource-row"');
    expect(inventory).toContain('class="spell-search-row inventory-search-row"');
    expect(inventory).toContain('<details class="currency-manager">');
    expect(inventory).toContain('<summary class="inventory-utility-button">Monedas</summary>');
    expect(inventory).toContain('data-reset-currency-controls');
    expect(inventory).toContain('data-close-currency-manager');
    for (const coin of ["platinum", "gold", "electrum", "silver", "copper"]) {
      expect(inventory).toContain(`data-currency-control="${coin}"`);
      expect(inventory).toContain(`data-currency-amount="${coin}" type="number" min="0" step="1" value="0"`);
    }
    expect(inventory).toContain('data-currency-batch-target');
    expect(inventory).toContain('data-currency-batch-action="add" disabled>Agregar</button>');
    expect(inventory).toContain('data-currency-batch-action="remove" disabled>Quitar</button>');
    expect(inventory).toContain('data-currency-batch-action="transfer" disabled>Transferir</button>');
    expect(inventory).not.toContain('PPL · Platino');
    expect(inventory).not.toContain('class="currency-readout"');
    expect(inventory).not.toContain('>Cantidad</span>');
    expect(inventory).not.toContain('class="inventory-quick-control object-quick-add"');
    expect(inventory).not.toContain('<select id="quick-inventory-name"');
    expect(inventory).not.toContain('data-quick-add-inventory');
    expect(inventory).not.toContain('<h3>Agregar objeto</h3>');
    expect(inventory).toContain('class="inventory-weight-meter');
    expect(inventory).toContain('role="meter" aria-label="Peso transportado"');
    expect(inventory).toContain('id="inventory-search"');
    expect(inventory).toContain('data-toggle-inventory-descriptions');
    expect(inventory).toContain('data-include-unowned-inventory');
    expect(inventory).not.toContain("CA calculada por equipo");
    expect(inventory).not.toMatch(/<span>CA /);
    expect(inventory).not.toContain('data-currency-direction');
    expect(inventory).not.toContain('data-transfer-currency=');
    expect(inventory.indexOf('id="inventory-search"')).toBeLessThan(inventory.indexOf('data-toggle-inventory-descriptions'));
    expect(inventory.indexOf('data-toggle-inventory-descriptions')).toBeLessThan(inventory.indexOf('class="inventory-resource-row"'));
    expect(inventory.indexOf('class="currency-manager"')).toBeLessThan(inventory.indexOf('class="inventory-attunement-control"'));
    expect(inventory.indexOf('class="inventory-attunement-control"')).toBeLessThan(inventory.indexOf('class="inventory-weight-meter'));
    view.sheetMode = "edit";
    expect(view.renderCharacterForm(character)).toContain('data-currency-control="platinum"');
    view.sheetMode = "play";
    view.activeSheetTab = "summary";

    character.combat.inspiration = true;
    const available = view.renderCharacterForm(character);
    expect(available).toContain('class="inspiration-button hero-inspiration available"');
    expect(available).toContain("<strong>Usar</strong>");

    view.armedInspirationCharacterIds.add(character.id);
    const armed = view.renderCharacterForm(character);
    expect(armed).toContain('class="inspiration-button hero-inspiration armed"');
    expect(armed).toContain("<strong>Desactivar</strong>");
    expect(armed).toContain("Próxima tirada");
    expect(inspiredRollMode("normal")).toBe("advantage");
    expect(inspiredRollMode("advantage")).toBe("advantage");
    expect(inspiredRollMode("disadvantage")).toBe("normal");
    expect(isValidHitPointAmount("1")).toBe(true);
    expect(isValidHitPointAmount("0")).toBe(false);
    expect(isValidHitPointAmount("-2")).toBe(false);
    expect(isValidHitPointAmount("1.5")).toBe(false);
    expect(isValidHitPointAmount("")).toBe(false);

    character.combat.deathSaves = { successes: 2, failures: 1 };
    const deathSaves = view.renderCharacterForm(character);
    expect(deathSaves).toContain('data-add-death-save="success"');
    expect(deathSaves).toContain('data-add-death-save="failure"');
    expect(deathSaves).toContain('data-reset-death-saves');
    expect(deathSaves.match(/death-save-mark success achieved/g)).toHaveLength(2);
    expect(deathSaves.match(/death-save-mark success pending/g)).toHaveLength(1);
    expect(deathSaves.match(/death-save-mark failure achieved/g)).toHaveLength(1);
    expect(deathSaves.match(/death-save-mark failure pending/g)).toHaveLength(2);
    expect(deathSaves).not.toContain("2✓ · 1✕");
  });

  it("shows compact object and currency transfers and keeps history scoped by character", () => {
    const view = harness();
    const source = createCharacter(
      "chr_13131313131313131313131313131313",
      "Origen",
      "2026-07-26T00:00:00.000Z",
    );
    const target = createCharacter(
      "chr_14141414141414141414141414141414",
      "Destino",
      "2026-07-26T00:00:00.000Z",
    );
    source.inventory = [{
      ...normalizeEquipmentDefinition({ name: "Cuerda" }),
      id: "inv_13131313131313131313131313131313",
      order: 0,
      group: "backpack",
      quantity: 2,
      unitWeight: 2,
      description: "Una cuerda resistente para trepar.",
    }];
    view.snapshot = {
      checksum: "checksum",
      campaign: {
        schemaVersion: 2,
        id: "cmp_13131313131313131313131313131313",
        revision: 0,
        characters: { [source.id]: source, [target.id]: target },
        encounters: {},
        gm: { noteGroups: [], randomTables: [], googleDocsUrl: "" },
        legacy: { dmNotes: null, encounterData: null, unmapped: {} },
        metadata: { createdAt: "2026-07-26T00:00:00.000Z", updatedAt: "2026-07-26T00:00:00.000Z", migratedFrom: "native" },
      },
    };
    view.selectedCharacterId = source.id;
    view.activeSheetTab = "inventory";
    view.actionLogs.set(source.id, [{ id: 1, label: "Acción de Origen", occurredAt: "2026-07-26T12:00:00.000Z", kind: "action" }]);
    view.actionLogs.set(target.id, [{ id: 2, label: "Acción de Destino", occurredAt: "2026-07-26T12:01:00.000Z", kind: "action" }]);
    view.undoStacks.set(source.id, [{}]);

    const sourceHtml = view.renderCharacterForm(source);
    expect(sourceHtml).not.toContain('id="inventory-transfer-asset"');
    expect(sourceHtml).toContain('data-currency-control="gold"');
    expect(sourceHtml).toContain('data-currency-amount="gold" type="number" min="0" step="1" value="0"');
    expect(sourceHtml).toContain('data-currency-batch-target');
    expect(sourceHtml).toContain(`value="${target.id}">Destino</option>`);
    expect(sourceHtml).toContain('data-currency-batch-action="transfer" disabled');
    expect(sourceHtml).not.toContain('class="inventory-management-lower"');
    expect(sourceHtml).toContain('class="inventory-attunement-control"');
    expect(sourceHtml).toContain('espacios libres');
    expect(sourceHtml).toContain('class="inventory-weight-composition"');
    expect(sourceHtml).toContain('data-inventory-tone="gear" style="--weight-segment:');
    expect(sourceHtml).toContain('data-item-transfer-target');
    expect(sourceHtml).toContain('data-item-transfer-quantity');
    expect(sourceHtml).toContain('data-transfer-inventory-item disabled');
    expect(sourceHtml).toContain('data-inventory-quantity="-1"');
    expect(sourceHtml).toContain('data-inventory-quantity="1"');
    expect(sourceHtml).toContain('class="inventory-dense-list"');
    expect(sourceHtml).toContain('class="spell-description inventory-description');
    expect(sourceHtml).toContain('data-inventory-tone="gear"');
    expect(sourceHtml).toContain("Una cuerda resistente para trepar.");
    expect(sourceHtml).toContain("Acción de Origen");
    expect(sourceHtml).not.toContain("Acción de Destino");
    expect(sourceHtml).not.toMatch(/data-history-action="undo"[^>]*disabled/);

    view.selectedCharacterId = target.id;
    const targetHtml = view.renderCharacterForm(target);
    expect(targetHtml).toContain("Acción de Destino");
    expect(targetHtml).not.toContain("Acción de Origen");
    expect(targetHtml).toMatch(/data-history-action="undo"[^>]*disabled/);
  });

  it("combines inventory filters with AND and exposes unowned catalog objects as add-only cards", () => {
    const view = harness();
    const character = createCharacter(
      "chr_15151515151515151515151515151515",
      "Catalog Hero",
      "2026-07-26T00:00:00.000Z",
    );
    view.activeSheetTab = "inventory";
    view.customEquipment = [normalizeEquipmentDefinition({
      name: "Elixir de prueba",
      equipment_category: { index: "potion" },
      description: "Recupera vitalidad temporal.",
    })];
    view.includeUnownedInventory = true;
    view.inventorySearch = "elixir";
    view.inventoryFilters = new Set(["consumable", "usable"]);

    const matching = view.renderCharacterForm(character);
    expect(matching).toContain('class="inventory-row  catalog-item inventory-disabled"');
    expect(matching).toContain('data-add-catalog-inventory="Elixir de prueba"');
    expect(matching).toContain("Recupera vitalidad temporal.");
    expect(matching).toContain('data-inventory-tone="consumable"');

    view.inventoryFilters.add("weapon");
    const excludedByAnd = view.renderCharacterForm(character);
    expect(excludedByAnd).not.toContain('data-add-catalog-inventory="Elixir de prueba"');
    expect(excludedByAnd).toContain("No hay objetos con las características seleccionadas");
  });

  it("keeps action and spell resolution rolls disabled until launch", () => {
    const view = harness();
    const character = createCharacter(
      "chr_12121212121212121212121212121212",
      "Combat Hero",
      "2026-07-26T00:00:00.000Z",
    );
    character.actions = [{
      id: "act_12121212121212121212121212121212",
      order: 0,
      name: "Espadazo",
      categories: ["attack"],
      activation: "1 acción",
      reach: "5 ft",
      ability: "strength",
      proficient: true,
      attackBonus: 0,
      damageExpression: "1d8",
      damageBonus: 0,
      damageType: "Cortante",
      weaponType: "Cuerpo a cuerpo",
      properties: "",
      description: "",
      inventoryItemId: null,
      rollMode: "normal",
    }];
    character.spellcasting.spells = [
      spell("spl_12121212121212121212121212121212", "Chispa", true, null, 0),
    ];
    view.activeSheetTab = "actions";
    const executionKey = `action:${character.id}:${character.actions[0]!.id}`;
    const disabled = view.renderCharacterForm(character);
    expect(disabled).toContain('class="play-section collection-play actions-spells-workspace"');
    expect(disabled).toContain('class="play-card spell-play-card action-play-card"');
    expect(disabled).toContain('data-spell-name="Chispa"');
    expect(disabled.indexOf('id="spell-search"')).toBeLessThan(disabled.indexOf('data-action-filter="all"'));
    expect(disabled.indexOf('data-toggle-spell-descriptions')).toBeLessThan(disabled.indexOf('data-action-filter="all"'));
    expect(disabled).toContain('data-arm-combat-action>Lanzar</button>');
    expect(disabled).toMatch(/data-combat-roll="attack"[^>]*disabled>Ataque<\/button>/);
    expect(disabled).toMatch(/data-combat-roll="damage"[^>]*disabled>Daño<\/button>/);

    view.combatExecutions.set(executionKey, new Set(["attack", "damage"]));
    const armed = view.renderCharacterForm(character);
    expect(armed).not.toMatch(/data-combat-roll="attack"[^>]*disabled>Ataque<\/button>/);
    expect(armed).not.toMatch(/data-combat-roll="damage"[^>]*disabled>Daño<\/button>/);
  });

  it("keeps the complete core form in Summary/Edit and collection editors in their tabs", () => {
    const view = harness();
    const character = createCharacter(
      "chr_22222222222222222222222222222222",
      "Editor Hero",
      "2026-07-26T00:00:00.000Z",
    );
    view.sheetMode = "edit";

    const summary = view.renderCharacterForm(character);
    expect(summary).toContain('id="character-form"');
    expect(summary).toContain('name="strength"');
    expect(summary).toContain("Sal. de FUE");
    expect(summary).not.toContain("<strong>Fuerza</strong>");
    expect(summary).not.toContain("<legend>Monedas</legend>");
    expect(summary).not.toContain('name="copper"');
    expect(summary).not.toContain("Agregar acción");

    view.activeSheetTab = "actions";
    const actions = view.renderCharacterForm(character);
    expect(actions).not.toContain('id="character-form"');
    expect(actions).toContain("Agregar acción");
    expect(actions).not.toContain('name="strength"');
  });

  it("does not repeat the active tab title in dense collection views", () => {
    const view = harness();
    const character = createCharacter(
      "chr_77777777777777777777777777777777",
      "Compact Hero",
      "2026-07-26T00:00:00.000Z",
    );
    for (const [tab, title] of [["actions", "Acciones y ataques"], ["spells", "Conjuros"], ["inventory", "Inventario"], ["extras", "Extras, mascotas y formas"]] as const) {
      view.activeSheetTab = tab;
      const play = view.renderCharacterForm(character);
      expect(play).not.toContain(`<h2>${title}</h2>`);
      view.sheetMode = "edit";
      const edit = view.renderCharacterForm(character);
      expect(edit).not.toContain(`<legend>${title}</legend>`);
      view.sheetMode = "play";
    }
  });

  it("renders compact spell controls, prepared-first ordering, slots, search, and ritual availability", () => {
    const view = harness();
    const character = createCharacter(
      "chr_33333333333333333333333333333333",
      "Spell Hero",
      "2026-07-26T00:00:00.000Z",
    );
    character.spellcasting.spells = [
      spell("spl_11111111111111111111111111111111", "Zeta preparado", true),
      spell("spl_22222222222222222222222222222222", "Alpha sin preparar", false),
      spell("spl_33333333333333333333333333333333", "Beta preparado", true),
      spell("spl_44444444444444444444444444444444", "Omega ritual", false, ritualDefinition),
      spell("spl_66666666666666666666666666666666", "Aardvark truco", false, null, 0),
    ];
    character.spellcasting.slots["1"] = { maximum: 3, used: 1 };
    view.activeSheetTab = "spells";

    const html = view.renderCharacterForm(character);
    const betaIndex = html.indexOf("Beta preparado");
    const zetaIndex = html.indexOf("Zeta preparado");
    const alphaIndex = html.indexOf("Alpha sin preparar");
    const ritualIndex = html.indexOf("Omega ritual");
    const cantripIndex = html.indexOf("Aardvark truco");

    expect(cantripIndex).toBeLessThan(betaIndex);
    expect(betaIndex).toBeLessThan(zetaIndex);
    expect(zetaIndex).toBeLessThan(alphaIndex);
    expect(alphaIndex).toBeLessThan(ritualIndex);
    expect(html).toContain('id="spell-search"');
    expect(html).toContain('data-spell-property-filter="ritual"');
    expect(html).not.toContain("spell-combat-readout");
    expect(html).toContain(">5/2</strong>");
    expect(html).toContain('<i class="available">O</i><i class="available">O</i><i class="used">X</i>');

    const alphaCard = html.slice(html.lastIndexOf('<article class="play-card', alphaIndex), html.indexOf("</article>", alphaIndex));
    expect(alphaCard).toContain("spell-disabled");
    expect(alphaCard).toContain('<select data-cast-slot-level size="1">');
    expect(alphaCard).toMatch(/<option value="1"[^>]*disabled/);
    expect(alphaCard).toContain('data-spell-action="prepare"');

    const ritualCard = html.slice(html.lastIndexOf('<article class="play-card', ritualIndex), html.indexOf("</article>", ritualIndex));
    expect(ritualCard).not.toContain("spell-disabled");
    expect(ritualCard).toContain('<option value="1"');
    expect(ritualCard).toMatch(/value="1"[^>]*data-cast-available="false"[^>]*disabled/);
    expect(ritualCard).toMatch(/<option value="ritual"[^>]*data-cast-available="true"[^>]*selected>Ritual · sin espacio<\/option>/);
    expect(ritualCard).toContain('data-spell-cast-control data-spell-action="cast" >Lanzar</button>');
    expect(ritualCard).toContain("1A · 30 pies · 10 minutos");
    expect(ritualCard).toContain('data-school-tone="divination"');
    expect(ritualCard).not.toContain("data-cast-level-readout");
    expect(ritualCard.indexOf("Adivinación")).toBeLessThan(ritualCard.indexOf('data-spell-action="prepare"'));
    expect(ritualCard.indexOf('data-spell-action="prepare"')).toBeLessThan(ritualCard.indexOf("<h3>Omega ritual</h3>"));
    expect(ritualCard).toContain('data-toggle-spell-description aria-expanded="false">Leer más</button>');

    view.expandedSpellDescriptions.add("spl_44444444444444444444444444444444");
    const expandedHtml = view.renderCharacterForm(character);
    expect(expandedHtml).toContain('class="spell-description expanded"');
    expect(expandedHtml).toContain('data-toggle-spell-description aria-expanded="true">Leer menos</button>');

    expect(html.indexOf('id="spell-search"')).toBeLessThan(html.indexOf('data-spell-property-filter="ritual"'));
    expect(html.indexOf('data-spell-property-filter="ritual"')).toBeLessThan(html.indexOf('data-spell-filter="all"'));
    expect(html).toContain("Ocultar descripciones");
    view.showSpellDescriptions = false;
    expect(view.renderCharacterForm(character)).not.toContain('<p class="card-description">');
  });

  it("selects the lowest available valid slot and disables every unavailable cast level", () => {
    const view = harness();
    const character = createCharacter(
      "chr_66666666666666666666666666666666",
      "Upcast Mage",
      "2026-07-26T00:00:00.000Z",
    );
    const levelThreeDefinition = {
      ...ritualDefinition,
      name: "Conjuro de nivel tres",
      level: 3,
      ritual: false,
      school: "Nigromancia",
      attackType: "attack" as const,
      damageExpression: "2d6",
      upcastDamageExpression: "1d6",
      damageType: "Rayo",
    };
    character.spellcasting.spells = [
      spell("spl_77777777777777777777777777777777", levelThreeDefinition.name, true, levelThreeDefinition),
    ];
    character.spellcasting.slots["5"] = { maximum: 1, used: 0 };
    character.spellcasting.slots["6"] = { maximum: 2, used: 1 };
    view.activeSheetTab = "spells";

    const html = view.renderCharacterForm(character);
    const nameIndex = html.indexOf(levelThreeDefinition.name);
    const card = html.slice(html.lastIndexOf('<article class="play-card', nameIndex), html.indexOf("</article>", nameIndex));

    expect(card).toMatch(/<option value="3"[^>]*disabled/);
    expect(card).toMatch(/<option value="4"[^>]*disabled/);
    expect(card).toMatch(/<option value="5"[^>]*selected[^>]*>Nivel 5/);
    expect(card).not.toMatch(/<option value="5"[^>]*disabled/);
    expect(card).not.toMatch(/<option value="6"[^>]*disabled/);
    expect(card).toMatch(/<option value="7"[^>]*disabled/);
    expect(card).toMatch(/<option value="9"[^>]*disabled/);
    expect(card).toContain('data-school-tone="necromancy"');
    expect(card).toContain('data-damage-tone="lightning"');
    expect(card).toContain('data-roll-expression="4d6"');
    expect(card).toContain('<strong data-spell-damage-readout>4d6</strong>');
    expect(card).toMatch(/data-combat-roll="attack"[^>]*disabled>Ataque<\/button>/);
    expect(card).toMatch(/data-combat-roll="damage"[^>]*disabled>Daño<\/button>/);

    const executionKey = `spell:${character.id}:${character.spellcasting.spells[0]!.id}`;
    view.combatExecutions.set(executionKey, new Set(["attack", "damage"]));
    view.combatExecutionDamage.set(executionKey, "4d6");
    const armedHtml = view.renderCharacterForm(character);
    const armedNameIndex = armedHtml.indexOf(levelThreeDefinition.name);
    const armedCard = armedHtml.slice(armedHtml.lastIndexOf('<article class="play-card', armedNameIndex), armedHtml.indexOf("</article>", armedNameIndex));
    expect(armedCard).not.toMatch(/data-combat-roll="attack"[^>]*disabled>Ataque<\/button>/);
    expect(armedCard).not.toMatch(/data-combat-roll="damage"[^>]*disabled>Daño<\/button>/);
    expect(armedCard).toContain('data-roll-expression="4d6"');

    character.spellcasting.slots["5"] = { maximum: 1, used: 1 };
    character.spellcasting.slots["6"] = { maximum: 2, used: 2 };
    const exhaustedHtml = view.renderCharacterForm(character);
    const exhaustedNameIndex = exhaustedHtml.indexOf(levelThreeDefinition.name);
    const exhaustedCard = exhaustedHtml.slice(exhaustedHtml.lastIndexOf('<article class="play-card', exhaustedNameIndex), exhaustedHtml.indexOf("</article>", exhaustedNameIndex));
    expect(exhaustedCard).toContain("spell-disabled");
    expect(exhaustedCard).toContain('<select data-cast-slot-level size="1">');
    expect(exhaustedCard).toContain('data-spell-cast-control data-spell-action="cast" disabled');

    character.spellcasting.slots["5"] = { maximum: 1, used: 0 };
    character.spellcasting.slots["6"] = { maximum: 2, used: 1 };

    view.sheetMode = "edit";
    const editHtml = view.renderCharacterForm(character);
    const editNameIndex = editHtml.indexOf(levelThreeDefinition.name);
    const editCard = editHtml.slice(editHtml.lastIndexOf('<details class="spell-card', editNameIndex), editHtml.indexOf("</details>", editNameIndex));
    expect(editHtml).not.toContain("spell-combat-readout");
    expect(editCard).toMatch(/<option value="3"[^>]*disabled/);
    expect(editCard).toMatch(/<option value="5"[^>]*selected/);
    expect(editCard).toMatch(/<option value="7"[^>]*disabled/);
    expect(editCard).toContain('data-school-tone="necromancy"');
    expect(editCard).toContain('data-damage-tone="lightning"');
  });

  it("combines characteristic filters with AND and shows a clear empty result", () => {
    const view = harness();
    const character = createCharacter(
      "chr_44444444444444444444444444444444",
      "Filtered Mage",
      "2026-07-26T00:00:00.000Z",
    );
    character.spellcasting.spells = [
      spell("spl_55555555555555555555555555555555", "Ritual sin concentración", false, ritualDefinition),
    ];
    view.activeSheetTab = "spells";
    view.spellPropertyFilters.add("ritual");
    view.spellPropertyFilters.add("concentration");

    const filtered = view.renderCharacterForm(character);
    expect(filtered).toContain('data-spell-property-filter="ritual" class="active"');
    expect(filtered).toContain('data-spell-property-filter="concentration" class="active"');
    expect(filtered).toContain("No hay conjuros con las características seleccionadas");

    view.spellPropertyFilters.clear();
    view.spellSearch = "texto que no existe";
    const searched = view.renderCharacterForm(character);
    expect(searched).toContain("No hay conjuros con las características seleccionadas");
    expect(searched).toContain("Limpiar filtros");
  });

  it("includes unknown catalog spells on demand and preserves their favorite state", () => {
    const view = harness();
    const character = createCharacter(
      "chr_55555555555555555555555555555555",
      "Catalog Mage",
      "2026-07-26T00:00:00.000Z",
    );
    const catalogSpell = { ...ritualDefinition, name: "Secreto del catálogo" };
    character.spellcasting.favoriteSpells = [catalogSpell.name];
    view.activeSheetTab = "spells";
    view.customSpells = [catalogSpell];

    const normallyHidden = view.renderCharacterForm(character);
    expect(normallyHidden).not.toContain("Secreto del catálogo");
    expect(normallyHidden).toContain('data-include-unknown-spells aria-pressed="false"');

    view.includeUnknownSpells = true;
    const included = view.renderCharacterForm(character);
    expect(included).toContain("Secreto del catálogo");
    expect(included).not.toContain('data-spell-action="learn"');
    expect(included).toContain('data-spell-action="favorite" aria-pressed="true"');
    expect(included).toContain('class="preparation-toggle catalog-preparation">No conocido</span>');

    view.sheetMode = "edit";
    const editable = view.renderCharacterForm(character);
    expect(editable).toContain("Secreto del catálogo");
    expect(editable).toContain('data-spell-action="learn"');
    expect(editable).toContain('data-spell-action="favorite" aria-pressed="true"');
    expect(editable).toContain('class="preparation-toggle catalog-preparation">No conocido</span>');
  });
});
