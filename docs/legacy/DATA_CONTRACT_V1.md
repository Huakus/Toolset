# Data contract v1

## Physical storage

The TaleSpire API exposes two string blobs for this symbiote:

- campaign storage: data scoped to the active campaign;
- global storage: data shared by this installation across campaigns.

Both blobs contain pretty-printed JSON. Every save performs a complete blob
read and complete blob write.

## Campaign blob

Observed root shape:

```json
{
  "characters": {},
  "DmNotes": {},
  "Encounter Data": {}
}
```

`characters` is a dictionary keyed by the displayed character name. A rename
therefore changes identity. There is no independent character ID, schema
version, revision, owner or modification timestamp.

### Character scalar groups

The persisted object includes:

- `characterTempHp`, `currentHitDice`, `insp`, `upcastToggle`,
  `exhaustionToggle`;
- `initiativeButton`, `AC`, `speed`, `characterLevel`, `playerXP`,
  `playerClass`;
- `currentCharacterHP`, `maxCharacterHP`;
- six ability score fields;
- eighteen skill modifier fields;
- `hitDiceButton`;
- proficiency buttons `pb-1` through `pb-24`;
- `alignment`.

Many numeric values are encoded as strings while other numeric values are JSON
numbers. Consumers must preserve this mixed representation until migration.

An empty DOM id is serialized as an empty JSON property name (`""`). This is
valid JSON and is present in existing data; some non-JavaScript parsers require
special handling for it.

### Character collection groups

```text
playerWeaponProficiency   array<string>
playerArmorProficiency    array<string>
playerLanguageProficiency array<string>
playerToolsProficiency    array<string>
conditions                array<object>
coins                     object { cp, sp, ep, gp, pp }
actionTable               array<object keyed by row number>
spellData                 object keyed by spell level
inventoryData             object keyed by bag/category
groupTraitData            array<group>
groupNotesData            array<group>
extrasData                array<creature card>
```

Inventory items usually have `uniqueId`, but other nested objects—spells,
traits, notes, groups and action rows—do not consistently have stable IDs.
Action rows are positional and use legacy column names such as `secondColumn`,
`elventhColumn` and `twelvethColumn`.

Spell preparation values occur as booleans, numeric strings and textual
booleans depending on the path that created the data.

## Global blob

Observed root keys:

```text
language
Custom Equipment
npcList
checklists
encounters
loot
travel-1
ThemeSettings
Custom Spells
effectsSection
Custom Monsters
Shop Data
```

The shared storage helpers treat each key as a `dataType` dictionary keyed by a
`dataId`. Some GM tools also depend on legacy keys that overlap conceptually
with campaign data, such as encounters.

## Required migration properties

A v2 migration must:

1. parse empty property names and mixed primitive types without data loss;
2. preserve every unknown field for forward compatibility;
3. assign stable IDs without using character names as identity;
4. assign stable IDs to nested mutable entities;
5. separate authored values from derived values without changing displayed
   results;
6. retain an untouched v1 backup until v2 has been read back and validated;
7. be idempotent—running migration again must not duplicate entities;
8. expose a schema version and migration provenance.
