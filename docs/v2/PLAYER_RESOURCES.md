# Player sheet: statistics and combat resources

This is the first functional player-sheet slice. Persisted authored state and
derived projections are now separate.

## Authored state

- six ability scores;
- level and experience;
- current, maximum and temporary hit points;
- hit-die size, maximum and remaining dice;
- death-save successes and failures;
- inspiration and exhaustion;
- stable condition entities.

## Derived values

- ability modifiers;
- proficiency bonus by character level;
- base initiative modifier from Dexterity.

Derived values are calculated by `character-projection.ts`; they are not
written as independent sources that can drift away from the ability scores.

## Resource commands

- damage consumes temporary HP first and never reduces current HP below zero;
- concentration damage reports the required Constitution save DC;
- healing is capped at maximum HP and clears death saves after HP is restored;
- temporary HP grants keep the greater value;
- hit dice cannot be spent beyond the available amount;
- long rest restores HP, clears temporary HP and death saves, recovers half of
  maximum hit dice (minimum one), and lowers exhaustion by one;
- conditions can be added or removed by stable ID.

Every command validates the expected character revision and is persisted
through the campaign checksum boundary.

Long rest also restores spell slots and long-rest trait/item uses; short rest
restores its matching trait/item uses in the same checked character mutation.
The editor states this after a long rest rather than pretending those resources
were reset.
