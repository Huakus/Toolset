# Legacy system baseline

This directory records the observable behavior of the current TaleSpire 5e
Toolset before the v2 implementation begins. It is a compatibility baseline,
not an endorsement of the current architecture.

## Stage 1 scope

Stage 1 freezes and documents the system without changing runtime behavior:

- inventory the player, GM, shared, storage and TaleSpire-facing features;
- describe the v1 campaign/global storage contracts and their known quirks;
- identify behavior that must survive migration;
- provide anonymized fixtures that do not depend on a real campaign;
- add executable characterization tests for stable, externally visible
  contracts.

The stage explicitly does **not** introduce the v2 model, alter the UI, migrate
storage, change the manifest, or implement synchronization.

## Current shape

The runtime is a set of global scripts loaded by three HTML documents:

| Entry point | Role | Runtime scripts |
| --- | --- | --- |
| `index.html` | Detect client mode and open the corresponding view | inline script |
| `PlayerCharacter.html` | Player character sheet | converter, shared, player |
| `DMScreen.html` | GM tools | GM, shared |

Approximate source size at baseline:

| File | Lines | Named functions |
| --- | ---: | ---: |
| `PlayerScript.js` | 8,399 | 204 |
| `SharedScript.js` | 6,329 | 70 |
| `DMScript.js` | 4,610 | 113 |

All runtime scripts share their page's global namespace. Player and GM code
contain parallel implementations for notes, monster cards, dropdowns and other
behaviors. Some function names are declared more than once in the same source
file, making declaration order observable.

## Main runtime flows

### Startup

1. TaleSpire injects API v0.1 according to `manifest.json`.
2. `onStateChangeEvent({ kind: "hasInitialized" })` starts initialization.
3. `index.html` inspects the current client mode and opens the player or GM
   document.
4. The selected document loads data files, campaign/global blobs, clients and
   UI event handlers.

### Character persistence

1. The character UI is the working state.
2. On blur, `updateContent` schedules serialization with a 1 second debounce.
3. `getAllEditableContent` scans the DOM and builds a complete character
   object.
4. `saveToCampaignStorage("characters", characterName, content, true)` reads
   the complete campaign blob, replaces one character and writes the complete
   blob again.

There is no write queue, revision check, transaction or compare-and-swap. The
return value of `setBlob` is not awaited by the character save path.

### Realtime messages

Player and GM pages both expose `handleSyncEvents`. Messages are JSON strings
routed by a `type` discriminator. Existing realtime messages cover player
statistics, health, dice/roll requests, target selection and initiative state.
They do not replicate the campaign storage blob.

## Baseline test suite

Run:

```powershell
npm test
```

The tests use Node's built-in test runner and require no installed packages.
They intentionally verify legacy contracts at source/document level because
the current scripts cannot be imported safely without booting a large browser
DOM and a TaleSpire API host.

The fixtures under `test/fixtures/legacy` are synthetic. They preserve v1
shapes and awkward details such as the empty property name, mixed string/number
values and positional arrays, while excluding campaign content.

## Related documents

- [Feature inventory](./FEATURE_INVENTORY.md)
- [Data contract v1](./DATA_CONTRACT_V1.md)
- [Known risks](./KNOWN_RISKS.md)
- [Rewrite acceptance baseline](./REWRITE_ACCEPTANCE.md)
