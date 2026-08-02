# Legacy feature inventory

This inventory describes behavior visible in the current source. Items marked
as derived are calculated from other character values but are also represented
in the persisted v1 document.

## Player character sheet

### Character lifecycle

- select an existing campaign character;
- create a new character;
- load all saved character data into the page;
- autosave the active character after editable controls lose focus;
- import/export character JSON;
- convert imported D&D Beyond data;
- open the separate character creator;
- link a selected TaleSpire mini thumbnail.

### Statistics and resources

- name, class, level and XP;
- six ability scores and modifiers;
- skills and saving throw proficiency states;
- armor class, speed, initiative and proficiency bonus;
- current, maximum and temporary hit points;
- damage and healing controls;
- death saves, inspiration, exhaustion and conditions;
- hit dice, short rests and long rests;
- passive perception, investigation and insight (derived);
- weapon, armor, language and tool proficiencies;
- advantage/normal/disadvantage roll mode.

### Actions and rolling

- editable action rows;
- action categories and filters;
- proficiency, reach, to-hit, damage, damage type and descriptive data;
- dice parsing, TaleSpire tray integration and result submission;
- action settings connected to inventory items.

### Spells

- spellcasting ability, to-hit and save DC;
- spell level filter;
- cantrips and levels 1 through 9;
- known/prepared spells and spell slots;
- spell lookup from bundled English/Spanish datasets;
- custom spell import/export and global persistence;
- optional upcasting display.

### Inventory and currency

- equipment, backpack, other possessions and attunement groups;
- item lookup from bundled English/Spanish datasets;
- quantity, weight, cost, equipped state, charges and usability;
- carried-weight calculation and encumbrance display;
- copper, silver, electrum, gold and platinum;
- custom equipment import/export and global persistence.

### Free-form character content

- grouped features and traits;
- trait uses, reset rules and stat adjustments;
- grouped notes;
- alignment;
- extra creature/shape cards with hit points and conditions.

### Initiative collaboration

- request the GM initiative list;
- receive active turn and round updates;
- send initiative results and current player summary to the GM.

## GM screen

### Initiative and encounter operation

- player and monster initiative cards;
- turn and round tracking;
- request and receive player statistics;
- send health updates and initiative state;
- encounter save/load through campaign storage;
- monster lookup and monster card display.

### Reference and campaign tools

- conditions, effects and schools of magic references;
- shop editor and persisted shop data;
- travel, NPC, jumping and random-table tools;
- checklists;
- spell lookup;
- grouped GM notes stored in campaign storage;
- Google Docs section/link surface.

## Shared behavior

- navigation and modal helpers;
- English/Spanish language selection;
- 2014/alternate D&D rules version toggle;
- theme selection;
- loading bundled spell, monster and equipment datasets;
- custom spells, monsters and equipment;
- dice expression construction/evaluation;
- TaleSpire client discovery and GM discovery;
- campaign/global storage access;
- import/export helpers;
- storage usage display.

## TaleSpire integration contract

The manifest currently subscribes to:

- dice roll results;
- symbiote visibility and lifecycle state;
- creature state changes;
- sync messages and sync client events;
- board client events;
- campaign player permission events;
- chat messages.

It declares an interop ID and the `runInBackground` capability. The v2 bridge
must continue exposing every manifest callback before legacy pages can be
retired.

## Supporting utilities

- standalone character creator under `CharacterCreator/`;
- D&D Beyond converter under `D&DBeyondConverter/`;
- PowerShell workers under `.localstorage/scripts/` for character export,
  generated indexes, TaleSpire launch/close monitoring and Git synchronization;
- GitHub Actions publication of `.localstorage/ECE` to the public web host.

These utilities are part of the operational system even though they are not
executed inside the WebView.
