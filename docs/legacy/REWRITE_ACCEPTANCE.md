# Rewrite acceptance baseline

The v2 implementation may reorganize internal behavior completely, but it must
not silently discard existing capabilities or data.

## Compatibility gates

Before v2 becomes the default it must demonstrate:

- all anonymized v1 fixtures migrate without data loss;
- the real campaign can be validated in read-only migration mode;
- a migrated character can be loaded, edited, saved and loaded again;
- all player sections in the feature inventory have an implemented decision:
  migrated, intentionally redesigned, or explicitly deferred;
- all GM sections have the same decision record;
- every manifest callback is handled by the new TaleSpire bridge;
- character import/export has a defined v1 compatibility policy;
- bundled English/Spanish data remains accessible;
- storage quota and failure states are surfaced to the user;
- rollback to the untouched v1 backup is possible.

## Data invariants

- Character and nested entity identities do not depend on displayed names or
  array positions.
- Persisted source values and derived values are distinguishable.
- No save can overwrite a newer local revision without detecting it.
- A failed write leaves the last valid document readable.
- Unknown v1 fields survive migration.
- Serialization is deterministic so equivalent state produces the same hash.

## Test layers expected for v2

1. Pure domain tests for calculations and character operations.
2. Migration tests against synthetic and anonymized v1 fixtures.
3. Repository tests with a fake TaleSpire blob adapter.
4. Protocol simulations with duplicate, delayed, missing and reordered
   messages.
5. UI component tests for editable sections.
6. Manual smoke tests inside TaleSpire for injected API behavior.

## Stage 1 completion criteria

- Documentation in `docs/legacy` is reviewed as the initial behavioral map.
- Synthetic campaign/global fixtures parse and round-trip.
- Characterization tests pass without loading TaleSpire.
- Existing runtime files and storage blobs remain untouched.
