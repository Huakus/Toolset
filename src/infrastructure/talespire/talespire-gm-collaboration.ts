import type { Encounter } from "../../domain/encounter/encounter-model";
import { isBloodied, orderedCombatants } from "../../domain/encounter/encounter";
import {
  createGmProtocolMessage,
  parseGmProtocolMessage,
  type CharacterSummary,
} from "../../domain/encounter/encounter-protocol";
import { checksumJson } from "../../shared/hash";
import type { TaleSpireCollaborationApi } from "./talespire-player-collaboration";
import {
  buildEncounterTransfer,
  parseEncounterTransferMessage,
  projectPublicEncounter,
} from "./encounter-transfer";

export interface TaleSpireGmPlayer {
  id: string;
  label: string;
}

export interface ReceivedCharacterSummary {
  clientId: string;
  summary: CharacterSummary;
}

export interface EncounterTransferStatus {
  clientId: string;
  transferId: string;
  attempt: number;
  status: "sending" | "confirmed" | "retrying" | "failed";
  error: string | null;
  updatedAt: string;
}

interface PendingEncounterTransfer {
  clientId: string;
  encounter: Encounter;
  attempt: number;
  encounterId: string;
  revision: number;
  checksum: string;
  timeoutId: ReturnType<typeof globalThis.setTimeout>;
}

const TRANSFER_CONFIRMATION_TIMEOUT_MS = 8_000;
const MAX_TRANSFER_ATTEMPTS = 3;

interface ClientFragment { id: string; [key: string]: unknown }

function client(value: unknown): ClientFragment | null {
  if (value === null || typeof value !== "object") return null;
  const id = Reflect.get(value, "id");
  return typeof id === "string" && id ? value as ClientFragment : null;
}

