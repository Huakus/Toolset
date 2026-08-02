import { describe, expect, it } from "vitest";
import { resolveTaleSpireClientRole } from "../../src/infrastructure/talespire/talespire-client-role";

describe("TaleSpire client role", () => {
  it("uses the role already returned by whoAmI", async () => {
    const role = await resolveTaleSpireClientRole({
      whoAmI: async () => ({ id: "gm", clientMode: "gm" }),
      getMoreInfo: async () => { throw new Error("should not be called"); },
    });
    expect(role).toBe("gm");
  });

  it("resolves detailed client information and defaults safely to player", async () => {
    expect(await resolveTaleSpireClientRole({
      whoAmI: async () => ({ id: "gm" }),
      getMoreInfo: async () => [{ id: "gm", clientMode: "gm" }],
    })).toBe("gm");
    expect(await resolveTaleSpireClientRole({
      whoAmI: async () => ({ id: "unknown" }),
      getMoreInfo: async () => { throw new Error("unavailable"); },
    })).toBe("player");
  });
});
