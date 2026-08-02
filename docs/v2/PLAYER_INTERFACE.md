# Player sheet interface

The player sheet has two explicit interaction modes over the same character
model and application commands:

- **Play** is the default. It presents compact readouts, dice buttons and the
  resource mutations needed during a session without exposing authoring fields.
- **Edit** exposes the complete typed editors used to author every part of the
  character. Core fields retain the debounced autosave behavior; collection
  entities retain their individual checked save commands.

The selected mode and tab are local UI preferences. They do not become part of
the campaign document and therefore cannot create campaign conflicts.

## Persistent structure

The compact character header keeps class, level, hit points, armor class,
currency and inspiration visible. The hit-point readout has extra width for its
current/maximum pair, and initiative is the compact `INIC` roll button beside
the similarly shaped Inspiration control. Currency is a read-only compact
indicator there; its denomination selector, integer amount and add/remove
buttons live in Inventory in both Play and Edit. Wealth is
calculated canonically in copper and decomposed after every operation from
platinum through gold, electrum, silver and copper, so change is made
automatically and negative total wealth is rejected. Short- and long-rest
buttons remain available at the top of every tab. Initiative is a d20 roll button in the same
strip and participates in prepared inspiration. Its title is also the campaign
character selector. Every character stores a selectable color used as the visual accent
for its sheet. Character management, campaign replacement, theme, export,
deletion and miniature linking live in the overflow menu. Language and rules
selectors are intentionally absent: the catalog UI uses Spanish 2014 data.

The sheet is split into these stable tabs:

1. Summary
2. Actions
3. Spells
4. Inventory
5. Traits
6. Notes
7. Extras
8. Initiative

Summary/Play includes HP and rest controls, conditions, abilities, skills,
saves, passive scores and proficiencies. The six abilities use one horizontal
row above the skill grid; saving throws occupy its adjacent column without
repeated section titles. All remaining Play tabs use
the same domain commands as their Edit equivalents for rolls, casting,
preparation, equipment, charges, trait uses, extra HP and conditions.

Leaving Summary/Edit, switching characters or entering Play mode submits the
core form before navigation. This prevents the navigation shell from discarding
a pending debounced autosave.

## Hit points, conditions and inspiration

The primary combat-resource strip keeps current/maximum and temporary hit
points in a small vertical water-level meter beside one control: Temporary HP,
Heal, amount and Damage. Its fill follows the current HP percentage and shifts
from green through amber to red. All three actions are disabled immediately
unless the shared amount is a positive integer.

Temporary HP follows the 2014 rules in the domain rather than behaving like
healing: grants never stack, a lower grant leaves the current value intact, a
higher grant replaces it, incoming damage consumes temporary HP first, healing
does not change it and a long rest clears it.

Summary exposes every known condition as a direct compact toggle. Active
conditions are green and sorted first; both active and inactive groups are
alphabetical, so no intermediate selector or Add action is required. Death saves have dedicated
increment-success and increment-failure buttons around a bidirectional meter:
success fills upward and failure fills downward. Both buttons stop at the first
resolved three-result side, and a Reset button clears both tracks. Hit-dice and
exhaustion readouts and the former secondary panel are intentionally omitted.

Inspiration uses one small stateful header button. Its cycle is Activate, Use
and Deactivate; both active states use a yellow fill.
Their labels switch to dark text to retain contrast against that fill.
Use arms inspiration locally for that character; the next successful d20 roll
that can benefit from inspiration is rolled with advantage and then persists
inspiration as consumed. Existing disadvantage is cancelled to a normal roll,
while an already-advantaged roll remains advantaged. Damage and other non-d20
rolls do not consume the armed inspiration. Initiative follows the same rule.

## Dense collections and effects

Actions and spell levels use horizontally scrollable filter bars with counts.
Spell levels expose known/prepared as a compact `known/prepared` pair and render
each slot as `O` (available) or `X` (used). Their label sits above the count and
the eleven level buttons share a fixed compact row without horizontal scrolling.
Known prepared spells and known cantrips form the first alphabetical group,
followed by the other known spells and finally optional catalog results.

The text search sits above the filter rows. Compact property filters cover
preparation, rituals, concentration, attacks and saving throws. Characteristic
filters are independent toggles combined with `AND`, so
for example Ritual + Concentration only shows spells with both properties. An
empty combination produces an explicit no-results panel with a reset action.

The inactive `+ Catalog` toggle adds 2014 catalog spells that the character
does not know to the searchable results. In Play, catalog entries can be
inspected and marked as favorites without exposing character-authoring actions.
Learning a spell is available only in Edit. Favorites are stored by character
independently from known spells, allowing a player to keep a shortlist before
learning them.

Each spell card keeps Prepare, Cast as, Cast, Attack and Damage controls in its
upper-right corner. Changing Cast as updates the projected damage immediately.
Only levels with an available slot are enabled and the lowest valid one is
selected automatically. Unavailable levels remain visible as disabled options
in both Play and Edit. If the current level has no usable slot, the spell card
and its cast controls become disabled while the level selector remains enabled
for inspection. A local Show/Hide descriptions preference can collapse
all card descriptions without changing campaign data. Each truncated spell
description also has a compact Read more/Read less control that expands the
full text without changing the global preference or campaign data.
Unprepared spells cannot be cast; ritual spells remain available through their
slot-free ritual option. Preparation sits beside school and level, while casting
time, range and duration share the compact name line. Inventory uses semantic filters for equipped items,
weapons, armor, consumables and usable items; Play mode renders them as dense
rows rather than large cards.

School and damage-type badges use independent semantic palettes in Play and
Edit. The mappings are meaning-based rather than arbitrary: necromancy and
necrotic damage use purple families, lightning uses electric blue, cold uses
light cyan, fire uses orange-red, poison uses green and radiant uses gold. The
redundant global spell attack and save-DC readouts are omitted; those values
remain visible only where a spell actually uses them.

Actions, Spells, Inventory and Extras omit the repeated content title because
the active tab already identifies the section in both Play and Edit modes.

Spells, inventory items and traits each store an independent short activatable
effect. Their Play views expose an Active/Inactive select. Active effects with a
description are collected in Summary without changing the underlying derived
statistics. Existing v2 documents receive empty inactive effects and a default
character color during schema parsing, so this UI change remains backward
compatible. The chosen character color drives the accent of the complete sheet,
including navigation, cards, controls and focus states.
