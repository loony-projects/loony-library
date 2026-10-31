'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reflow } = require('../../rust/reflow');

test('breaks after {, before/after }, and after ;', () => {
  const out = reflow('fn main() { let x = 1; if x == 1 { dbg!(x); } }');
  assert.equal(
    out,
    [
      'fn main() {',
      '    let x = 1;',
      '    if x == 1 {',
      '        dbg!(x);',
      '    }',
      '}',
    ].join('\n')
  );
});

test('glues closing punctuation onto the same line as the brace that closes', () => {
  const out = reflow(
    'fn main() { thread::scope(|s| { s.spawn(|| { foo(); }); }); }'
  );
  assert.equal(
    out,
    [
      'fn main() {',
      '    thread::scope(|s| {',
      '        s.spawn(|| {',
      '            foo();',
      '        });',
      '    });',
      '}',
    ].join('\n')
  );
});

test('glues "} else {" and "} else if cond {" onto one line', () => {
  const out = reflow('fn f() { if a { x(); } else if b { y(); } else { z(); } }');
  assert.equal(
    out,
    [
      'fn f() {',
      '    if a {',
      '        x();',
      '    } else if b {',
      '        y();',
      '    } else {',
      '        z();',
      '    }',
      '}',
    ].join('\n')
  );
});

test('does not break on {} inside a string literal (format placeholders)', () => {
  const out = reflow('fn main() { println!("{}", x); println!("{n}"); }');
  assert.equal(
    out,
    ['fn main() {', '    println!("{}", x);', '    println!("{n}");', '}'].join('\n')
  );
});

test('does not treat the ; in an array type [T; N] as a statement separator', () => {
  const out = reflow('let x: [i32; 3] = [1, 2, 3];');
  assert.equal(out, 'let x: [i32; 3] = [1, 2, 3];');
});

test('still breaks on ; inside a closure passed as a call argument', () => {
  const out = reflow('spawn(move || { sleep(d); println!("done"); });');
  assert.equal(
    out,
    ['spawn(move || {', '    sleep(d);', '    println!("done");', '});'].join('\n')
  );
});

test('keeps use-statement import lists inline instead of breaking them', () => {
  const out = reflow('use std::thread::{self, sleep};');
  assert.equal(out, 'use std::thread::{self, sleep};');
});

test('keeps nested import groups inline', () => {
  const out = reflow('use std::{io::{self, Result}, net::TcpStream};');
  assert.equal(out, 'use std::{io::{self, Result}, net::TcpStream};');
});

test('does not mistake a struct literal for an import group', () => {
  // "Thread" is a plain identifier, not "::", so this must still be
  // treated as a real block and broken onto its own lines.
  const out = reflow('let t = Thread { id: 0, name: n };');
  assert.equal(out, ['let t = Thread {', '    id: 0, name: n', '};'].join('\n'));
});

test('gives a #[attribute] its own line', () => {
  const out = reflow('#[derive(Default)] struct S { a: usize }');
  assert.equal(
    out,
    ['#[derive(Default)]', 'struct S {', '    a: usize', '}'].join('\n')
  );
});

test('placeholder tokens always get their own line', () => {
  const out = reflow('let a = 1; \x000\x00 let b = 2;');
  assert.equal(out, ['let a = 1;', '\x000\x00', 'let b = 2;'].join('\n'));
});