function label(value: ClientFragment): string {
  for (const key of ["displayName", "name", "userName", "playerName"]) {
    const candidate = Reflect.get(value, key);
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return value.id;
}

function eventPayload(event: unknown): { from: ClientFragment; raw: string; value: Record<string, unknown> } | null {
  if (event === null || typeof event !== "object") return null;
  const payload = Reflect.get(event, "payload");
  if (payload === null || typeof payload !== "object") return null;
  const from = client(Reflect.get(payload, "fromClient"));
  const raw = Reflect.get(payload, "str");
  if (!from || typeof raw !== "string") return null;
  try {
    const value = JSON.parse(raw);
    return value !== null && typeof value === "object" ? { from, raw, value } : null;
  } catch {
    return null;
  }
}

function legacySummary(value: Record<string, unknown>, clientId: string): ReceivedCharacterSummary | null {
  if (value.type !== "request-stats") return null;
  const data = value.data;
  if (data === null || typeof data !== "object") return null;
  const hp = Reflect.get(data, "hp");
  const hpData = hp !== null && typeof hp === "object" ? hp : {};
  const conditionKeys = Reflect.get(data, "conditionKeys");
  const characterName = String(Reflect.get(data, "characterName") ?? "Jugador");
  return {
    clientId,
    summary: {
      characterId: "chr_00000000000000000000000000000000",
      name: characterName,
      currentHitPoints: Math.max(0, Number(Reflect.get(hpData, "current")) || 0),
      maximumHitPoints: Math.max(0, Number(Reflect.get(hpData, "max")) || 0),
      temporaryHitPoints: Math.max(0, Number(Reflect.get(data, "tempHp")) || 0),
      armorClass: Math.max(0, Number(Reflect.get(data, "ac")) || 0),
      passivePerception: Number(Reflect.get(data, "passivePerception")) || 0,
      spellSaveDc: Number(Reflect.get(data, "spellSave")) || 0,
      conditionKeys: Array.isArray(conditionKeys) ? conditionKeys.map(String) : [],
    },
  };
}

export class TaleSpireGmCollaboration {
  private me: ClientFragment | null = null;
  private players: TaleSpireGmPlayer[] = [];
  private playersListener: ((players: TaleSpireGmPlayer[]) => void) | null = null;
  private summaryListener: ((summary: ReceivedCharacterSummary) => void) | null = null;
  private initiativeListener: ((clientId: string, initiative: number) => void) | null = null;
  private transferStatusListener: ((status: EncounterTransferStatus) => void) | null = null;
  private latestEncounter: Encounter | null = null;
  private pendingTransfers = new Map<string, PendingEncounterTransfer>();

  constructor(private readonly api: TaleSpireCollaborationApi) {}

  async initialize(): Promise<void> {
    this.me = client(await this.api.clients.whoAmI());
    await this.refreshClients();
  }

  subscribePlayers(listener: (players: TaleSpireGmPlayer[]) => void): () => void {
    this.playersListener = listener;
    listener(structuredClone(this.players));
    return () => { if (this.playersListener === listener) this.playersListener = null; };
  }

  subscribeCharacterSummaries(listener: (summary: ReceivedCharacterSummary) => void): () => void {
    this.summaryListener = listener;
    return () => { if (this.summaryListener === listener) this.summaryListener = null; };
  }

  subscribeInitiative(listener: (clientId: string, initiative: number) => void): () => void {
    this.initiativeListener = listener;
    return () => { if (this.initiativeListener === listener) this.initiativeListener = null; };
  }

  subscribeTransferStatus(listener: (status: EncounterTransferStatus) => void): () => void {
    this.transferStatusListener = listener;
    return () => { if (this.transferStatusListener === listener) this.transferStatusListener = null; };
  }

  async refreshClients(): Promise<void> {
    const raw = this.api.sync.getClientsConnected
      ? await this.api.sync.getClientsConnected()
      : await this.api.clients.getClientsInThisBoard();
    const fragments = Array.isArray(raw)
      ? raw.map(client).filter((entry): entry is ClientFragment => entry !== null && entry.id !== this.me?.id)
      : [];
    const details = fragments.length ? await this.api.clients.getMoreInfo(fragments) : [];
    const detailMap = new Map((Array.isArray(details) ? details : []).map(client).filter((entry): entry is ClientFragment => entry !== null).map((entry) => [entry.id, entry]));
    this.players = fragments
      .map((entry) => ({ ...entry, ...detailMap.get(entry.id) }))
      .filter((entry) => Reflect.get(entry, "clientMode") !== "gm")
      .map((entry) => ({ id: entry.id, label: label(entry) }));
    this.playersListener?.(structuredClone(this.players));
  }

  async requestCharacterSummaries(): Promise<void> {
    const request = createGmProtocolMessage({ type: "gm/request-character-summary", requestId: "msg_0000000000000000" });
    if (request.payload.type === "gm/request-character-summary") request.payload.requestId = request.messageId;
    await Promise.all(this.players.map((player) => this.api.sync.send(JSON.stringify(request), player.id)));
  }

  async publishEncounter(encounter: Encounter): Promise<void> {
    this.latestEncounter = structuredClone(encounter);
    const ordered = orderedCombatants(encounter);
    const activeTurn = ordered.findIndex((combatant) => combatant.id === encounter.activeCombatantId);
    const legacyList = ordered.map((combatant) => ({
      n: combatant.kind === "player" ? combatant.name : "",
      p: combatant.kind === "player" ? 1 : 0,
      v: combatant.visibleToPlayers ? 1 : 0,
      b: combatant.kind === "monster" && isBloodied(combatant) ? 1 : 0,
    }));
    await Promise.allSettled([
      this.api.sync.send(JSON.stringify({ type: "player-init-list", data: legacyList }), "board"),
      this.api.sync.send(JSON.stringify({ type: "player-init-turn", data: activeTurn < 0 ? 0 : activeTurn }), "board"),
      this.api.sync.send(JSON.stringify({ type: "player-init-round", data: encounter.round }), "board"),
      checksumJson(JSON.parse(JSON.stringify(projectPublicEncounter(encounter)))).then((checksum) => this.api.sync.send(JSON.stringify(createGmProtocolMessage({
        type: "gm/encounter-changed",
        encounterId: encounter.id,
        revision: encounter.revision,
        checksum,
      })), "board")),
    ]);
  }

  async handleSyncEvent(event: unknown): Promise<void> {
    const incoming = eventPayload(event);
    if (!incoming || incoming.from.id === this.me?.id) return;
    const transfer = parseEncounterTransferMessage(incoming.raw);
    if (transfer) {
      if (transfer.t === "req" && this.latestEncounter?.id === transfer.e) {
        await this.sendEncounterSnapshot(incoming.from.id, this.latestEncounter, 1);
      } else if (transfer.t === "ack") {
        this.confirmTransfer(incoming.from.id, transfer);
      } else if (transfer.t === "reject") {
        await this.retryTransfer(incoming.from.id, transfer.x, transfer.reason);
      }
      return;
    }
    const protocol = parseGmProtocolMessage(incoming.raw);
    if (protocol?.payload.type === "player/character-summary") {
      this.summaryListener?.({ clientId: incoming.from.id, summary: protocol.payload.summary });
      return;
    }
    const legacy = legacySummary(incoming.value, incoming.from.id);
    if (legacy) {
      this.summaryListener?.(legacy);
      return;
    }
    if (incoming.value.type === "update-init") {
      const data = incoming.value.data;
      const initiative = data !== null && typeof data === "object" ? Number(Reflect.get(data, "Initiative")) : NaN;
      if (Number.isSafeInteger(initiative)) this.initiativeListener?.(incoming.from.id, initiative);
    } else if (incoming.value.type === "request-init-list" && this.latestEncounter) {
      await this.publishEncounter(this.latestEncounter);
    }
  }

  private async sendEncounterSnapshot(clientId: string, encounter: Encounter, attempt: number): Promise<void> {
    try {
      const transfer = await buildEncounterTransfer(encounter);
      this.publishTransferStatus({ clientId, transferId: transfer.transferId, attempt, status: attempt > 1 ? "retrying" : "sending", error: null, updatedAt: new Date().toISOString() });
      const timeoutId = globalThis.setTimeout(() => {
        const pending = this.pendingTransfers.get(transfer.transferId);
        if (!pending) return;
        this.pendingTransfers.delete(transfer.transferId);
        if (pending.attempt < MAX_TRANSFER_ATTEMPTS) void this.sendEncounterSnapshot(pending.clientId, pending.encounter, pending.attempt + 1);
        else this.publishTransferStatus({ clientId: pending.clientId, transferId: transfer.transferId, attempt: pending.attempt, status: "failed", error: "Sin confirmación después de tres intentos.", updatedAt: new Date().toISOString() });
      }, TRANSFER_CONFIRMATION_TIMEOUT_MS);
      this.pendingTransfers.set(transfer.transferId, {
        clientId, encounter: structuredClone(encounter), attempt, timeoutId,
        encounterId: transfer.encounterId, revision: transfer.revision, checksum: transfer.checksum,
      });
      for (const message of transfer.messages) await this.api.sync.send(message, clientId);
    } catch (error) {
      for (const [transferId, pending] of this.pendingTransfers) {
        if (pending.clientId === clientId && pending.attempt === attempt) {
          globalThis.clearTimeout(pending.timeoutId);
          this.pendingTransfers.delete(transferId);
        }
      }
      if (attempt < MAX_TRANSFER_ATTEMPTS) {
        await this.sendEncounterSnapshot(clientId, encounter, attempt + 1);
      } else {
        this.publishTransferStatus({ clientId, transferId: "x_0000000000000000", attempt, status: "failed", error: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString() });
      }
    }
  }

  private confirmTransfer(clientId: string, acknowledgement: Extract<ReturnType<typeof parseEncounterTransferMessage>, { t: "ack" }>): void {
    if (!acknowledgement) return;
    const transferId = acknowledgement.x;
    const pending = this.pendingTransfers.get(transferId);
    if (
      !pending || pending.clientId !== clientId || pending.encounterId !== acknowledgement.e ||
      pending.revision !== acknowledgement.r || pending.checksum !== acknowledgement.c
    ) return;
    globalThis.clearTimeout(pending.timeoutId);
    this.pendingTransfers.delete(transferId);
    this.publishTransferStatus({ clientId, transferId, attempt: pending.attempt, status: "confirmed", error: null, updatedAt: new Date().toISOString() });
  }

  private async retryTransfer(clientId: string, transferId: string, reason: string): Promise<void> {
    const pending = this.pendingTransfers.get(transferId);
    if (!pending || pending.clientId !== clientId) return;
    globalThis.clearTimeout(pending.timeoutId);
    this.pendingTransfers.delete(transferId);
    if (pending.attempt < MAX_TRANSFER_ATTEMPTS) await this.sendEncounterSnapshot(clientId, pending.encounter, pending.attempt + 1);
    else this.publishTransferStatus({ clientId, transferId, attempt: pending.attempt, status: "failed", error: reason, updatedAt: new Date().toISOString() });
  }

  private publishTransferStatus(status: EncounterTransferStatus): void {
    this.transferStatusListener?.(structuredClone(status));
  }
}
