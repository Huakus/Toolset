# Player lifecycle and TaleSpire adapters

V2 can start from an empty native campaign, create and delete characters, or
import a v2 character, a legacy character map, creator output, and a D&D Beyond
export. Imported identities receive new stable IDs so they cannot overwrite an
existing character accidentally. All mutations still require the campaign
checksum and current character revision.

The player-side TaleSpire bridge provides:

- selected-creature links and content-pack thumbnails;
- dice tray submission, result evaluation and result publication;
- automatic initiative result relay to the current GM client;
- legacy-compatible initiative list, active turn, round and statistic messages;
- reusable custom spell and equipment definitions in global storage;
- campaign storage capacity reporting and verified writes;
- handlers for every callback named by `manifest.json`.

`manifest.json` points to the built `dist-v2/v2.html`. Run `npm run build:v2`
after source changes. The Vite base is relative so its generated JavaScript and
CSS resolve correctly from that subdirectory.
