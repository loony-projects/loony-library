'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { processDirectory, resolveFolder } = require('../index.cjs');

test('finds folders from $HOME', () => {
  const home = process.env.HOME || os.homedir();
  assert.equal(resolveFolder('.output/book/markdown'), path.join(home, '.output/book/markdown'));
  assert.equal(resolveFolder('~/.output/book/markdown'), path.join(home, '.output/book/markdown'));
  assert.equal(resolveFolder('~'), home);
  assert.equal(resolveFolder('$HOME/x'), path.join(home, 'x'));
  assert.equal(resolveFolder('${HOME}/x'), path.join(home, 'x'));
  assert.equal(resolveFolder('/abs/path'), '/abs/path');
  assert.equal(resolveFolder('a~b'), path.join(home, 'a~b'));
});

test('refuses an output folder that is or is inside the input, without creating it', async () => {
  const input = fs.mkdtempSync(path.join(os.tmpdir(), 'cleaner-'));
  try {
    await assert.rejects(processDirectory(['js'], input, input), /is the same folder as the input folder/);
    await assert.rejects(processDirectory(['js'], input, path.join(input, 'out')), /is inside the input folder/);
    assert.equal(fs.existsSync(path.join(input, 'out')), false);
  } finally {
    fs.rmSync(input, { recursive: true, force: true });
  }
});
