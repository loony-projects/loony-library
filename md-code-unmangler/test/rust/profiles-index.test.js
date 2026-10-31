'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectProfile, getProfile, PROFILES } = require('../../rust/profiles');

test('getProfile throws a helpful error for an unknown name', () => {
  assert.throws(() => getProfile('nope'), /Unknown profile "nope"/);
});

test('registers all three profiles', () => {
  const names = PROFILES.map((p) => p.name).sort();
  assert.deepEqual(names, ['bold-keywords', 'bold-plain-comments', 'keyword-density']);
});

test('detects keyword-density unambiguously (no bold markers present)', () => {
  const content =
    'fn main() {     let t_ptr = 99999999999999 as *const usize;     let x = dereference(t_ptr);     println!("{}", x); }';
  const { profile, confident } = detectProfile([content]);
  assert.equal(profile.name, 'keyword-density');
  assert.equal(confident, true);
});

test(
  'bold-keywords and bold-plain-comments tie on raw match count (identical detection) - ' +
    'breaks the tie toward bold-keywords when the comment uses *// asterisk markers*',
  () => {
    const content =
      '**use** std::collections::VecDeque; **fn** main() { *// a comment* **let** queue = Mutex::new(VecDeque::new()); }';
    const { profile, scores, tieBreak } = detectProfile([content]);
    const top = scores.filter((s) => s.count === scores[0].count).map((s) => s.profile.name);
    assert.ok(top.includes('bold-keywords') && top.includes('bold-plain-comments'));
    assert.ok(tieBreak, 'expected a tie-break to have run');
    assert.equal(profile.name, 'bold-keywords');
  }
);

test('breaks the tie toward bold-plain-comments when the comment is a bare, undelimited //', () => {
  const content =
    '**fn** main() { **let** x: i32 = 10; println!("x: {x}"); // x = 20; // println!("x: {x}"); }';
  const { profile, tieBreak } = detectProfile([content]);
  assert.ok(tieBreak, 'expected a tie-break to have run');
  assert.equal(profile.name, 'bold-plain-comments');
});

test('throws when nothing matches any profile', () => {
  assert.throws(() => detectProfile(['just some ordinary prose with no code in it.']), /no code paragraphs matched/);
});
