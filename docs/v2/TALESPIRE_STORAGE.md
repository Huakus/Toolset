# TaleSpire campaign storage adapter

The v2 runtime selects persistence at its composition root:

- regular browser/Vite development uses browser localStorage;
- a WebView with the injected `TS` API waits for `hasInitialized` and uses
  `TS.localStorage.campaign.getBlob/setBlob`.

## Coexistence layout

TaleSpire provides one string blob per Symbiote and campaign. During the
transition, v2 does not replace the legacy root. It embeds its checked envelope
under a reserved property:

```json
{
  "characters": {},
  "DmNotes": {},
  "Encounter Data": {},
  "__talespire5eToolsetV2": {
    "format": "talespire-toolset-campaign-v2",
    "checksum": "...",
    "campaign": {}
  }
}
```

The editor can migrate the currently loaded legacy blob directly. Existing
legacy roots are retained on every v2 save. Removing those duplicated roots is
a later cleanup task after the live-board rollback exercise.

## Write safeguards

- the current embedded checksum must match the caller's expectation;
- schema validation happens before serialization;
- the complete resulting blob is checked against a conservative 5,000,000-byte
  limit before `setBlob`;
- current byte usage and the configured limit are visible in the editor;
- `setBlob` is awaited;
- the blob is immediately read back and its embedded checksum is verified;
- failures are surfaced to the UI and not converted into apparent successes.

TaleSpire documents that separate running game instances have no atomic
read/modify/write guarantee. An in-process lock prevents overlap inside this
runtime, but correctness across TaleSpire processes will be addressed by the
deferred operation journal and reconciliation protocol.
