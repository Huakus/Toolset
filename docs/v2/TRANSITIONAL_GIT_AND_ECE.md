# Transitional Git and ECE architecture

Git remains a temporary campaign transport until the distributed character
journal, reconciliation and TaleSpire-native synchronization are complete.
It also publishes the Markdown context under `.localstorage/ECE`.

## Current ownership

- The symbiote owns campaign rules, V2 validation, revisions and checksums.
- `4_export-character-sheets.ps1` reads only the configured TaleSpire campaign
  blob and only accepts a valid `__talespire5eToolsetV2` envelope. It writes one
  deterministic Markdown projection per character.
- `7_generate-history-index.ps1` owns the Lore chapter index.
- `8_generate-public-file-index.ps1` owns the deterministic ECE file map.
- `5_sync-toolset-git.ps1` remains the temporary Git transport and must be
  restricted to the configured campaign blob and `.localstorage/ECE`.
- GitHub Actions publishes ECE; it is not part of the symbiote runtime.

## Safety rules for the Git worker

1. Resolve the repository from the worker location; never target the legacy
   sibling `Toolset` directory.
2. Stage explicit paths. `git add -A` is forbidden.
3. Validate JSON, V2 format, schema version and checksum shape before commit and
   after receiving remote changes.
4. Back up the campaign blob before reconciliation.
5. Never update source code automatically while TaleSpire is running.
6. Abort and report Git conflicts instead of choosing a campaign version.
7. Use one process lock so two launchers cannot synchronize concurrently.

## Planned replacement

The next transport stores immutable operations under a client-owned path and
uses compact snapshots. The symbiote will generate and reconcile operations;
the external bridge will only materialize files and transport them through Git.
After the TaleSpire transport is accepted in a live multi-client test, Git will
remain only as backup and ECE publication.
