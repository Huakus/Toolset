import type { CharacterV2 } from "../../domain/character/character-v2";
import { projectCharacterStatistics, projectSpellcasting } from "../../domain/character/character-projection";
import { createGmProtocolMessage, parseGmProtocolMessage, type CharacterSummary } from "../../domain/encounter/encounter-protocol";
import {
  EncounterTransferAssembler,
  encounterTransferRequest,
  parseEncounterTransferMessage,
  serializeEncounterTransferMessage,
  ENCOUNTER_TRANSFER_PROTOCOL,
  ENCOUNTER_TRANSFER_VERSION,
  type PublicEncounterSnapshot,
} from "./encounter-transfer";

export interface TaleSpireInitiativeEntry {
  name: string;
  player: boolean;
  visible: boolean;
  bloodied: boolean;
}

export interface TaleSpireInitiativeState {
  entries: TaleSpireInitiativeEntry[];
  activeTurn: number | null;
  round: number | null;
}

export interface TaleSpireTransportPeer {
  id: string;
  label: string;
  clientMode: string;
}

export interface TaleSpireTransportProbeResult {
  probeId: string;
  targetClientId: string;
  targetLabel: string;
  requestedCharacters: number;
  sentCharacters: number;
  receivedCharacters: number | null;
  roundTripMs: number | null;
  status: "pending" | "received" | "failed" | "timeout";
  error: string | null;
  startedAt: string;
}

export interface TaleSpireTransportDiagnostics {
  ownClientId: string | null;
  peers: TaleSpireTransportPeer[];
  probes: TaleSpireTransportProbeResult[];
  updatedAt: string | null;
}

export interface CharacterSummaryRequest {
  kind: "modern" | "legacy";
  requestId: string | null;
}

export interface TaleSpireEncounterSyncState {
  encounterId: string | null;
  revision: number | null;
  checksum: string | null;
  status: "idle" | "requesting" | "receiving" | "synchronized" | "failed";
  error: string | null;
  updatedAt: string | null;
}

interface ClientFragment { id: string; [key: string]: unknown }

interface IncomingPayload {
  fromClient: ClientFragment | null;
  value: unknown;
  raw: string;
}

interface PendingProbe {
  targetClientId: string;
  sentAt: number;
  timeoutId: ReturnType<typeof globalThis.setTimeout>;
}

export interface TaleSpireCollaborationApi {
  sync: {
    send(message: string, target: string): Promise<unknown>;
    getClientsConnected?(): Promise<unknown>;
  };
  clients: {
    whoAmI(): Promise<unknown>;
    getClientsInThisBoard(): Promise<unknown>;
    getMoreInfo(clients: unknown[]): Promise<unknown>;
    isMe?(clientId: string): Promise<boolean>;
  };
}

const TRANSPORT_PROTOCOL = "talespire-5e-toolset-sync";
const TRANSPORT_VERSION = 2;
const PROBE_TIMEOUT_MS = 8_000;

function clientFragment(value: unknown): ClientFragment | null {
  if (value === null || typeof value !== "object") return null;
  const id = Reflect.get(value, "id");
  return typeof id === "string" && id.length > 0 ? value as ClientFragment : null;
}

function payload(event: unknown): IncomingPayload | null {
  if (event === null || typeof event !== "object") return null;
  const eventPayload = Reflect.get(event, "payload");
  if (eventPayload === null || typeof eventPayload !== "object") return null;
  const raw = Reflect.get(eventPayload, "str");
  if (typeof raw !== "string") return null;
  try {
    return {
      fromClient: clientFragment(Reflect.get(eventPayload, "fromClient")),
      value: JSON.parse(raw),
      raw,
    };
  } catch {
    return null;
  }
}

