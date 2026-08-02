# Player sheet parity record

This is the implemented decision record for every player-facing capability in
the legacy inventory. “Redesigned” means the behavior is present with a new
data model or interaction, rather than by retaining the legacy DOM scripts.

| Legacy area | V2 decision | Verification |
| --- | --- | --- |
| Select, create, delete and autosave characters | Implemented | Native campaign/character factories, checked revisions and lifecycle tests |
| Character JSON import/export | Implemented | V2 documents and legacy single-character/map formats are accepted |
| D&D Beyond conversion | Redesigned | Boundary converter plus fixture test |
| Guided character creator | Redesigned | Creator output is copied and imported through the v2 clipboard bridge |
| TaleSpire miniature link and thumbnail | Implemented | Typed creature/content-pack adapter |
| Identity, abilities, XP, combat statistics | Implemented | Typed core editor and projections |
| Skills, saves, passives and proficiencies | Implemented | Rank, bonus and roll-mode editor; weapon/armor/language/tool lists |
| HP, temporary HP, death saves and concentration | Implemented | Domain resource commands and tests |
| Inspiration, exhaustion, conditions and effects | Implemented | Persistent resources; condition-driven roll modes and Bless/Bane/Guidance dice |
| Hit dice, short rest and long rest | Implemented | Atomic resource resets including traits, charges and slots |
| Actions, filters and linked weapons | Implemented | Typed CRUD, equipment action generation and projected attack/damage |
| Browser and TaleSpire dice | Implemented | Local evaluator, TaleSpire tray/result callbacks and tests |
| Spellcasting, slots, preparation and upcasting | Implemented | Levels 0–9, bilingual catalog, custom definitions and projections |
| Inventory groups, equipment, attunement and charges | Implemented | Typed CRUD, bilingual catalog, use/equip/attune and automatic armor/action effects |
| Weight, encumbrance, currency and bonuses | Implemented | Derived weight/capacity/AC and active item adjustments |
| Custom spell/equipment import, export and global reuse | Implemented | Global TaleSpire blob adapter preserves unrelated legacy settings |
| Grouped traits and rest uses | Implemented | Typed groups, adjustments and reset rules |
| Grouped notes and alignment | Implemented | Typed groups plus core alignment field |
| Pets, shapes and extra creature cards | Implemented | Bilingual bestiary hydration, HP and conditions |
| GM initiative list, turn, round and player summary | Implemented | Legacy-compatible sync messages with automatic initiative result relay |
| Language data, rules version and theme preferences | Redesigned | Catalog language/rules filters and persistent dark/light preference |
| Play/Edit interface and section navigation | Redesigned | Persistent character header, eight tabs, compact play projections and complete per-section editors |
| Character colors, dense filters and active-effect summary | Redesigned | Persisted color/effect fields, counted action/spell/inventory filters and compact collection rows |
| Storage quota, conflicts and failures | Implemented | Capacity errors, checksums, character revisions and read-back verification |
| Manifest subscription surface | Implemented | All declared callbacks are exposed; relevant dice/sync/client callbacks route to adapters |

The GM screen is now complete; see `GM_PARITY.md`. The distributed character
operation journal/reconciliation protocol and external Git-worker retirement
remain later roadmap stages.
