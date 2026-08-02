import { CampaignApplication } from "./application/campaign/campaign-application";
import { BlobCampaignRepository } from "./infrastructure/persistence/blob-campaign-repository";
import { createBrowserExclusiveLock } from "./infrastructure/persistence/exclusive-lock";
import {
  DEFAULT_CAMPAIGN_STORAGE_KEY,
  LocalStorageCampaignRepository,
} from "./infrastructure/persistence/local-storage-campaign-repository";
import {
  detectTaleSpireApi,
  TaleSpireCampaignBlobStore,
  type TaleSpireApiSubset,
} from "./infrastructure/talespire/talespire-campaign-blob-store";
import "./styles.css";
import { BrowserApp } from "./ui/browser-app";
import { BrowserDiceRoller } from "./infrastructure/dice/browser-dice-roller";
import { TaleSpireDiceRoller } from "./infrastructure/talespire/talespire-dice-roller";
import { TaleSpireMiniatureAdapter } from "./infrastructure/talespire/talespire-miniature";
import { TaleSpirePlayerCollaboration } from "./infrastructure/talespire/talespire-player-collaboration";
import { TaleSpireGlobalContentStore } from "./infrastructure/talespire/talespire-global-content";
import { resolveTaleSpireClientRole } from "./infrastructure/talespire/talespire-client-role";
import { EncounterApplication } from "./application/encounter/encounter-application";
import { GmApp } from "./ui/gm-app";
import { TaleSpireGmCollaboration } from "./infrastructure/talespire/talespire-gm-collaboration";
import { monsterDefinitions } from "./domain/monsters/monster-catalog";
import { GmWorkspaceApplication } from "./application/gm/gm-workspace-application";

declare global {
  interface Window {
    TS?: unknown;
    onStateChangeEvent?: (event: { kind?: string }) => void;
    handleRollResult?: (event: unknown) => void;
    logSymbioteEvent?: (event: unknown) => void;
    onCreatureStateChange?: (event: unknown) => void;
    handleSyncEvents?: (event: unknown) => void;
    handleSyncClientEvents?: (event: unknown) => void;
    handleClientEvents?: (event: unknown) => void;
    handlePlayerPermissionEvents?: (event: unknown) => void;
    handleChatMessage?: (event: unknown) => void;
  }
}

const discoveredAppRoot = document.querySelector<HTMLElement>("#app");
if (!discoveredAppRoot) throw new Error("V2_APP_ROOT_NOT_FOUND");
const appRoot: HTMLElement = discoveredAppRoot;

let started = false;
let activeCollaboration: TaleSpirePlayerCollaboration | null = null;
let activeGmCollaboration: TaleSpireGmCollaboration | null = null;
let activeTaleSpireDiceRoller: TaleSpireDiceRoller | null = null;

function startBrowserDevelopment(): void {
  if (started) return;
  started = true;
  const repository = new LocalStorageCampaignRepository(
    window.localStorage,
    DEFAULT_CAMPAIGN_STORAGE_KEY,
    createBrowserExclusiveLock(),
  );
  const application = new CampaignApplication(repository);
  void new BrowserApp(appRoot, application, {
    storageLabel: "Almacenamiento de desarrollo del navegador",
    storageEventKey: repository.storageKey,
    diceRoller: new BrowserDiceRoller(),
  }).start();
}