function clientLabel(client: ClientFragment): string {
  for (const key of ["displayName", "name", "userName", "playerName"]) {
    const value = Reflect.get(client, key);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return client.id;
}

function randomProbeId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `probe_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function probeMessage(probeId: string, requestedCharacters: number, sentAt: string): string {
  const base = {
    type: "toolset-sync-probe",
    protocol: TRANSPORT_PROTOCOL,
    version: TRANSPORT_VERSION,
    data: { probeId, requestedCharacters, sentAt, padding: "" },
  };
  const baseLength = JSON.stringify(base).length;
  base.data.padding = "x".repeat(Math.max(0, requestedCharacters - baseLength));
  return JSON.stringify(base);
}

function objectData(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

export class TaleSpirePlayerCollaboration {
  private me: ClientFragment | null = null;
  private gm: ClientFragment | null = null;
  private peers: TaleSpireTransportPeer[] = [];
  private initiativeListener: ((state: TaleSpireInitiativeState) => void) | null = null;
  private diagnosticsListener: ((state: TaleSpireTransportDiagnostics) => void) | null = null;
  private state: TaleSpireInitiativeState = { entries: [], activeTurn: null, round: null };
  private diagnostics: TaleSpireTransportDiagnostics = {
    ownClientId: null,
    peers: [],
    probes: [],
    updatedAt: null,
  };
  private pendingProbes = new Map<string, PendingProbe>();
  private summaryRequestListener: ((request: CharacterSummaryRequest) => void) | null = null;
  private latestCharacter: CharacterV2 | null = null;
  private readonly encounterAssembler = new EncounterTransferAssembler();
  private remoteEncounter: PublicEncounterSnapshot | null = null;
  private encounterSyncListener: ((state: TaleSpireEncounterSyncState) => void) | null = null;
  private encounterSyncState: TaleSpireEncounterSyncState = {
    encounterId: null, revision: null, checksum: null, status: "idle", error: null, updatedAt: null,
  };

  constructor(private readonly api: TaleSpireCollaborationApi) {}

  subscribe(listener: (state: TaleSpireInitiativeState) => void): () => void {
    this.initiativeListener = listener;
    listener(structuredClone(this.state));
    return () => { if (this.initiativeListener === listener) this.initiativeListener = null; };
  }

  subscribeTransportDiagnostics(listener: (state: TaleSpireTransportDiagnostics) => void): () => void {
    this.diagnosticsListener = listener;
    listener(structuredClone(this.diagnostics));
    return () => { if (this.diagnosticsListener === listener) this.diagnosticsListener = null; };
  }

  subscribeCharacterSummaryRequests(listener: (request: CharacterSummaryRequest) => void): () => void {
    this.summaryRequestListener = listener;
    return () => { if (this.summaryRequestListener === listener) this.summaryRequestListener = null; };
  }

  subscribeEncounterSync(listener: (state: TaleSpireEncounterSyncState) => void): () => void {
    this.encounterSyncListener = listener;
    listener(structuredClone(this.encounterSyncState));
    return () => { if (this.encounterSyncListener === listener) this.encounterSyncListener = null; };
  }

  async initialize(): Promise<void> {
    this.me = clientFragment(await this.api.clients.whoAmI());
    await this.refreshClients();
  }

  async refreshClients(): Promise<void> {
    const own = await this.identity();
    const rawClients = this.api.sync.getClientsConnected
      ? await this.api.sync.getClientsConnected()
      : await this.api.clients.getClientsInThisBoard();
    const fragments = Array.isArray(rawClients)
      ? rawClients.map(clientFragment).filter((entry): entry is ClientFragment => entry !== null && entry.id !== own.id)
      : [];
    const details = fragments.length ? await this.api.clients.getMoreInfo(fragments) : [];
    const detailMap = new Map(
      (Array.isArray(details) ? details : [])
        .map(clientFragment)
        .filter((entry): entry is ClientFragment => entry !== null)
        .map((entry) => [entry.id, entry]),
    );
    const resolved = fragments.map((fragment) => ({ ...fragment, ...detailMap.get(fragment.id) }));
    this.gm = resolved.find((entry) => Reflect.get(entry, "clientMode") === "gm") ?? null;
    this.peers = resolved.map((entry) => ({
      id: entry.id,
      label: clientLabel(entry),
      clientMode: typeof Reflect.get(entry, "clientMode") === "string" ? String(Reflect.get(entry, "clientMode")) : "unknown",
    }));
    this.diagnostics = {
      ...this.diagnostics,
      ownClientId: own.id,
      peers: structuredClone(this.peers),
      updatedAt: new Date().toISOString(),
    };
    this.publishDiagnostics();
  }

  async runTransportProbe(requestedCharacters: number): Promise<void> {
    if (!Number.isSafeInteger(requestedCharacters) || requestedCharacters < 256 || requestedCharacters > 500) {
      throw new Error("El tamaño de prueba debe estar entre 256 y 500 caracteres.");
    }
    await this.refreshClients();
    if (!this.peers.length) throw new Error("No hay otros clientes conectados en este tablero.");
    await Promise.all(this.peers.map(async (peer) => {
      const probeId = randomProbeId();
      const startedAt = new Date().toISOString();
      const message = probeMessage(probeId, requestedCharacters, startedAt);
      this.upsertProbe({
        probeId,
        targetClientId: peer.id,
        targetLabel: peer.label,
        requestedCharacters,
        sentCharacters: message.length,
        receivedCharacters: null,
        roundTripMs: null,
        status: "pending",
        error: null,
        startedAt,
      });
      const sentAt = Date.now();
      const timeoutId = globalThis.setTimeout(() => {
        if (!this.pendingProbes.delete(probeId)) return;
        this.updateProbe(probeId, { status: "timeout", error: "Sin confirmación después de 8 segundos." });
      }, PROBE_TIMEOUT_MS);
      this.pendingProbes.set(probeId, { targetClientId: peer.id, sentAt, timeoutId });
      try {
        await this.api.sync.send(message, peer.id);
      } catch (error) {
        globalThis.clearTimeout(timeoutId);
        this.pendingProbes.delete(probeId);
        this.updateProbe(probeId, {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }));
  }

  async handleSyncEvent(event: unknown): Promise<void> {
    const incoming = payload(event);
    if (!incoming || incoming.fromClient?.id === this.me?.id || incoming.value === null || typeof incoming.value !== "object") return;
    const type = Reflect.get(incoming.value, "type");
    const data = objectData(Reflect.get(incoming.value, "data"));
    if (type === "toolset-sync-probe") {
      await this.handleTransportProbe(incoming, data);
      return;
    }
    if (type === "toolset-sync-probe-ack") {
      this.handleTransportProbeAck(incoming, data);
      return;
    }
    const transfer = parseEncounterTransferMessage(incoming.raw);
    if (transfer) {
      if (!incoming.fromClient || incoming.fromClient.id !== this.gm?.id || !["start", "chunk", "end"].includes(transfer.t)) return;
      if (transfer.t === "start") this.setEncounterSync({ encounterId: transfer.e, revision: transfer.r, status: "receiving", error: null });
      const result = await this.encounterAssembler.accept(transfer);
      if (result.kind === "complete") {
        this.remoteEncounter = result.encounter;
        this.state = {
          entries: result.encounter.combatants.map((combatant) => ({
            name: combatant.name,
            player: combatant.player,
            visible: combatant.visible,
            bloodied: combatant.bloodied,
          })),
          activeTurn: result.encounter.combatants.findIndex((combatant) => combatant.id === result.encounter.activeCombatantId),
          round: result.encounter.round,
        };
        this.initiativeListener?.(structuredClone(this.state));
        this.setEncounterSync({ encounterId: result.encounter.id, revision: result.encounter.revision, checksum: result.checksum, status: "synchronized", error: null });
        await this.api.sync.send(serializeEncounterTransferMessage({
          p: ENCOUNTER_TRANSFER_PROTOCOL, v: ENCOUNTER_TRANSFER_VERSION,
          t: "ack", x: result.transferId, e: result.encounter.id,
          r: result.encounter.revision, c: result.checksum,
        }), incoming.fromClient.id);
      } else if (result.kind === "rejected") {
        this.setEncounterSync({ status: "failed", error: result.reason });
        await this.api.sync.send(serializeEncounterTransferMessage({
          p: ENCOUNTER_TRANSFER_PROTOCOL, v: ENCOUNTER_TRANSFER_VERSION,
          t: "reject", x: result.transferId, reason: result.reason,
        }), incoming.fromClient.id);
      }
      return;
    }
    const protocol = parseGmProtocolMessage(incoming.raw);
    if (protocol?.payload.type === "gm/request-character-summary") {
      if (this.latestCharacter) await this.sendModernCharacterSummary(this.latestCharacter, protocol.payload.requestId);
      else this.summaryRequestListener?.({ kind: "modern", requestId: protocol.payload.requestId });
      return;
    }
    if (protocol?.payload.type === "gm/encounter-changed" && incoming.fromClient && incoming.fromClient.id === this.gm?.id) {
      const remote = protocol.payload;
      if (
        this.remoteEncounter?.id === remote.encounterId &&
        this.remoteEncounter.revision > remote.revision
      ) return;
      if (
        this.encounterSyncState.encounterId === remote.encounterId &&
        this.encounterSyncState.revision === remote.revision &&
        this.encounterSyncState.checksum === remote.checksum
      ) return;
      this.setEncounterSync({ encounterId: remote.encounterId, revision: remote.revision, status: "requesting", error: null });
      await this.api.sync.send(encounterTransferRequest(
        remote.encounterId,
        this.remoteEncounter?.id === remote.encounterId ? this.remoteEncounter.revision : null,
        this.encounterSyncState.encounterId === remote.encounterId ? this.encounterSyncState.checksum : null,
      ), incoming.fromClient.id);
      return;
    }
    if (type === "request-info") {
      if (this.latestCharacter) await this.sendLegacyCharacterSummary(this.latestCharacter);
      else this.summaryRequestListener?.({ kind: "legacy", requestId: null });
      return;
    }
    const legacyData = Reflect.get(incoming.value, "data");
    if (type === "player-init-list" && Array.isArray(legacyData)) {
      this.state.entries = legacyData.map((entry) => ({
        name: String(entry?.n ?? ""),
        player: Boolean(entry?.p),
        visible: Boolean(entry?.v),
        bloodied: Boolean(entry?.b),
      }));
    } else if (type === "player-init-turn") {
      const turn = Number(legacyData);
      this.state.activeTurn = Number.isInteger(turn) ? turn : null;
    } else if (type === "player-init-round") {
      const round = Number(legacyData);
      this.state.round = Number.isInteger(round) ? round : null;
    } else {
      return;
    }
    this.initiativeListener?.(structuredClone(this.state));
  }

  async requestInitiativeList(): Promise<void> {
    await this.sendToGm({ type: "request-init-list", playerId: await this.identity(), data: {} });
  }

  async sendInitiative(value: number): Promise<void> {
    await this.sendToGm({ type: "update-init", playerId: await this.identity(), data: { Initiative: value } });
  }

  async sendCharacterSummary(character: CharacterV2, requestId: string | null = null): Promise<void> {
    this.latestCharacter = structuredClone(character);
    await this.sendLegacyCharacterSummary(character);
    await this.sendModernCharacterSummary(character, requestId);
  }

  async respondToCharacterSummaryRequest(character: CharacterV2, request: CharacterSummaryRequest): Promise<void> {
    this.latestCharacter = structuredClone(character);
    if (request.kind === "modern") await this.sendModernCharacterSummary(character, request.requestId);
    else await this.sendLegacyCharacterSummary(character);
  }

  private async sendLegacyCharacterSummary(character: CharacterV2): Promise<void> {
    const statistics = projectCharacterStatistics(character);
    const spellcasting = projectSpellcasting(character);
    const legacy = {
      type: "request-stats",
      playerId: await this.identity(),
      data: {
        characterName: character.name,
        hp: { current: String(character.combat.hitPoints.current), max: String(character.combat.hitPoints.maximum) },
        tempHp: String(character.combat.hitPoints.temporary),
        ac: String(character.combat.armorClass),
        passivePerception: String(statistics.passives.perception),
        spellSave: String(spellcasting.saveDc),
        conditions: [],
        conditionKeys: character.combat.conditions.map((condition) => condition.key),
        language: "eng",
      },
    };
    await this.sendToGm(legacy);
  }

  private async sendModernCharacterSummary(character: CharacterV2, requestId: string | null): Promise<void> {
    const statistics = projectCharacterStatistics(character);
    const spellcasting = projectSpellcasting(character);
    const summary: CharacterSummary = {
      characterId: character.id,
      name: character.name,
      currentHitPoints: character.combat.hitPoints.current,
      maximumHitPoints: character.combat.hitPoints.maximum,
      temporaryHitPoints: character.combat.hitPoints.temporary,
      armorClass: character.combat.armorClass,
      passivePerception: statistics.passives.perception,
      spellSaveDc: spellcasting.saveDc,
      conditionKeys: character.combat.conditions.map((condition) => condition.key),
    };
    let modern = JSON.stringify(createGmProtocolMessage({ type: "player/character-summary", requestId, summary }));
    while (modern.length > 500 && summary.conditionKeys.length > 0) {
      summary.conditionKeys.pop();
      modern = JSON.stringify(createGmProtocolMessage({ type: "player/character-summary", requestId, summary }));
    }
    if (modern.length > 500) throw new Error("El resumen del personaje supera el límite de 500 caracteres de TaleSpire.");
    await this.sendToGm(JSON.parse(modern));
  }

  private async handleTransportProbe(incoming: IncomingPayload, data: Record<string, unknown> | null): Promise<void> {
    if (!incoming.fromClient || !data || Reflect.get(incoming.value as object, "protocol") !== TRANSPORT_PROTOCOL || Reflect.get(incoming.value as object, "version") !== TRANSPORT_VERSION) return;
    const probeId = data.probeId;
    if (typeof probeId !== "string" || !probeId) return;
    await this.api.sync.send(JSON.stringify({
      type: "toolset-sync-probe-ack",
      protocol: TRANSPORT_PROTOCOL,
      version: TRANSPORT_VERSION,
      data: {
        probeId,
        receivedCharacters: incoming.raw.length,
        receivedAt: new Date().toISOString(),
      },
    }), incoming.fromClient.id);
  }

  private handleTransportProbeAck(incoming: IncomingPayload, data: Record<string, unknown> | null): void {
    if (!incoming.fromClient || !data || Reflect.get(incoming.value as object, "protocol") !== TRANSPORT_PROTOCOL || Reflect.get(incoming.value as object, "version") !== TRANSPORT_VERSION) return;
    const probeId = data.probeId;
    const receivedCharacters = Number(data.receivedCharacters);
    if (typeof probeId !== "string" || !Number.isSafeInteger(receivedCharacters) || receivedCharacters < 0) return;
    const pending = this.pendingProbes.get(probeId);
    if (!pending || pending.targetClientId !== incoming.fromClient.id) return;
    globalThis.clearTimeout(pending.timeoutId);
    this.pendingProbes.delete(probeId);
    const sentCharacters = this.diagnostics.probes.find((entry) => entry.probeId === probeId)?.sentCharacters ?? null;
    const sizesMatch = sentCharacters === receivedCharacters;
    this.updateProbe(probeId, {
      status: sizesMatch ? "received" : "failed",
      receivedCharacters,
      roundTripMs: Math.max(0, Date.now() - pending.sentAt),
      error: sizesMatch ? null : `El destinatario recibió ${receivedCharacters} de ${sentCharacters ?? "?"} caracteres enviados.`,
    });
  }

  private upsertProbe(result: TaleSpireTransportProbeResult): void {
    const probes = [...this.diagnostics.probes.filter((entry) => entry.probeId !== result.probeId), result].slice(-50);
    this.diagnostics = { ...this.diagnostics, probes, updatedAt: new Date().toISOString() };
    this.publishDiagnostics();
  }

  private updateProbe(probeId: string, patch: Partial<TaleSpireTransportProbeResult>): void {
    const current = this.diagnostics.probes.find((entry) => entry.probeId === probeId);
    if (!current) return;
    this.upsertProbe({ ...current, ...patch });
  }

  private publishDiagnostics(): void {
    this.diagnosticsListener?.(structuredClone(this.diagnostics));
  }

  private setEncounterSync(patch: Partial<TaleSpireEncounterSyncState>): void {
    this.encounterSyncState = { ...this.encounterSyncState, ...patch, updatedAt: new Date().toISOString() };
    this.encounterSyncListener?.(structuredClone(this.encounterSyncState));
  }

  private async identity(): Promise<ClientFragment> {
    if (!this.me) this.me = clientFragment(await this.api.clients.whoAmI());
    if (!this.me) throw new Error("TaleSpire no informó la identidad de este cliente.");
    return this.me;
  }

  private async sendToGm(message: unknown): Promise<void> {
    if (!this.gm) await this.refreshClients();
    if (!this.gm) throw new Error("No se encontró un cliente GM en este tablero.");
    await this.api.sync.send(JSON.stringify(message), this.gm.id);
  }
}
