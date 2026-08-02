import { sha256Hex } from "./hash";

export const STABLE_ID_PATTERN = /^[a-z][a-z0-9-]*_[a-f0-9]{32}$/;

export async function createDeterministicId(
  kind: string,
  ...parts: readonly string[]
): Promise<string> {
  if (!/^[a-z][a-z0-9-]*$/.test(kind)) {
    throw new Error(`INVALID_ID_KIND:${kind}`);
  }

  const framedParts = parts.map((part) => `${part.length}:${part}`).join("|");
  const digest = await sha256Hex(`${kind}|${framedParts}`);
  return `${kind}_${digest.slice(0, 32)}`;
}

export async function createRandomId(kind: string): Promise<string> {
  const randomBytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(randomBytes);
  const entropy = [...randomBytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return createDeterministicId(kind, entropy);
}
