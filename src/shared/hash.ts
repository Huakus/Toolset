import { canonicalJsonStringify, type JsonValue } from "./json";

const textEncoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? textEncoder.encode(value) : value;
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    digestInput.buffer,
  );
  return bytesToHex(new Uint8Array(digest));
}

export async function checksumJson(value: JsonValue): Promise<string> {
  return sha256Hex(canonicalJsonStringify(value));
}
