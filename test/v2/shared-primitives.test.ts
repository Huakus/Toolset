import { describe, expect, it } from "vitest";
import { checksumJson } from "../../src/shared/hash";
import { createDeterministicId, STABLE_ID_PATTERN } from "../../src/shared/id";
import { canonicalJsonStringify, type JsonValue } from "../../src/shared/json";

describe("deterministic JSON primitives", () => {
  it("sorts object keys recursively without reordering arrays", () => {
    const first: JsonValue = {
      z: 1,
      nested: { second: 2, first: 1 },
      list: [{ b: 2, a: 1 }, "tail"],
      a: 0,
    };
    const second: JsonValue = {
      a: 0,
      list: [{ a: 1, b: 2 }, "tail"],
      nested: { first: 1, second: 2 },
      z: 1,
    };

    expect(canonicalJsonStringify(first)).toBe(canonicalJsonStringify(second));
  });

  it("produces the same checksum for equivalent JSON", async () => {
    await expect(checksumJson({ b: 2, a: 1 })).resolves.toBe(
      await checksumJson({ a: 1, b: 2 }),
    );
  });

  it("creates stable namespaced identifiers", async () => {
    const first = await createDeterministicId("chr", "campaign", "Personaje");
    const second = await createDeterministicId("chr", "campaign", "Personaje");
    const other = await createDeterministicId("chr", "campaign", "Otro");

    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).toMatch(STABLE_ID_PATTERN);
  });
});
