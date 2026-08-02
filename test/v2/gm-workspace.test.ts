import { describe, expect, it } from "vitest";
import { CampaignApplication } from "../../src/application/campaign/campaign-application";
import { GmWorkspaceApplication } from "../../src/application/gm/gm-workspace-application";
import { InMemoryCampaignRepository } from "../../src/infrastructure/persistence/in-memory-campaign-repository";
import { GmToolsPanel } from "../../src/ui/gm-tools-panel";
import { removeGmNoteGroup } from "../../src/domain/gm/gm-workspace";
import { calculateFloatingPanelPosition, GmApp } from "../../src/ui/gm-app";

describe("GM workspace", () => {
  it("persists notes, tables and Google Docs URL with optimistic concurrency", async () => {
    const repository = new InMemoryCampaignRepository();
    const snapshot = await new CampaignApplication(repository).createCampaign("2026-08-02T12:00:00.000Z");
    const application = new GmWorkspaceApplication(repository);
    const workspace = {
      noteGroups: [{ id: "gmg_11111111111111111111111111111111", title: "Trama", notes: [{ id: "gmn_22222222222222222222222222222222", title: "Pista", content: "Una pista" }] }],
      randomTables: [{ id: "gmt_33333333333333333333333333333333", name: "Clima", entries: ["Sol", "Lluvia"] }],
      googleDocsUrl: "https://docs.google.com/document/d/example/edit",
    };
    const saved = await application.save(workspace, snapshot.checksum, "2026-08-02T12:01:00.000Z");
    expect(saved.campaign.gm).toEqual(workspace);
    expect(saved.campaign.revision).toBe(1);
    await expect(application.save(workspace, snapshot.checksum)).rejects.toThrow();
  });

  it("renders every non-combat GM surface", async () => {
    const panel = new GmToolsPanel({} as HTMLElement, {
      loadGmContent: async () => ({ spells: [], equipment: [], monsters: [], shops: [{ name: "Mercado", categories: { General: ["rope"] } }], checklist: [{ id: "task", text: "Preparar mapa", checked: false }] }),
    }, () => undefined, () => undefined, () => undefined);
    await panel.load();
    const workspace = { noteGroups: [], randomTables: [], googleDocsUrl: "" };
    expect(panel.render("content", workspace, "spell")).toContain('data-gm-new="spell"');
    expect(panel.render("content", workspace, "equipment")).toContain('data-gm-new="equipment"');
    const shops = panel.render("content", workspace, "shop");
    expect(shops).toContain('data-gm-new="shop"');
    expect(shops).toContain('data-gm-content-search="shop"');
    expect(shops).toContain('data-gm-content-filter="categoría:General"');
    expect(shops).toContain('class="play-card gm-catalog-card gm-shop-card"');
    expect(shops).toContain('data-gm-edit="shop" data-gm-content-key="Mercado"');
    expect(shops).not.toContain('data-gm-form="shop"');
    expect(panel.render("notes", workspace)).toContain("Nuevo grupo de notas");
    const tools = panel.render("tools", workspace);
    expect(tools).toContain("Checklist");
    expect(tools).toContain("Tablas");
    expect(tools).toContain("Viaje y salto");
    expect(tools).toContain('data-gm-tool="npc"');
    expect(tools).toContain("Google Docs");
    expect(tools).toContain('data-gm-tool="checklist" class="active"');
    expect(tools).not.toContain('data-gm-add="table"');
    (panel as unknown as { activeTool: string }).activeTool = "tables";
    expect(panel.render("tools", workspace)).toContain('data-gm-add="table"');
  });

  it("removes a complete note group without altering the other groups", () => {
    const first = { id: "gmg_11111111111111111111111111111111", title: "Primero", notes: [] };
    const second = { id: "gmg_22222222222222222222222222222222", title: "Segundo", notes: [] };
    const workspace = { noteGroups: [first, second], randomTables: [], googleDocsUrl: "" };
    expect(removeGmNoteGroup(workspace, first.id).noteGroups).toEqual([second]);
  });

  it("keeps combatant panels inside the visible interface", () => {
    const nearBottomRight = calculateFloatingPanelPosition(
      { width: 320, height: 480 },
      { left: 270, top: 420, bottom: 465 },
      { width: 390, height: 700 },
    );
    expect(nearBottomRight.left).toBe(6);
    expect(nearBottomRight.top).toBe(6);
    expect(nearBottomRight.maxHeight).toBe(468);
    const normal = calculateFloatingPanelPosition(
      { width: 900, height: 700 },
      { left: 100, top: 100, bottom: 150 },
      { width: 300, height: 250 },
    );
    expect(normal).toMatchObject({ left: 100, top: 154 });
  });

  it("renders persistent GM color controls and a scoped action log", () => {
    const view = Object.create(GmApp.prototype) as {
      gmColor: string;
      undoStack: unknown[];
      redoStack: unknown[];
      actionLog: { id: number; label: string; occurredAt: string; kind: "action" }[];
      renderColorPicker(): string;
      renderActionHistoryControls(): string;
    };
    view.gmColor = "#6f96c4";
    view.undoStack = [{}];
    view.redoStack = [];
    view.actionLog = [{ id: 1, label: "Aplicar daño", occurredAt: "2026-08-02T12:34:56.000Z", kind: "action" }];
    expect(view.renderColorPicker()).toContain('data-gm-color-value="#6f96c4"');
    expect(view.renderColorPicker()).toContain('id="gm-interface-color"');
    const history = view.renderActionHistoryControls();
    expect(history).toContain('data-gm-history="undo"');
    expect(history).toContain("Aplicar daño");
    expect(history).toContain("Log 1");
  });
});
