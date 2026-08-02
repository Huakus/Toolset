# GM parity record

| Legacy area | V2 status | Implementation |
| --- | --- | --- |
| Encounters, initiative, rounds and turns | Complete | Typed encounter domain and optimistic revisions |
| Player discovery and requested statistics | Complete | Targeted TaleSpire sync collaboration |
| Player-visible encounter state | Complete | Privacy projection, chunking, checksum, ACK and retry |
| Monster lookup and cards | Complete | Bundled bestiary, compact stat blocks and dice actions |
| Custom monsters | Complete | Global CRUD with legacy-compatible serialization |
| Custom spells and equipment | Complete | Global CRUD with typed definitions |
| Shops | Complete | Named shops with editable category/item groups |
| Grouped GM notes | Complete | Campaign-scoped typed groups; legacy `DmNotes` migration |
| Checklists | Complete | Global persistent completion state |
| Random tables | Complete | Campaign-scoped editable tables and random selection |
| Travel and jumping | Complete | Compact calculators |
| NPC helper | Complete | Quick role, occupation, personality and motivation generator |
| Conditions, effects and schools | Complete | Compact reference surface plus encounter condition controls |
| Google Docs | Complete | Validated `docs.google.com` campaign link and embedded surface |

All GM features are reached through four compact sections: **Encuentro**,
**Contenido**, **Notas** and **Herramientas**. Content uses a second-level
selector for monsters, spells, equipment and shops; tools use the same pattern
for checklist, tables, travel/jumping, NPCs, references and Google Docs. Only
the selected workspace is rendered, matching the density and navigation of the
character sheet. Global custom content preserves
unrelated namespaces in TaleSpire global storage. Campaign notes and tables use
the campaign repository checksum, so stale GM pages cannot overwrite newer
campaign state silently.
