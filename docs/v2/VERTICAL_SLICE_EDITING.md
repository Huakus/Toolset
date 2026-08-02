# First editing vertical slice

This document records the original narrow slice. The items listed as absent
from that slice are now implemented for the player sheet except for the
distributed operation journal described at the end.

This slice proves a complete path through the new architecture:

```text
legacy JSON file
  -> tolerant migration and validation
  -> checked v2 persistence envelope
  -> load campaign snapshot
  -> edit any selected character
  -> validate domain invariants
  -> save against the loaded checksum
```

## Running it

Run `npm run dev:v2`, open the v2 page and select the legacy campaign storage
file. The file may be extensionless, as TaleSpire's `.localstorage` campaign
files are. The source file is only read by the browser file picker; it is never
rewritten.

The imported v2 campaign is stored under the browser localStorage key
`talespire-5e-toolset:v2:campaign`. Replacing an existing imported campaign
requires an explicit checkbox confirmation.

## Editing guarantees

- No character ownership rule exists: every listed character can be edited.
- Every successful edit increments both the character revision and campaign
  revision.
- A save is accepted only when its campaign checksum is still current.
- Concurrent local saves are serialized around checksum comparison and write;
  Web Locks coordinate browser pages when that API is available.
- Character edits are immutable and validated before persistence.
- The persistence envelope is rejected if its payload no longer matches its
  declared checksum.
- Browser `storage` events reload changes written by another local page.

## Not implemented in this slice

- TaleSpire message transport;
- distributed change journals or per-operation merge rules;
- cross-player identity;
- collection editors for actions, spells, inventory, traits or notes;
- automatic background import from, or export to, TaleSpire storage.

The current conflict behavior intentionally rejects a stale whole-campaign
save. A later change-journal layer will replace that coarse behavior with
operation-level reconciliation, allowing independent changes to merge.
