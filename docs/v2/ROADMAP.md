# Project roadmap

1. **Legacy characterization** — complete.
2. **V2 schema, migration and checked persistence** — complete.
3. **Player sheet legacy parity and compact UI** — complete.
4. **Player-side TaleSpire integration** — complete.
5. **GM and encounter parity** — complete. Encounter operation, player
   collaboration, public snapshot transport, bestiary/homebrew management,
   shops, campaign notes, checklists, random tables and utility/reference tools
   are implemented without importing the legacy runtime.
6. **Live TaleSpire smoke test** — pending on a real multi-client board. The
   automated suite and production build pass locally.
7. **Per-character operation journal** — pending. The player UI already has a
   local undo/redo log; the distributed journal needs durable event identity.
8. **Reconciliation, compaction and snapshots** — pending.
9. **Automatic cross-player character synchronization** — pending. The proven
   chunked transport and encounter snapshot protocol are the transport base.
10. **External Git-worker retirement and rollback exercise** — pending after
    live distributed synchronization is accepted.

The next functional focus is stage 6, followed by the synchronization stages.
The GM screen no longer requires `DMScript.js` or the legacy GM DOM.
