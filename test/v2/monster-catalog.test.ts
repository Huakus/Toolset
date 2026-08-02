import { describe, expect, it } from "vitest";
import { findMonsterDefinition, monsterDefinitions, normalizeMonsterDefinition } from "../../src/domain/monsters/monster-catalog";

describe("monster catalog", () => {
  it("normalizes combat statistics and action text", () => {
    const monster = normalizeMonsterDefinition({
      Id: "Lobo",
      Name: "Lobo",
      Type: "Bestia",
      Challenge: "1/4",
      HP: { Value: 11, Notes: "(2d8+2)" },
      AC: { Value: 13, Notes: "" },
      InitiativeModifier: 2,
      InitiativeAdvantage: true,
      Speed: ["40 pies"],
      Abilities: { Fue: 12, Des: 15 },
      Actions: [{ Name: "Mordisco", Content: "Impacto: 7 (2d4+2) perforante.", Usage: "" }],
    });
    expect(monster).toMatchObject({
      id: "Lobo",
      hitPoints: 11,
      hitPointFormula: "2d8+2",
      armorClass: 13,
      initiativeModifier: 2,
      actions: [{ name: "Mordisco", content: expect.stringContaining("2d4+2") }],
    });
  });

  it("keeps legacy CR and quick actions usable", () => {
    const monster = normalizeMonsterDefinition({
      Name: "Autómata", CR: "3", HP: { Value: 20 }, AC: { Value: 15 },
      QuickAction: [{ Name: "Golpe", ToHit: "1d20+5", Damage: "1d8+3", DamageType: "fuerza" }],
    });
    expect(monster.challenge).toBe("3");
    expect(monster.actions[0]).toMatchObject({ name: "Golpe", content: expect.stringContaining("1d8+3") });
  });

  it("exposes searchable bundled monster definitions", () => {
    expect(monsterDefinitions().length).toBeGreaterThan(100);
    const first = monsterDefinitions()[0]!;
    expect(findMonsterDefinition(first.name)?.name).toBe(first.name);
  });
});
