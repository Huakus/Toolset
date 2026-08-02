import type { SpellDefinition } from "../../domain/character/character-spell-model";
import type { EquipmentCatalogDraft } from "../../domain/equipment/equipment-catalog";
import { normalizeEquipmentDefinition } from "../../domain/equipment/equipment-catalog";
import { normalizeSpellDefinition } from "../../domain/spells/spell-catalog";
import { JsonObjectSchema, type JsonObject, type JsonValue } from "../../shared/json";
import type { TaleSpireBlobApi } from "./talespire-campaign-blob-store";
import { normalizeMonsterDefinition, type MonsterDefinition } from "../../domain/monsters/monster-catalog";
import { defaultExclusiveLock, type ExclusiveLock } from "../persistence/exclusive-lock";
import { normalizeChecklistItem, normalizeShop, type GmChecklistItem, type GmShop } from "../../domain/gm/gm-global-content";

export interface GlobalCustomContent {
  spells: SpellDefinition[];
  equipment: EquipmentCatalogDraft[];
  monsters: MonsterDefinition[];
  shops: GmShop[];
  checklist: GmChecklistItem[];
}

function object(value: JsonValue | undefined): JsonObject {
  return value !== null && value !== undefined && !Array.isArray(value) && typeof value === "object" ? value : {};
}

function safeNormalize<T>(values: JsonValue[], normalize: (value: unknown) => T): T[] {
  const output: T[] = [];
  for (const value of values) {
    try { output.push(normalize(value)); } catch { /* Preserve malformed legacy entries in the blob but omit them from the catalog. */ }
  }
  return output;
}

export class TaleSpireGlobalContentStore {
  constructor(private readonly api: TaleSpireBlobApi, private readonly lock: ExclusiveLock = defaultExclusiveLock) {}

  async load(): Promise<GlobalCustomContent> {
    const root = await this.readRoot();
    return {
      spells: safeNormalize(Object.values(object(root["Custom Spells"])), normalizeSpellDefinition),
      equipment: safeNormalize(Object.values(object(root["Custom Equipment"])), normalizeEquipmentDefinition),
      monsters: safeNormalize(Object.values(object(root["Custom Monsters"])), normalizeMonsterDefinition).filter((monster) => monster.name),
      shops: Object.entries(object(root["Shop Data"])).map(([name, value]) => normalizeShop(name, value)),
      checklist: Object.entries(object(root.checklists)).flatMap(([id, value]) => {
        try { return [normalizeChecklistItem(id, value)]; } catch { return []; }
      }),
    };
  }

  async saveSpell(definition: SpellDefinition, previousKey: string | null = null): Promise<void> {
    await this.replaceCollectionEntry("Custom Spells", definition.name, definition as unknown as JsonObject, previousKey);
  }

  async saveEquipment(definition: EquipmentCatalogDraft, previousKey: string | null = null): Promise<void> {
    await this.replaceCollectionEntry("Custom Equipment", definition.name, definition as unknown as JsonObject, previousKey);
  }

  deleteSpell(key: string): Promise<void> { return this.deleteCollectionEntry("Custom Spells", key); }
  deleteEquipment(key: string): Promise<void> { return this.deleteCollectionEntry("Custom Equipment", key); }

  async saveShop(shop: GmShop, previousKey: string | null = null): Promise<void> {
    await this.lock.run("talespire-global-content", async () => {
      const root = await this.readRoot();
      const collection = { ...object(root["Shop Data"]) };
      if (previousKey && previousKey !== shop.name) delete collection[previousKey];
      collection[shop.name] = shop.categories;
      root["Shop Data"] = collection;
      await this.api.setBlob(JSON.stringify(root));
    });
  }

  deleteShop(key: string): Promise<void> { return this.deleteCollectionEntry("Shop Data", key); }

  async saveChecklistItem(item: GmChecklistItem): Promise<void> {
    await this.updateCollection("checklists", item.id, { text: item.text, checked: item.checked });
  }

  deleteChecklistItem(key: string): Promise<void> { return this.deleteCollectionEntry("checklists", key); }

