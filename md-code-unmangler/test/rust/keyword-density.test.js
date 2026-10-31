'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const profile = require('../../rust/profiles/keyword-density');
const { convertParagraph } = require('../../rust/convert');

test('detects a plain (non-bolded) flattened code paragraph', () => {
  const line =
    'fn main() {     let t_ptr = 99999999999999 as *const usize;     let x = dereference(t_ptr);     println!("{}", x); }';
  assert.equal(profile.isCodeParagraph(line), true);
});

test('rejects a prose sentence that merely quotes one short code fragment', () => {
  const line =
    "The important line here was let this = unsafe { self.get_unchecked_mut() };. Here, we had to use unsafe since the pinned value is !Unpin because of the marker trait we added.";
  assert.equal(profile.isCodeParagraph(line), false);
});

test('rejects a JS comparison snippet (function is not a Rust keyword)', () => {
  const line =
    'async function run() {     await timer(200);     await timer(100);     await timer(50);     console.log("done"); }';
  assert.equal(profile.isCodeParagraph(line), false);
});

test('rejects prose that mentions a function signature and a std:: path separately', () => {
  const line =
    'We use std::sync::OnceLock so that we can initialize REGISTRY when the runtime starts. If we did call Http::get without a Runtime, it would panic since the way to access it is through the pub fn registry(){…} function.';
  assert.equal(profile.isCodeParagraph(line), false);
});

test('accepts a struct definition even with only one semicolon, via the :: signal', () => {
  const line =
    'use std::{marker::PhantomPinned, pin::Pin}; #[derive(Default)] struct MaybeSelfRef {     a: usize,     b: Option<\\*const usize>,     \\_pin: PhantomPinned, }';
  assert.equal(profile.isCodeParagraph(line), true);
});

test('keeps use-statement import lists inline instead of breaking them', () => {
  const line =
    'use std::thread::{self, sleep}; fn main() {     println!("hi");     let t1 = thread::spawn(move || {         sleep(std::time::Duration::from\\_millis(200));         println!("done");     }); }';
  const out = convertParagraph(line, profile);
  assert.match(out, /^use std::thread::\{self, sleep\};$/m);
});

test('still breaks on ; inside a closure passed to spawn() (regression: paren-depth over-suppression)', () => {
  const line =
    'fn main() { let t1 = thread::spawn(move || {         sleep(d);         println!("done");     }); }';
  const out = convertParagraph(line, profile);
  assert.match(out, /sleep\(d\);\n\s*println!\("done"\);/);
});

test(
  'comment extraction is string-literal-aware: a `}` inside a "{txt}" format placeholder ' +
    'must not terminate the comment (regression: this previously corrupted brace/quote balance ' +
    'for the rest of the paragraph)',
  () => {
    const line =
      'State0::Wait1(ref mut f1) => { match f1.poll(waker) { PollState::Ready(txt) => { // Restore stack let mut counter = self.stack.counter.take().unwrap(); // ---- Code you actually wrote ---- println!("{txt}"); counter += 1; // ---------------------------------- let fut2 = Box::new(x); self.state = State0::Wait2(fut2); } PollState::NotReady => break PollState::NotReady, } }';
    const out = convertParagraph(line, profile);
    // The string literal must survive completely intact...
    assert.match(out, /println!\("\{txt\}"\);/);
    // ...and the fence must be well-formed with no stray nested fences,
    // which is what happened when the old regex-based extractor matched
    // the `}` inside "{txt}" as if it were a real closing brace.
    const fenceCount = (out.match(/```/g) || []).length;
    assert.equal(fenceCount, 2);
  }
);

test('replaces guillemet artifacts («») with straight quotes', () => {
  const line =
    'fn f() { let writer = unsafe { x }; writeln!(writer, «{txt}»).unwrap(); let y = 1; z(); }';
  const out = convertParagraph(line, profile);
  assert.match(out, /writeln!\(writer, "\{txt\}"\)\.unwrap\(\);/);
});

test('strips a bolded span even when it contains an unescaped inner *', () => {
  const line =
    '**pub fn yield_thread() {     unsafe {         let rt_ptr = RUNTIME as *mut Runtime;         (*rt_ptr).t_yield();     };  }**';
  const out = convertParagraph(line, profile);
  assert.doesNotMatch(out, /\*\*/);
  assert.match(out, /as \*mut Runtime;/);
});
