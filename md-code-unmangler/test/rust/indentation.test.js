'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { layoutFromIndentation } = require('../../rust/indentation');
const profile = require('../../rust/profiles/keyword-density');
const { convertFile } = require('../../rust/convert');
const { detectProfile } = require('../../rust/profiles');

const NNBSP = ' ';

test('turns runs of spaces back into line breaks and indentation', () => {
  assert.equal(layoutFromIndentation('pub struct Http; impl Http {     pub fn get(path: &str) -> String {         new(path)     } }'),
    'pub struct Http;\nimpl Http {\n    pub fn get(path: &str) -> String {\n        new(path)\n    }\n}');
});

test('reads indentation written as narrow no-break spaces', () => {
  const line = `pub fn spawn(&mut self, f: fn()) { ${NNBSP.repeat(4)}let available = self ${NNBSP.repeat(8)}.threads ${NNBSP.repeat(8)}.iter\\_mut();`;
  assert.equal(profile.layoutFromIndentation(line),
    'pub fn spawn(&mut self, f: fn()) {\n    let available = self\n        .threads\n        .iter_mut();');
});

test('finds the line breaks at indentation 0', () => {
  assert.equal(layoutFromIndentation('#[derive(Debug)] #[repr(C)] struct A {     x: u8, } mod b; mod c;'),
    '#[derive(Debug)]\n#[repr(C)]\nstruct A {\n    x: u8,\n}\nmod b;\nmod c;');
  assert.equal(layoutFromIndentation('fn get() -> String {     format!(         "x"     ) }'),
    'fn get() -> String {\n    format!(\n        "x"\n    )\n}');
});

test('indents a listing continued from the previous page', () => {
  assert.equal(layoutFromIndentation('pub fn registry(&self) -> &Registry {         &self.registry     }'),
    '    pub fn registry(&self) -> &Registry {\n        &self.registry\n    }');
  assert.equal(layoutFromIndentation('*x = 2;     println!(); }'), '    *x = 2;\n    println!();\n}');
  assert.equal(layoutFromIndentation('#[inline(never)]     fn t(&mut self) {         x     }'),
    '    #[inline(never)]\n    fn t(&mut self) {\n        x\n    }');
  assert.equal(layoutFromIndentation('pin::Pin,     task::{Context, Poll}, };'), '    pin::Pin,\n    task::{Context, Poll},\n};');
});

test('keeps a // comment to its own line and a multi-line string continuation', () => {
  assert.equal(layoutFromIndentation('struct E {     // Token to identify event     data: usize, }'),
    'struct E {\n    // Token to identify event\n    data: usize,\n}');
  assert.equal(layoutFromIndentation('fn req() -> String {     format!(         "GET\\r\\n\\              Host"     ) }'),
    'fn req() -> String {\n    format!(\n        "GET\\r\\n\\\n             Host"\n    )\n}');
});

test('gives up when line breaks were lost, so the reflow is used', () => {
  assert.equal(layoutFromIndentation('fn main() { let t1 = 1;         sleep(d); }'), null);
  assert.equal(layoutFromIndentation('fn main() { x(); }'), null);
});

test('recognizes short leftover pieces of code, but not prose, JavaScript or TOML', () => {
  for (const code of ['use std::io; fn main() {', 'pub struct Executor;', 'mod ffi; mod poll;', 'return PollState::NotReady;',
    'pub fn spawn<F>(future: F) where     F: Future,', 'State0::Start => {     x();']) {
    assert.equal(profile.isCodeParagraph(code), true, code);
  }
  for (const text of ['First, we have an attribute named #[inline(never)] that tells the compiler something; really { }',
    'async function run() {     await timer(200); }', 'setTimer(200, () => {   x(); });',
    'mio = { version = "0.8", features = ["net", "os-poll"] }',
    'error[E0499]: cannot borrow `numbers` as mutable more than once at a time { a; b; }']) {
    assert.equal(profile.isCodeParagraph(text), false, text);
  }
});

test('leaves existing fences alone, in conversion and in profile detection', () => {
  const content = '```rs\nfn main() {\n    let x = 1;\n}\n```\n\nuse std::io; fn main() {';
  const result = convertFile(content, profile);
  assert.equal(result.converted, 1);
  assert.match(result.text, /^```rs\nfn main\(\) \{\n {4}let x = 1;\n\}\n```\n\n```rs\nuse std::io;\nfn main\(\) \{\n```$/);
  assert.equal(detectProfile([content]).scores.find(s => s.profile === profile).count, 1);
});