  async saveMonster(definition: MonsterDefinition, previousKey: string | null = null): Promise<void> {
    await this.lock.run("talespire-global-content", async () => {
      const root = await this.readRoot();
      const collection = { ...object(root["Custom Monsters"]) };
      if (previousKey && previousKey !== definition.name) delete collection[previousKey];
      collection[definition.name] = this.serializeMonster(definition);
      root["Custom Monsters"] = collection;
      await this.api.setBlob(JSON.stringify(root));
      const verified = object((await this.readRoot())["Custom Monsters"])[definition.name];
      if (!verified || normalizeMonsterDefinition(verified).name !== definition.name) {
        throw new Error(`No se pudo verificar el guardado global de ${definition.name}.`);
      }
    });
  }

  async deleteMonster(key: string): Promise<void> {
    await this.lock.run("talespire-global-content", async () => {
      const root = await this.readRoot();
      const collection = { ...object(root["Custom Monsters"]) };
      delete collection[key];
      root["Custom Monsters"] = collection;
      await this.api.setBlob(JSON.stringify(root));
      if (object((await this.readRoot())["Custom Monsters"])[key] !== undefined) {
        throw new Error(`No se pudo verificar la eliminación global de ${key}.`);
      }
    });
  }

  private async updateCollection(collection: string, key: string, value: JsonObject): Promise<void> {
    await this.lock.run("talespire-global-content", async () => {
      const root = await this.readRoot();
      root[collection] = { ...object(root[collection]), [key]: value };
      await this.api.setBlob(JSON.stringify(root));
    });
  }

  private async replaceCollectionEntry(collectionName: string, key: string, value: JsonObject, previousKey: string | null): Promise<void> {
    await this.lock.run("talespire-global-content", async () => {
      const root = await this.readRoot();
      const collection = { ...object(root[collectionName]) };
      if (previousKey && previousKey !== key) delete collection[previousKey];
      collection[key] = value;
      root[collectionName] = collection;
      await this.api.setBlob(JSON.stringify(root));
    });
  }

  private async deleteCollectionEntry(collectionName: string, key: string): Promise<void> {
    await this.lock.run("talespire-global-content", async () => {
      const root = await this.readRoot();
      const collection = { ...object(root[collectionName]) };
      delete collection[key];
      root[collectionName] = collection;
      await this.api.setBlob(JSON.stringify(root));
    });
  }

  private serializeMonster(definition: MonsterDefinition): JsonObject {
    return {
      ...definition.legacyData,
      Id: definition.id || definition.name,
      Name: definition.name,
      Source: "Homebrew",
      Type: definition.type,
      Challenge: definition.challenge,
      CR: definition.challenge,
      HP: { Value: definition.hitPoints, Notes: definition.hitPointFormula ? `(${definition.hitPointFormula})` : "" },
      AC: { Value: definition.armorClass, Notes: "" },
      InitiativeModifier: definition.initiativeModifier,
      InitiativeAdvantage: definition.initiativeAdvantage,
      Speed: definition.speed,
      Abilities: definition.abilities,
      Saves: definition.saves,
      Skills: definition.skills,
      Senses: definition.senses,
      Languages: definition.languages,
      DamageVulnerabilities: definition.damageVulnerabilities,
      DamageResistances: definition.damageResistances,
      DamageImmunities: definition.damageImmunities,
      ConditionImmunities: definition.conditionImmunities,
      Traits: definition.traits.map((entry) => ({ Name: entry.name, Content: entry.content, Usage: entry.usage })),
      Actions: definition.actions.map((entry) => ({ Name: entry.name, Content: entry.content, Usage: entry.usage })),
      Reactions: definition.reactions.map((entry) => ({ Name: entry.name, Content: entry.content, Usage: entry.usage })),
      LegendaryActions: definition.legendaryActions.map((entry) => ({ Name: entry.name, Content: entry.content, Usage: entry.usage })),
    };
  }

  private async readRoot(): Promise<JsonObject> {
    const raw = await this.api.getBlob();
    if (typeof raw !== "string" || raw.length === 0) return {};
    const parsed = JsonObjectSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error("El almacenamiento global de TaleSpire no contiene un objeto JSON válido.");
    return parsed.data;
  }
}
