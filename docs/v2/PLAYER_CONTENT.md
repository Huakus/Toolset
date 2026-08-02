# Player traits, notes and extras

The free-form player content from v1 now has typed group and entity IDs.

## Traits

Trait groups and traits support ordering, collapsed state, descriptions,
maximum/used uses, short- or long-rest recovery and optional statistic
adjustments. Numeric adjustments migrated from v1 are marked as already
reflected in persisted values to prevent double application; newly authored
adjustments can opt into derived projections. Advantage/disadvantage effects
remain active for the matching checks, saves or attacks.

Both rest commands reset matching trait uses and item charges. Long rest also
resets spell slots, hit points, death saves and the appropriate hit dice.

## Notes

Notes retain groups, ordering, collapsed state, title, body and tags. Group and
note operations have the same checksum/revision protection as all other
character edits.

## Extras

Pets, wild shapes and polymorph forms have stable IDs, hit points, temporary
hit points, conditions and a portable JSON stat block. The bundled English and
Spanish monster manuals can hydrate a card by name. Damage consumes temporary
hit points first; healing is capped at maximum hit points.
