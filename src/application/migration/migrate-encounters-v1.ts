import { EncounterSchema, type Encounter } from "../../domain/encounter/encounter-model";
import { createDeterministicId } from "../../shared/id";
import type { JsonValue } from "../../shared/json";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function integer(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function boolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

export async function migrateLegacyEncounters(
  campaignIdentity: string,
  input: JsonValue | null,
  migratedAt: string,
): Promise<Record<string, Encounter>> {
  const entries = await Promise.all(Object.entries(object(input)).map(async ([encounterName, rawEncounter]) => {
    if (!Array.isArray(rawEncounter)) return null;
    const encounterId = await createDeterministicId("enc", campaignIdentity, encounterName);
    const combatants = await Promise.all(rawEncounter.map(async (rawCombatant, order) => {
      const data = object(rawCombatant);
      const monster = integer(data.isMonster) === 1;
      const custom = !monster && boolean(data.isCustom);
      const name = text(data.name, monster ? `Monstruo ${order + 1}` : `Combatiente ${order + 1}`);
      const combatantId = await createDeterministicId("cmb", campaignIdentity, encounterName, String(order), name);
      const hp = object(data.hp);
      const current = Math.max(0, integer(monster ? data.currentHp : hp.current));
      const maximum = Math.max(current, Math.max(0, integer(monster ? data.maxHp : hp.max, current)));
      const conditionLabels = monster && Array.isArray(data.conditions)
        ? data.conditions.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
      const conditions = await Promise.all(conditionLabels.map(async (label, index) => ({
        id: await createDeterministicId("cnd", combatantId, String(index), label),
        key: label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "legacy",
        label,
        level: null,
        addedAt: migratedAt,
      })));
      const base = {
        id: combatantId,
        name,
        initiative: data.init === "" || data.init === undefined ? null : integer(data.init),
        order,
        armorClass: monster ? null : Math.max(0, integer(data.ac)),
        hitPoints: { current, maximum, temporary: Math.max(0, integer(monster ? data.tempHp : 0)) },
        conditions,
        visibleToPlayers: monster ? !boolean(data.isClosed) : true,
      };
      if (monster) return { ...base, kind: "monster" as const, monsterDefinitionId: name };
      if (custom) return { ...base, kind: "custom" as const };
      return { ...base, kind: "player" as const, characterId: null, taleSpireClientId: text(data.talespireId) || null };
    }));
    return EncounterSchema.parse({
      schemaVersion: 1,
      id: encounterId,
      revision: 0,
      name: encounterName,
      round: 1,
      activeCombatantId: null,
      combatants,
      metadata: { createdAt: migratedAt, updatedAt: migratedAt },
    });
  }));
  return Object.fromEntries(entries.filter((entry): entry is Encounter => entry !== null).map((entry) => [entry.id, entry]));
}
