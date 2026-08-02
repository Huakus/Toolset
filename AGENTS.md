# Workspace scope

`Toolset Prototype` is the active TaleSpire symbiote project.

- Make source, test, documentation and build changes only in this directory.
- Treat the sibling directory `Toolset` as a legacy backup; do not edit or build it.
- TaleSpire campaign data under `.localstorage/` belongs to the user and must not be modified by development tasks.
- Build the active application with `npm run build:v2 -- --emptyOutDir=false` when TaleSpire may be locking existing output files.
