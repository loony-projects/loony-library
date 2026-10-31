'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const profile = require('../../rust/profiles/bold-plain-comments');
const { convertParagraph } = require('../../rust/convert');

test('detects a bold-keyword paragraph with plain // comments', () => {
  const line =
    '**fn** main() { **let** x: i32 = 10; println!("x: {x}"); // x = 20; // println!("x: {x}"); }';
  assert.equal(profile.isCodeParagraph(line), true);
});

test(
  'converts the comprehensive-rust-google variables example without merging the ' +
    'two separate // comments onto one line (the bug this profile was built to fix)',
  () => {
    const line =
      '**fn** main() { **let** x: i32 = 10; println!("x: {x}"); // x = 20; // println!("x: {x}"); }';
    const out = convertParagraph(line, profile);
    assert.equal(
      out,
      [
        '```rs',
        'fn main() {',
        '    let x: i32 = 10;',
        '    println!("x: {x}");',
        '    // x = 20;',
        '    // println!("x: {x}");',
        '}',
        '```',
      ].join('\n')
    );
  }
);

test('strips a bolded span even when it contains an unescaped inner *', () => {
  const line = '**let** x = 1; **return** a \\* b + b \\* c + c \\* a;';
  const out = convertParagraph(line, profile);
  assert.doesNotMatch(out, /\*\*/);
  assert.match(out, /return a \* b \+ b \* c \+ c \* a;/);
});

test('unescapes \\_ for underscored numeric literals', () => {
  const line = '**let** x = 1\\_000; **let** y = 2;';
  const out = convertParagraph(line, profile);
  assert.match(out, /let x = 1_000;/);
});
