# Read-only v1 → v2 migration

`previewCampaignMigration` accepts parsed JSON and returns either a validated
v2 campaign plus a report, or a list of validation issues.

It has no storage or filesystem dependency and cannot write the source file.

## Guarantees in this stage

- deterministic campaign, character and nested entity IDs;
- idempotent handling of an already-v2 document;
- explicit schema version and revision;
- exact migration timestamp supplied by the caller;
- canonical source/result SHA-256 checksums;
- preservation of unknown root and character fields;
- preservation of GM notes and encounter data;
- conversion of common numeric strings to typed values;
- stable IDs for actions, inventory, spells, traits, notes, conditions and
  extra creatures;
- schema validation before a result is returned.

The automated suite also discovers extensionless campaign backups containing a
`characters` root and runs the preview against them. It verifies file size and
modification time before/after to guard the read-only boundary. No migrated
payload is written or included in test output.

## Deliberately outside the migrator

- reading or writing TaleSpire storage;
- backup or manifest mutation;
- character operations, repositories, UI or synchronization.

Those concerns consume the validated result through application and
infrastructure modules. They are now implemented for the player sheet without
adding side effects to migration preview.
