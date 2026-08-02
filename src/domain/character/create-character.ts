import { createDefaultCharacterChecks } from "./character-checks";
import { createDefaultSpellSlots } from "./character-spell-model";
import { CharacterV2Schema, IsoTimestampSchema, StableIdSchema, type CharacterV2 } from "./character-v2";

const characterColors = ["#d9bd73", "#5fb3b3", "#c982a6", "#7f9ed6", "#d4875f", "#79ad67", "#a88bd4", "#d16f6f"] as const;

export function characterColorForId(id: string): string {
  const hash = [...id].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 0);
  return characterColors[hash % characterColors.length]!;
}

export function createCharacter(
  idInput: string,
  nameInput: string,
  createdAtInput: string,
): CharacterV2 {
  const id = StableIdSchema.parse(idInput);
  const name = nameInput.trim();
  if (!name) throw new Error("Character name is required");
  const createdAt = IsoTimestampSchema.parse(createdAtInput);
  return CharacterV2Schema.parse({
    schemaVersion: 2,
    id,
    revision: 0,
    name,
    color: characterColorForId(id),
    identity: { className: "", level: 1, experience: 0, alignment: "" },
    abilities: { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 },
    combat: {
      armorClass: 10,
      speed: "30 ft",
      initiative: "+0",
      hitPoints: { current: 1, maximum: 1, temporary: 0 },
      hitDice: { current: "1", formula: "1d8", remaining: 1, maximum: 1, dieSize: 8 },
      deathSaves: { successes: 0, failures: 0 },
      conditions: [],
      inspiration: false,
      exhaustion: 0,
    },
    proficiencies: { weapons: [], armor: [], languages: [], tools: [] },
    checks: createDefaultCharacterChecks(),
    actions: [], inventory: [], traits: [], notes: [], extras: [], taleSpire: null,
    currency: { copper: 0, silver: 0, electrum: 0, gold: 0, platinum: 0 },
    spellcasting: {
      ability: null, selectedLevel: null, levels: {}, showUpcast: false,
      attackBonus: 0, saveDcBonus: 0, favoriteSpells: [], spells: [], slots: createDefaultSpellSlots(),
    },
    collections: { conditions: [], actions: [], spells: [], inventory: [], traits: [], notes: [], extras: [] },
    legacy: { sourceKey: name, unmapped: {} },
    metadata: { createdAt, updatedAt: createdAt, migratedFrom: "native" },
  });
}
