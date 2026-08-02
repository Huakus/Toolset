import { z } from "zod";
import { EncounterSchema, type Encounter } from "../../domain/encounter/encounter-model";
import { isBloodied, orderedCombatants } from "../../domain/encounter/encounter";
import { checksumJson } from "../../shared/hash";

export const ENCOUNTER_TRANSFER_PROTOCOL = "t5e-encounter-xfer";
export const ENCOUNTER_TRANSFER_VERSION = 1;
export const TALESPIRE_MESSAGE_CHARACTER_LIMIT = 500;
const CHUNK_DATA_CHARACTERS = 320;

const base = {
  p: z.literal(ENCOUNTER_TRANSFER_PROTOCOL),
  v: z.literal(ENCOUNTER_TRANSFER_VERSION),
};

const RequestSchema = z.object({
  ...base,
  t: z.literal("req"),
  e: z.string().min(1),
  r: z.number().int().nonnegative().nullable(),
  c: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
});
const StartSchema = z.object({
  ...base,
  t: z.literal("start"),
  x: z.string().regex(/^x_[a-f0-9]{16}$/),
  e: z.string().min(1),
  r: z.number().int().nonnegative(),
  c: z.string().regex(/^[a-f0-9]{64}$/),
  n: z.number().int().positive(),
  z: z.enum(["gzip", "raw"]),
});
const ChunkSchema = z.object({
  ...base,
  t: z.literal("chunk"),
  x: z.string().regex(/^x_[a-f0-9]{16}$/),
  i: z.number().int().nonnegative(),
  n: z.number().int().positive(),
  d: z.string(),
});
const EndSchema = z.object({ ...base, t: z.literal("end"), x: z.string().regex(/^x_[a-f0-9]{16}$/) });
const AckSchema = z.object({
  ...base,
  t: z.literal("ack"),
  x: z.string().regex(/^x_[a-f0-9]{16}$/),
  e: z.string().min(1),
  r: z.number().int().nonnegative(),
  c: z.string().regex(/^[a-f0-9]{64}$/),
});
const RejectSchema = z.object({
  ...base,
  t: z.literal("reject"),
  x: z.string().regex(/^x_[a-f0-9]{16}$/),
  reason: z.string().min(1).max(120),
});

export const EncounterTransferMessageSchema = z.discriminatedUnion("t", [
  RequestSchema, StartSchema, ChunkSchema, EndSchema, AckSchema, RejectSchema,
]);
export type EncounterTransferMessage = z.infer<typeof EncounterTransferMessageSchema>;
export type EncounterTransferStart = z.infer<typeof StartSchema>;

export const PublicEncounterSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  round: z.number().int().positive(),
  activeCombatantId: z.string().min(1).nullable(),
  combatants: z.array(z.object({
    id: z.string().min(1),
    name: z.string(),
    player: z.boolean(),
    visible: z.boolean(),
    bloodied: z.boolean(),
  })),
});
export type PublicEncounterSnapshot = z.infer<typeof PublicEncounterSnapshotSchema>;

export interface BuiltEncounterTransfer {
  transferId: string;
  encounterId: string;
  revision: number;
  checksum: string;
  messages: string[];
}

export type EncounterTransferAssemblyResult =
  | { kind: "pending" }
  | { kind: "complete"; transferId: string; encounter: PublicEncounterSnapshot; checksum: string }
  | { kind: "rejected"; transferId: string; reason: string };

