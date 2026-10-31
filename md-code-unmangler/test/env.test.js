'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseEnvContent, applyEnv, parseBoolEnv } = require('../env');

test('parses KEY=VALUE lines, skipping blanks and comments', () => {
  const parsed = parseEnvContent(
    [
      '# a comment',
      '',
      'RUST_UNMANGLER_DIR=../my-book/markdown',
      'RUST_UNMANGLER_PROFILE=bold-keywords',
    ].join('\n')
  );
  assert.deepEqual(parsed, {
    RUST_UNMANGLER_DIR: '../my-book/markdown',
    RUST_UNMANGLER_PROFILE: 'bold-keywords',
  });
});

test('strips matching surrounding quotes from a value', () => {
  const parsed = parseEnvContent('A="quoted value"\nB=\'also quoted\'\nC=bare');
  assert.deepEqual(parsed, { A: 'quoted value', B: 'also quoted', C: 'bare' });
});

test('ignores lines with no =', () => {
  const parsed = parseEnvContent('not a config line\nA=1');
  assert.deepEqual(parsed, { A: '1' });
});

test('applyEnv sets process.env but never overrides an already-set real var', () => {
  const key = 'RUST_UNMANGLER_TEST_VAR_' + Date.now();
  const key2 = key + '_ALREADY_SET';
  process.env[key2] = 'from-real-env';
  try {
    const applied = applyEnv({ [key]: 'from-dotenv', [key2]: 'from-dotenv' });
    assert.equal(process.env[key], 'from-dotenv');
    assert.equal(process.env[key2], 'from-real-env'); // untouched
    assert.deepEqual(applied, { [key]: 'from-dotenv' }); // key2 wasn't "applied"
  } finally {
    delete process.env[key];
    delete process.env[key2];
  }
});

test('parseBoolEnv accepts common truthy spellings and rejects everything else', () => {
  for (const v of ['1', 'true', 'True', 'yes', 'on']) assert.equal(parseBoolEnv(v), true);
  for (const v of ['0', 'false', 'no', 'off', '']) assert.equal(parseBoolEnv(v), false);
  assert.equal(parseBoolEnv(undefined), undefined);
});
