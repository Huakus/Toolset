# Known legacy risks

This register captures risks that should guide replacement order. It does not
attempt to fix them during the characterization stage.

| Priority | Area | Observed risk | Required v2 response |
| --- | --- | --- | --- |
| Critical | Campaign persistence | Saves use an unversioned whole-blob read/modify/write cycle. Concurrent saves can overwrite unrelated newer data. | Serialized repository writes plus revision/conflict checks. |
| Critical | Identity | Character identity is the displayed name; nested mutable entities often use array positions. | Stable character/entity IDs assigned during migration. |
| Critical | Migration | The production blob has no schema version and contains mixed primitive representations and an empty property name. | Tolerant, idempotent, read-back-verified migration with untouched backup. |
| High | State ownership | The DOM is both working state and persistence source. UI changes can silently alter the storage contract. | Domain state independent from DOM rendering. |
| High | Async behavior | Several save paths do not await `setBlob`; failures and ordering are not consistently surfaced. | Awaited repository API with explicit success/failure results. |
| High | Global namespace | Large deferred scripts expose hundreds of globals; duplicate declarations make load order observable. | ES modules and a minimal manifest callback bridge. |
| High | Entrypoints | The manifest targets `index.html`, while many subscribed callback implementations live only in player/GM documents opened later. | One bootstrap that owns every callback for its full lifetime. |
| High | Duplication | Player and GM scripts carry parallel notes, monster-card, dropdown and initiative behavior. | Shared domain/use-case implementation with role-specific views. |
| Medium | Derived data | Base values and calculated modifiers are persisted together and can disagree. | Persist authored sources; calculate derived projections deterministically. |
| Medium | Validation | JSON imports and stored data are mostly trusted after parsing. | Runtime schema validation and version-aware error reporting. |
| Medium | Observability | Most failures are console-only and there is no structured operation log. | User-visible storage/sync status and structured diagnostic events. |
| Medium | Testability | Runtime source assumes a browser DOM and injected `TS` global at evaluation time. | Dependency-injected adapters and pure domain functions. |

## Replacement order implied by risk

1. Introduce a tested v2 schema and migration reader without writing data.
2. Introduce a storage repository with serialization and revision checks.
3. Introduce stable domain state and operations.
4. Replace player/GM UI sections incrementally.
5. Add synchronization only after operations and snapshots are deterministic.

The Git/GitHub workers are operationally risky while they synchronize the
mutable campaign blob, but changing them is deferred until v2 can export stable
snapshots or event segments.
