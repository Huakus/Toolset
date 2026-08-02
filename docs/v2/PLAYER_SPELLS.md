# Player spells

V2 replaces the positional `spellData` object with typed spell entities and a
validated slot ledger. Migration resolves legacy spell names against both
bundled English and Spanish catalogs; unresolved names remain editable and no
legacy row is discarded.

The player sheet supports:

- spellcasting ability, derived attack modifier and save DC, including active
  equipment bonuses;
- cantrips and spell levels 1–9, preparation state and level filters;
- editable maximum/used slots and checked slot expenditure;
- casting at a higher level, concentration tracking and long-rest reset;
- cantrip damage scaling at character levels 5, 11 and 17;
- higher-level damage expressions;
- full custom spell authoring from the same fields as the legacy creator;
- catalog hydration, JSON import/export and TaleSpire/browser dice rolls.

Every spell and slot mutation checks campaign checksum and character revision.
Custom spell definitions are embedded in the character document so they remain
portable. They are also saved in TaleSpire global storage and merged into the
selected bilingual/rules-version catalog for reuse by other characters.
