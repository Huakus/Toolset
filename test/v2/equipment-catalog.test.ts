import { describe, expect, it } from "vitest";
import { createCharacter } from "../../src/domain/character/create-character";
import {
  projectAdjustedRollMode,
  projectCharacterStatistics,
  projectInventory,
} from "../../src/domain/character/character-projection";
import { findEquipmentDefinitionByName } from "../../src/domain/equipment/equipment-catalog";

describe("equipment catalog and bonuses", () => {
  it("normalizes bundled magic equipment and applies active bonuses", () => {
    const cloak = findEquipmentDefinitionByName("Cloak of Protection");
    expect(cloak).not.toBeNull();
    expect(cloak?.requiresAttunement).toBe(true);
    expect(cloak?.bonuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "saves", key: "All", value: 1 }),
      expect.objectContaining({ category: "combatStats", key: "AC", value: 1 }),
    ]));

    const base = createCharacter(
      "chr_11111111111111111111111111111111",
      "Hero",
      "2026-07-25T18:00:00.000Z",
    );
    const character = {
      ...base,
      inventory: [{
        ...cloak!,
        id: "inv_22222222222222222222222222222222",
        order: 0,
        group: "equipment",
        equipped: true,
        attuned: true,
      }],
    };
    expect(projectCharacterStatistics(character).savingThrows.strength).toBe(1);
    expect(projectInventory(character).calculatedArmorClass).toBe(11);
  });

  it("combines matching item advantage and disadvantage", () => {
    const base = createCharacter(
      "chr_33333333333333333333333333333333",
      "Hero",
      "2026-07-25T18:00:00.000Z",
    );
    const definition = findEquipmentDefinitionByName("Dagger")!;
    const character = {
      ...base,
      inventory: [{
        ...definition,
        id: "inv_44444444444444444444444444444444",
        order: 0,
        group: "equipment",
        equipped: true,
        bonuses: [{ category: "skills", key: "Perception", value: 0, advantage: true, disadvantage: false }],
      }],
    };
    expect(projectAdjustedRollMode(character, "skills", ["Perception"], "normal")).toBe("advantage");
  });

  it("applies condition roll modes and cancels opposing advantage", () => {
    const base = createCharacter(
      "chr_55555555555555555555555555555555",
      "Hero",
      "2026-07-25T18:00:00.000Z",
    );
    const poisoned = {
      ...base,
      combat: {
        ...base.combat,
        conditions: [{
          id: "con_66666666666666666666666666666666",
          key: "poisoned",
          label: "Envenenado",
          level: null,
          addedAt: "2026-07-25T18:00:00.000Z",
        }],
      },
    };
    expect(projectAdjustedRollMode(poisoned, "skills", ["Perception"], "normal")).toBe("disadvantage");
    expect(projectAdjustedRollMode(poisoned, "skills", ["Perception"], "advantage")).toBe("normal");
  });
});
