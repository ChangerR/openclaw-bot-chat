import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function readJson(file) {
  return JSON.parse(read(file));
}

test('entry source uses bundled channel entry contract', () => {
  const source = read('index.ts');
  assert.match(source, /defineBundledChannelEntry/);
  assert.match(source, /channel-plugin-api\.js/);
  assert.match(source, /runtime-api\.js/);
  assert.match(source, /accountInspect/);
  assert.match(source, /secret-config-contract-api\.js/);
});

test('setup entry source uses bundled channel setup entry contract', () => {
  const source = read('setup-entry.ts');
  assert.match(source, /defineBundledChannelSetupEntry/);
  assert.doesNotMatch(source, /defineBundledSetupEntry/);
  assert.match(source, /setup-plugin-api\.js/);
  assert.match(source, /secret-config-contract-api\.js/);
});

test('manifest matches top-level bundled channel shape', () => {
  const manifest = readJson('openclaw.plugin.json');
  assert.equal(manifest.id, 'bot-chat');
  assert.deepEqual(manifest.channels, ['bot-chat']);
  assert.ok(manifest.channelEnvVars['bot-chat'].includes('BOT_CHAT_BOT_KEY'));
  assert.equal(manifest.configSchema.type, 'object');
  assert.equal(manifest.configSchema.additionalProperties, false);
});

test('package metadata advertises configured state and setup entry', () => {
  const pkg = readJson('package.json');
  assert.equal(pkg.openclaw.setupEntry, './setup-entry.ts');
  assert.equal(pkg.openclaw.channel.id, 'bot-chat');
  assert.equal(pkg.openclaw.channel.configuredState.specifier, './configured-state');
  assert.equal(pkg.openclaw.compat.pluginApi, '>=2026.4.20');
});
