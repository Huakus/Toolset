# Player inventory and equipment

The v2 player sheet stores inventory as named, validated entities with stable
IDs. Every item records its group, quantity, unit weight, cost, equipment
state, attunement state, usability, charges and the weapon/armor data needed to
derive actions and armor class. The untouched v1 object is also retained in
`legacyData` so migration never discards custom fields.

## Legacy weight correction

V1 persisted the row's displayed weight after multiplying by quantity. V2
divides that value by the positive quantity during migration and stores the
result as `unitWeight`; carried weight is always derived as
`sum(unitWeight * quantity)`. Capacity follows the legacy rule:
`Strength * 15 + active CarryWeightBonus`.

## Atomic equipment behavior

- removing an item also removes actions linked to it;
- unequipping a weapon removes its generated action;
- equipping a weapon creates one linked action when none exists;
- equipped objects always have quantity one; equipping one unit from a stack
  creates a separate equipped entry and leaves the remaining stack stored;
- wearable slots (body, head, feet, back, hands, waist, neck and shield)
  replace an already equipped object in the same slot;
- weapons and shields consume hands, with a maximum of two; two-handed weapons
  consume both hands;
- unequipping an attuned item also breaks attunement;
- at most three items can be attuned, and an item must require attunement and
  be equipped first;
- non-consumable objects can only be used while equipped; consumables can be
  used directly from inventory;
- usable charged items spend charges, while consumables spend quantity;
- quantity controls mutate stored stacks directly; adding a unit beside an
  equipped object creates or grows its stored stack;
- transfers always arrive unequipped and merge into a compatible destination
  stack when possible;
- long-rest item charges reset as part of the same character operation.

Every command checks both the campaign checksum and character revision before
the updated campaign is persisted.

The editor can hydrate objects from the bundled English/Spanish catalogs,
author structured bonuses, and import/export JSON. Custom definitions are
saved to TaleSpire global storage without replacing unrelated legacy global
settings, then become available to every character.

## Compact inventory interface

The play sheet lists equipped objects first and sorts each section
alphabetically. Search and property filters combine with AND semantics. The
optional catalog mode shows definitions not owned by the character as disabled
cards whose only action is adding the object. Descriptions share the global
show/hide and per-card expand behavior used by actions and spells.

Each object card exposes quantity controls and a contextual transfer menu.
Categories use muted semantic colors, while carried weight uses the same
vertical meter dimensions as hit points. The header currency summary uses a
distinct icon and color for platinum, gold, electrum, silver and copper.