function randomTransferId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `x_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function encodePayload(value: string): Promise<{ encoding: "gzip" | "raw"; data: string }> {
  const input = new TextEncoder().encode(value);
  if (typeof CompressionStream !== "undefined") {
    try {
      const stream = new Blob([arrayBuffer(input)]).stream().pipeThrough(new CompressionStream("gzip"));
      return { encoding: "gzip", data: bytesToBase64(new Uint8Array(await new Response(stream).arrayBuffer())) };
    } catch { /* The embedded browser may not expose gzip compression. */ }
  }
  return { encoding: "raw", data: bytesToBase64(input) };
}

async function decodePayload(value: string, encoding: "gzip" | "raw"): Promise<string> {
  const input = base64ToBytes(value);
  if (encoding === "gzip") {
    if (typeof DecompressionStream === "undefined") throw new Error("GZIP_NOT_SUPPORTED");
    const stream = new Blob([arrayBuffer(input)]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  }
  return new TextDecoder().decode(input);
}

export function serializeEncounterTransferMessage(message: EncounterTransferMessage): string {
  const serialized = JSON.stringify(EncounterTransferMessageSchema.parse(message));
  if (serialized.length > TALESPIRE_MESSAGE_CHARACTER_LIMIT) {
    throw new Error(`TRANSFER_MESSAGE_TOO_LONG:${serialized.length}`);
  }
  return serialized;
}

export function parseEncounterTransferMessage(raw: string): EncounterTransferMessage | null {
  try {
    const result = EncounterTransferMessageSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function encounterTransferRequest(encounterId: string, revision: number | null, checksum: string | null): string {
  return serializeEncounterTransferMessage({
    p: ENCOUNTER_TRANSFER_PROTOCOL, v: ENCOUNTER_TRANSFER_VERSION,
    t: "req", e: encounterId, r: revision, c: checksum,
  });
}

export async function buildEncounterTransfer(encounter: Encounter): Promise<BuiltEncounterTransfer> {
  const normalized = EncounterSchema.parse(encounter);
  const snapshot = projectPublicEncounter(normalized);
  const checksum = await checksumJson(JSON.parse(JSON.stringify(snapshot)));
  const encoded = await encodePayload(JSON.stringify(snapshot));
  const transferId = randomTransferId();
  const chunks = Array.from(
    { length: Math.max(1, Math.ceil(encoded.data.length / CHUNK_DATA_CHARACTERS)) },
    (_, index) => encoded.data.slice(index * CHUNK_DATA_CHARACTERS, (index + 1) * CHUNK_DATA_CHARACTERS),
  );
  const messages = [
    serializeEncounterTransferMessage({
      p: ENCOUNTER_TRANSFER_PROTOCOL, v: ENCOUNTER_TRANSFER_VERSION,
      t: "start", x: transferId, e: normalized.id, r: normalized.revision,
      c: checksum, n: chunks.length, z: encoded.encoding,
    }),
    ...chunks.map((data, index) => serializeEncounterTransferMessage({
      p: ENCOUNTER_TRANSFER_PROTOCOL, v: ENCOUNTER_TRANSFER_VERSION,
      t: "chunk", x: transferId, i: index, n: chunks.length, d: data,
    })),
    serializeEncounterTransferMessage({
      p: ENCOUNTER_TRANSFER_PROTOCOL, v: ENCOUNTER_TRANSFER_VERSION,
      t: "end", x: transferId,
    }),
  ];
  return { transferId, encounterId: normalized.id, revision: normalized.revision, checksum, messages };
}

export function projectPublicEncounter(encounter: Encounter): PublicEncounterSnapshot {
  return PublicEncounterSnapshotSchema.parse({
    schemaVersion: 1,
    id: encounter.id,
    revision: encounter.revision,
    round: encounter.round,
    activeCombatantId: encounter.activeCombatantId,
    combatants: orderedCombatants(encounter).map((combatant) => ({
      id: combatant.id,
      name: combatant.kind === "player" ? combatant.name : "",
      player: combatant.kind === "player",
      visible: combatant.visibleToPlayers,
      bloodied: combatant.kind === "monster" && isBloodied(combatant),
    })),
  });
}

interface Assembly {
  start: EncounterTransferStart;
  chunks: Map<number, string>;
}

export class EncounterTransferAssembler {
  private readonly assemblies = new Map<string, Assembly>();

  async accept(message: EncounterTransferMessage): Promise<EncounterTransferAssemblyResult> {
    if (message.t === "start") {
      this.assemblies.set(message.x, { start: message, chunks: new Map() });
      return { kind: "pending" };
    }
    if (message.t === "chunk") {
      const assembly = this.assemblies.get(message.x);
      if (!assembly || message.n !== assembly.start.n || message.i >= message.n) {
        return { kind: "rejected", transferId: message.x, reason: "Fragmento sin cabecera o numeración inválida." };
      }
      assembly.chunks.set(message.i, message.d);
      return { kind: "pending" };
    }
    if (message.t !== "end") return { kind: "pending" };
    const assembly = this.assemblies.get(message.x);
    if (!assembly) return { kind: "rejected", transferId: message.x, reason: "Final de transferencia desconocida." };
    this.assemblies.delete(message.x);
    if (assembly.chunks.size !== assembly.start.n) {
      return { kind: "rejected", transferId: message.x, reason: `Faltan fragmentos: ${assembly.chunks.size}/${assembly.start.n}.` };
    }
    try {
      const encoded = Array.from({ length: assembly.start.n }, (_, index) => assembly.chunks.get(index) ?? "").join("");
      const raw = await decodePayload(encoded, assembly.start.z);
      const encounter = PublicEncounterSnapshotSchema.parse(JSON.parse(raw));
      const checksum = await checksumJson(JSON.parse(JSON.stringify(encounter)));
      if (encounter.id !== assembly.start.e || encounter.revision !== assembly.start.r || checksum !== assembly.start.c) {
        return { kind: "rejected", transferId: message.x, reason: "El checksum o la identidad del encuentro no coincide." };
      }
      return { kind: "complete", transferId: message.x, encounter, checksum };
    } catch (error) {
      return { kind: "rejected", transferId: message.x, reason: error instanceof Error ? error.message.slice(0, 120) : "Snapshot inválido." };
    }
  }
}
