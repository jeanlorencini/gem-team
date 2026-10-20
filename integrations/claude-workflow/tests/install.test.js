'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { mergeHooks } = require('../install-global.cjs');
test('hook merge preserves existing permission hooks, notifications, environment and models', () => {
  const original = { model: 'keep', env: { KEEP: 'yes' }, hooks: { PreToolUse: [{ matcher: '*', hooks: [{ command: 'old-permission' }] }], Stop: [{ hooks: [{ command: 'notify' }] }] } };
  const added = { hooks: { PreToolUse: [{ matcher: '*', hooks: [{ command: 'new' }] }] } };
  const result = mergeHooks(original, added); assert.equal(result.model, original.model); assert.deepEqual(result.env, original.env);
  assert.equal(result.hooks.PreToolUse[0].hooks[0].command, 'old-permission'); assert.deepEqual(result.hooks.Stop, original.hooks.Stop);
  assert.equal(original.hooks.PreToolUse.length, 1); assert.deepEqual(mergeHooks(result, added), result);
});
