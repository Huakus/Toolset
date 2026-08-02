import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "..", "..");

async function readRepositoryFile(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

async function readJson(relativePath) {
  return JSON.parse(await readRepositoryFile(relativePath));
}

function extractTabTargets(html) {
  return [...html.matchAll(/<a\s+href="#([^"]+)"[^>]*>/g)].map(
    (match) => match[1],
  );
}

function scriptSources(html) {
  return [...html.matchAll(/<script\s+src="([^"]+)"[^>]*>/g)].map(
    (match) => match[1],
  );
}

test("manifest cuts over to v2 while preserving the TaleSpire integration surface", async () => {
  const manifest = await readJson("manifest.json");

  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.kind, "webView");
  assert.equal(manifest.entryPoint, "/dist-v2/v2.html");
  assert.equal(manifest.api.version, "0.1");
  assert.ok(manifest.api.interop.id);
  assert.equal(
    manifest.api.subscriptions.symbiote.onStateChangeEvent,
    "onStateChangeEvent",
  );
  assert.equal(
    manifest.api.subscriptions.sync.onSyncMessage,
    "handleSyncEvents",
  );
  assert.equal(
    manifest.api.subscriptions.sync.onClientEvent,
    "handleSyncClientEvents",
  );
  assert.ok(manifest.environment.capabilities.includes("runInBackground"));
});

test("player page preserves its primary sections and runtime order", async () => {
  const html = await readRepositoryFile("PlayerCharacter.html");

  assert.deepEqual(extractTabTargets(html).slice(0, 8), [
    "playerStats",
    "actions",
    "SpellList",
    "inventory",
    "features",
    "Docs",
    "Extras",
    "Init",
  ]);
  assert.deepEqual(scriptSources(html), [
    "D&DBeyondConverter/Converter.js",
    "SharedScript.js",
    "PlayerScript.js",
  ]);
});

test("GM page preserves its primary sections and runtime order", async () => {
  const html = await readRepositoryFile("DMScreen.html");

  assert.deepEqual(extractTabTargets(html).slice(0, 6), [
    "Init",
    "dmTables",
    "checklists",
    "SpellList",
    "Docs",
    "GoogleDocs",
  ]);
  assert.deepEqual(scriptSources(html), ["DMScript.js", "SharedScript.js"]);
});

test("campaign fixture preserves representative v1 character quirks", async () => {
  const campaign = await readJson(
    "test/fixtures/legacy/campaign-storage-v1.anonymized.json",
  );
  const character = campaign.characters["Personaje Alfa"];

  assert.deepEqual(Object.keys(campaign), [
    "characters",
    "DmNotes",
    "Encounter Data",
  ]);
  assert.ok(character);
  assert.equal(character[""], 0);
  assert.equal(typeof character.characterLevel, "string");
  assert.equal(typeof character.insp, "number");
  assert.equal(character["pb-24"], 0);
  assert.ok(Array.isArray(character.actionTable));
  assert.ok(Array.isArray(character.spellData["1st-level"].slots));
  assert.ok(Array.isArray(character.inventoryData.equipment));
  assert.ok(Array.isArray(character.groupTraitData));
  assert.ok(Array.isArray(character.groupNotesData));
  assert.ok(Array.isArray(character.extrasData));

  const roundTrip = JSON.parse(JSON.stringify(campaign));
  assert.deepEqual(roundTrip, campaign);
});

test("global fixture preserves the observed v1 namespaces", async () => {
  const globalStorage = await readJson(
    "test/fixtures/legacy/global-storage-v1.anonymized.json",
  );

  assert.deepEqual(Object.keys(globalStorage), [
    "language",
    "Custom Equipment",
    "npcList",
    "checklists",
    "encounters",
    "loot",
    "travel-1",
    "ThemeSettings",
    "Custom Spells",
    "effectsSection",
    "Custom Monsters",
    "Shop Data",
  ]);
  assert.equal(globalStorage.language["Preferred Language"], "es");
});

test("fixtures expose synthetic identities and content only", async () => {
  const campaign = await readJson(
    "test/fixtures/legacy/campaign-storage-v1.anonymized.json",
  );
  const characterNames = Object.keys(campaign.characters);
  const character = campaign.characters[characterNames[0]];

  assert.deepEqual(characterNames, ["Personaje Alfa"]);
  assert.equal(character.playerClass, "Clase ficticia");
  assert.equal(
    character.groupNotesData[0].notes[0].noteContent,
    "Contenido sintético sin información personal ni de campaña.",
  );
});

test("legacy character autosave is DOM-based and debounced by one second", async () => {
  const source = await readRepositoryFile("PlayerScript.js");

  assert.match(source, /function\s+getAllEditableContent\s*\(\)/);
  assert.match(
    source,
    /querySelectorAll\('\[contenteditable="true"\]'\)/,
  );
  assert.match(
    source,
    /saveToCampaignStorage\("characters",\s*characterName\.textContent,\s*content,\s*true\)/,
  );
  assert.match(
    source,
    /debouncedGetAllEditableContent\s*=\s*debounce\([\s\S]*?},\s*1000\)/,
  );
  assert.match(source, /addEventListener\('blur',\s*updateContent\)/);
});

test("legacy campaign save replaces one entry through a whole-blob cycle", async () => {
  const source = await readRepositoryFile("SharedScript.js");

  assert.match(source, /function\s+saveToCampaignStorage\s*\(/);
  assert.match(source, /TS\.localStorage\.campaign\.getBlob\(\)/);
  assert.match(source, /allData\[dataType\]\[dataId\]\s*=\s*data/);
  assert.match(
    source,
    /TS\.localStorage\.campaign\.setBlob\(JSON\.stringify\(allData,\s*null,\s*4\)\)/,
  );
});
