'use strict';
// Operator-only installer. Evaluation drivers and receipts are never installed globally.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const w = require('./src/gem-workflow.js');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
function replace(file, bytes) {
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  try { fs.writeFileSync(tmp, bytes); fs.renameSync(tmp, file); }
  finally { fs.rmSync(tmp, { force: true }); }
}
function mergeHooks(settings, added) {
  const result = structuredClone(settings); result.hooks ||= {};
  for (const [event, entries] of Object.entries(added.hooks)) {
    result.hooks[event] ||= [];
    for (const entry of entries) {
      const command = entry.hooks[0].command;
      if (!result.hooks[event].some(e => e.hooks?.some(h => h.command === command))) result.hooks[event].push(entry);
    }
  }
  return result;
}
function upgrade(home, expectedHash) {
  const base = path.join(home, '.claude'), core = path.join(base, 'hooks/gem-workflow.js'), settingsFile = path.join(base, 'settings.json');
  const previousCore = fs.readFileSync(core), before = fs.readFileSync(settingsFile);
  if (!expectedHash || hash(previousCore) !== expectedHash) throw Error('Helper differs from the reviewed version; nothing written.');
  const oldSettings = JSON.parse(before.toString('utf8').replace(/^\uFEFF/, ''));
  const wanted = w.hookSettings(core), merged = mergeHooks(oldSettings, wanted);
  const addedEvents = Object.keys(wanted.hooks).filter(event => !(oldSettings.hooks?.[event] || []).some(e => e.hooks?.some(h => h.command === wanted.hooks[event][0].hooks[0].command)));
  const backup = path.join(base, 'backups', 'gem-conversation-' + Date.now()); fs.mkdirSync(backup, { recursive: true });
  fs.writeFileSync(path.join(backup, 'gem-workflow.js'), previousCore); fs.writeFileSync(path.join(backup, 'settings.json'), before);
  const next = fs.readFileSync(path.join(__dirname, 'src/gem-workflow.js'));
  if (hash(fs.readFileSync(settingsFile)) !== hash(before)) throw Error('Settings changed concurrently; nothing installed.');
  const nextSettings = Buffer.from(JSON.stringify(merged, null, 2) + '\n');
  try {
    replace(core, next); replace(settingsFile, nextSettings);
    const manifest = { kind: 'integration-upgrade', backup, core, settingsFile, coreHash: hash(next), addedEvents, command: wanted.hooks.PreToolUse[0].hooks[0].command };
    fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return manifest;
  } catch (error) {
    if (hash(fs.readFileSync(core)) === hash(next)) replace(core, previousCore);
    if (hash(fs.readFileSync(settingsFile)) === hash(nextSettings)) replace(settingsFile, before);
    throw error;
  }
}
function rollback(backup) {
  const m = readJson(path.join(backup, 'manifest.json'));
  if (m.kind === 'integration-upgrade') {
    if (hash(fs.readFileSync(m.core)) !== m.coreHash) throw Error('Helper changed after upgrade; merge manually.');
    const settings = readJson(m.settingsFile), before = readJson(path.join(backup, 'settings.json'));
    for (const event of m.addedEvents) {
      settings.hooks[event] = (settings.hooks[event] || []).map(e => ({ ...e, hooks: (e.hooks || []).filter(h => h.command !== m.command) })).filter(e => e.hooks.length);
      if (!settings.hooks[event].length && !Object.hasOwn(before.hooks || {}, event)) delete settings.hooks[event];
    }
    replace(m.core, fs.readFileSync(path.join(backup, 'gem-workflow.js')));
    replace(m.settingsFile, JSON.stringify(settings, null, 2) + '\n');
    return { restoredIntegration: true, backup, gemAgentsUnchanged: true };
  }
  throw Error('Unsupported backup type; only integration-upgrade manifests are accepted.');
}
module.exports = { mergeHooks, upgrade, rollback };
if (require.main === module) {
  try {
    const command = process.argv[2];
    if (!['--upgrade', '--rollback'].includes(command)) throw Error('Usage: install-global.cjs --upgrade REVIEWED_SHA256 [HOME] | --rollback BACKUP');
    console.log(JSON.stringify(command === '--rollback' ? rollback(process.argv[3]) : upgrade(process.argv[4] || os.homedir(), process.argv[3]), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