async function startTaleSpire(api: TaleSpireApiSubset): Promise<void> {
  if (started) return;
  started = true;
  const blobStore = new TaleSpireCampaignBlobStore(api.localStorage.campaign);
  const repository = new BlobCampaignRepository(
    blobStore,
    undefined,
    createBrowserExclusiveLock(),
  );
  const application = new CampaignApplication(repository);
  const clientRole = api.clients ? await resolveTaleSpireClientRole(api.clients) : "player";
  const diceRoller = api.dice ? new TaleSpireDiceRoller(api.dice) : new BrowserDiceRoller();
  const globalContent = api.localStorage.global
    ? new TaleSpireGlobalContentStore(api.localStorage.global, createBrowserExclusiveLock())
    : null;
  if (diceRoller instanceof TaleSpireDiceRoller) activeTaleSpireDiceRoller = diceRoller;
  if (clientRole === "gm") {
    const collaboration = api.sync && api.clients
      ? new TaleSpireGmCollaboration({ sync: api.sync, clients: api.clients })
      : null;
    activeGmCollaboration = collaboration;
    if (collaboration) await collaboration.initialize();
    const gmWorkspace = new GmWorkspaceApplication(repository);
    void new GmApp(appRoot, new EncounterApplication(repository), {
      diceRoller,
      monsters: monsterDefinitions(),
      ...(globalContent ? {
        loadGmContent: () => globalContent.load(),
        loadCustomMonsters: async () => (await globalContent.load()).monsters,
        saveCustomMonster: (definition, previousKey) => globalContent.saveMonster(definition, previousKey),
        deleteCustomMonster: (key) => globalContent.deleteMonster(key),
        saveCustomSpell: (definition, previousKey) => globalContent.saveSpell(definition, previousKey),
        deleteCustomSpell: (key) => globalContent.deleteSpell(key),
        saveCustomEquipment: (definition, previousKey) => globalContent.saveEquipment(definition, previousKey),
        deleteCustomEquipment: (key) => globalContent.deleteEquipment(key),
        saveShop: (shop, previousKey) => globalContent.saveShop(shop, previousKey),
        deleteShop: (key) => globalContent.deleteShop(key),
        saveChecklistItem: (item) => globalContent.saveChecklistItem(item),
        deleteChecklistItem: (key) => globalContent.deleteChecklistItem(key),
      } : {}),
      saveGmWorkspace: (workspace, checksum) => gmWorkspace.save(workspace, checksum),
      ...(collaboration ? {
        subscribePlayers: (listener) => collaboration.subscribePlayers(listener),
        subscribeCharacterSummaries: (listener) => collaboration.subscribeCharacterSummaries(listener),
        subscribeInitiative: (listener) => collaboration.subscribeInitiative(listener),
        refreshPlayers: () => collaboration.refreshClients(),
        requestCharacterSummaries: () => collaboration.requestCharacterSummaries(),
        publishEncounter: (encounter) => collaboration.publishEncounter(encounter),
        subscribeTransferStatus: (listener) => collaboration.subscribeTransferStatus(listener),
      } : {}),
    }).start();
    return;
  }
  const miniature = new TaleSpireMiniatureAdapter(api);
  const collaboration = api.sync && api.clients
    ? new TaleSpirePlayerCollaboration({ sync: api.sync, clients: api.clients })
    : null;
  activeCollaboration = collaboration;
  if (collaboration) await collaboration.initialize();
  if (diceRoller instanceof TaleSpireDiceRoller) {
    diceRoller.subscribe((result) => {
      if (result.name.startsWith("Iniciativa:")) void activeCollaboration?.sendInitiative(result.total);
    });
  }
  void new BrowserApp(appRoot, application, {
    storageLabel: "Almacenamiento de campaña de TaleSpire",
    loadCurrentCampaignSource: () => repository.readLegacySource(),
    loadStorageUsage: () => repository.getStorageUsage(),
    diceRoller,
    ...(collaboration
      ? {
          requestInitiativeList: () => collaboration.requestInitiativeList(),
          sendInitiative: (value: number) => collaboration.sendInitiative(value),
          sendCharacterSummary: (character: Parameters<typeof collaboration.sendCharacterSummary>[0]) => collaboration.sendCharacterSummary(character),
          subscribeInitiative: (listener: Parameters<typeof collaboration.subscribe>[0]) => collaboration.subscribe(listener),
          runSyncTransportProbe: (messageCharacters: number) => collaboration.runTransportProbe(messageCharacters),
          refreshSyncPeers: () => collaboration.refreshClients(),
          subscribeTransportDiagnostics: (listener: Parameters<typeof collaboration.subscribeTransportDiagnostics>[0]) => collaboration.subscribeTransportDiagnostics(listener),
          subscribeCharacterSummaryRequests: (listener: Parameters<typeof collaboration.subscribeCharacterSummaryRequests>[0]) => collaboration.subscribeCharacterSummaryRequests(listener),
          respondToCharacterSummaryRequest: (character: Parameters<typeof collaboration.respondToCharacterSummaryRequest>[0], request: Parameters<typeof collaboration.respondToCharacterSummaryRequest>[1]) => collaboration.respondToCharacterSummaryRequest(character, request),
          subscribeEncounterSync: (listener: Parameters<typeof collaboration.subscribeEncounterSync>[0]) => collaboration.subscribeEncounterSync(listener),
        }
      : {}),
    ...(globalContent
      ? {
          loadCustomContent: () => globalContent.load(),
          saveCustomSpell: (definition: Parameters<typeof globalContent.saveSpell>[0]) => globalContent.saveSpell(definition),
          saveCustomEquipment: (definition: Parameters<typeof globalContent.saveEquipment>[0]) => globalContent.saveEquipment(definition),
        }
      : {}),
    ...(api.creatures
      ? {
          selectMiniature: () => miniature.selectFirst(),
          createMiniatureThumbnail: (link: Parameters<typeof miniature.createThumbnail>[0]) => miniature.createThumbnail(link),
        }
      : {}),
  }).start();
}

const taleSpireApi = detectTaleSpireApi(window.TS);
window.handleRollResult = (event) => { void activeTaleSpireDiceRoller?.handleRollEvent(event); };
window.logSymbioteEvent = () => undefined;
window.onCreatureStateChange = () => undefined;
window.handleSyncEvents = (event) => {
  void activeCollaboration?.handleSyncEvent(event);
  void activeGmCollaboration?.handleSyncEvent(event);
};
window.handleSyncClientEvents = () => {
  void activeCollaboration?.refreshClients();
  void activeGmCollaboration?.refreshClients();
};
window.handleClientEvents = window.handleSyncClientEvents;
window.handlePlayerPermissionEvents = () => undefined;
window.handleChatMessage = () => undefined;
if (taleSpireApi === null) {
  startBrowserDevelopment();
} else {
  appRoot.innerHTML = '<p class="welcome">Esperando la inicialización del API de TaleSpire…</p>';
  window.onStateChangeEvent = (event): void => {
    if (event.kind === "hasInitialized") void startTaleSpire(taleSpireApi);
  };
}
