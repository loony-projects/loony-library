'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const profile = require('../../rust/profiles/bold-keywords');
const { convertParagraph } = require('../../rust/convert');

test('detects a bold-keyword code paragraph', () => {
  const line =
    '**use** std::collections::VecDeque; **fn** main() { **let** queue = Mutex::new(VecDeque::new()); }';
  assert.equal(profile.isCodeParagraph(line), true);
});

test('does not mistake a bolded heading for code', () => {
  assert.equal(profile.isCodeParagraph('## **Thread Parking**'), false);
});

test('converts the rustatomicsandlocks thread-parking example (regression fixture)', () => {
  const line =
    '**use** std::collections::VecDeque; **fn** main() { **let** queue = Mutex::new(VecDeque::new()); thread::scope(|s| { *// Consuming thread* **let** t = s.spawn(|| **loop** { **let** item = queue.lock().unwrap().pop\\_front(); **if let** Some(item) = item { dbg!(item); } **else** { thread::park(); } }); *// Producing thread* **for** i **in** 0.. { queue.lock().unwrap().push\\_back(i); t.thread().unpark(); thread::sleep(Duration::from\\_secs(1));}});}';

  const expected = `\`\`\`rs
use std::collections::VecDeque;
fn main() {
    let queue = Mutex::new(VecDeque::new());
    thread::scope(|s| {
        *// Consuming thread*
        let t = s.spawn(|| loop {
            let item = queue.lock().unwrap().pop_front();
            if let Some(item) = item {
                dbg!(item);
            } else {
                thread::park();
            }
        });
        *// Producing thread*
        for i in 0.. {
            queue.lock().unwrap().push_back(i);
            t.thread().unpark();
            thread::sleep(Duration::from_secs(1));
        }
    });
}
\`\`\``;

  assert.equal(convertParagraph(line, profile), expected);
});

test('unescapes \\_ and \\* (e.g. deref) correctly', () => {
  const line =
    '**use** std::sync::Mutex; **fn** main() { **let mut** guard = n.lock().unwrap(); **for** \\_ **in** 0..100 { \\*guard += 1; } }';
  const out = convertParagraph(line, profile);
  assert.match(out, /for _ in 0\.\.100 \{/);
  assert.match(out, /\*guard \+= 1;/);
});

test('a bold span containing a digit (a type name like i32) is still detected', () => {
  const line =
    '**let** x: &\'static [**i32**; 3] = Box::leak(Box::new([1, 2, 3])); thread::spawn(**move** || dbg!(x)); thread::spawn(**move** || dbg!(x));';
  assert.equal(profile.isCodeParagraph(line), true);
  const out = convertParagraph(line, profile);
  // Regression: a `;` inside the array type [i32; 3] must not be split.
  assert.match(out, /let x: &'static \[i32; 3\] = Box::leak\(Box::new\(\[1, 2, 3\]\)\);/);
});
