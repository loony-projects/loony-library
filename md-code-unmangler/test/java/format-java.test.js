'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatJava, tokenize } = require('../../java/format-java.cjs');

const format = code => formatJava(code).code;
const comments = code => tokenize(code, true).filter(t => t.type === 'comment').map(t => t.value);

test('rebuilds lines and indentation of a flattened program', () => {
  assert.equal(format('// Compute distance. class Light { public static void main(String args[]) { long days; // approximate speed of light lightspeed = 186000; days = 1000; System.out.println(days); } }'), [
    '// Compute distance.',
    'class Light {',
    '  public static void main(String args[]) {',
    '    long days; // approximate speed of light',
    '    lightspeed = 186000;',
    '    days = 1000;',
    '    System.out.println(days);',
    '  }',
    '}',
  ].join('\n'));
});

test('guesses where a flattened // comment ends', () => {
  assert.deepEqual(comments('// radius of circle pi = 3.1416;'), ['// radius of circle']);
  assert.deepEqual(comments('// x and y both known here. System.out.println(x);'), ['// x and y both known here.']);
  assert.deepEqual(comments('// compute and return volume double volume() { return w; }'), ['// compute and return volume']);
  assert.deepEqual(comments('// use a nested interface reference A.NestedIF nif = new B();'), ['// use a nested interface reference']);
  assert.deepEqual(comments('// Use try-with-resources to close the files. try (FileOutputStream f0 = x) { }'),
    ['// Use try-with-resources to close the files.']);
  assert.deepEqual(comments('// Pass an int to m() and assign the return value // to an Integer. Integer iOb = m(100);'),
    ['// Pass an int to m() and assign the return value', '// to an Integer.']);
  // Words that only look like code stay in the comment.
  assert.deepEqual(comments('// Create the File menu, including a mnemonic. Menu fileMenu = new Menu("File");'),
    ['// Create the File menu, including a mnemonic.']);
  assert.deepEqual(comments('// public access private int c;'), ['// public access']);
  assert.deepEqual(comments('// wait -- if possible. Thread.sleep(10);'), ['// wait -- if possible.']);
});

test('keeps commented-out code as its own comments', () => {
  assert.deepEqual(comments('// y = 100; // Error! y not known here x = 1;'), ['// y = 100; // Error! y not known here']);
  assert.deepEqual(comments('// a = 1; // b = 2; c = 3;'), ['// a = 1;', '// b = 2;']);
  assert.deepEqual(comments('// if(x) // System.out.println(x); y = 1;'), ['// if(x)', '// System.out.println(x);']);
});

test('separates methods and classes with blank lines and puts their comments above them', () => {
  assert.equal(format('class Box { double width; double depth; // compute and return volume double volume() { return width * depth; } } class Demo { }'), [
    'class Box {',
    '  double width;',
    '  double depth;',
    '',
    '  // compute and return volume',
    '  double volume() {',
    '    return width * depth;',
    '  }',
    '}',
    '',
    'class Demo {',
    '}',
  ].join('\n'));
});

test('lays out else, try, do-while, switch and annotations', () => {
  assert.equal(format('if(b) f(); else g(); try { a(); } catch(Exception e) { b(); } finally { c(); } do { n--; } while(n > 0);'),
    'if(b) f();\nelse g();\ntry {\n  a();\n} catch(Exception e) {\n  b();\n} finally {\n  c();\n}\ndo {\n  n--;\n} while(n > 0);');
  assert.equal(format('switch(i) { case 0: f(); break; default: g(); }'),
    'switch(i) {\n  case 0:\n    f();\n    break;\n  default:\n    g();\n}');
  assert.equal(format('class A { @Override public String toString() { return "A"; } }'),
    'class A {\n  @Override\n  public String toString() {\n    return "A";\n  }\n}');
});

test('keeps array initializers and for headers on one line', () => {
  assert.equal(format('int days[] = { 31, 28, 31 }; for(i=0; i<3; i++) sum += days[i];'),
    'int days[] = { 31, 28, 31 };\nfor(i=0; i<3; i++) sum += days[i];');
});

test('indents anonymous classes and lambdas', () => {
  assert.equal(format('addWindowListener(new WindowAdapter() { public void windowClosing(WindowEvent we) { System.exit(0); } });'), [
    'addWindowListener(new WindowAdapter() {',
    '  public void windowClosing(WindowEvent we) {',
    '    System.exit(0);',
    '  }',
    '});',
  ].join('\n'));
});

test('starts a listing continued from the previous page at the depth it closes', () => {
  assert.equal(format('System.out.println(num); } }'), '    System.out.println(num);\n  }\n}');
});

test('wraps long lines at operators and commas', () => {
  assert.equal(formatJava('String s = "This could have been " + "a very long line that would have " + "wrapped around.";', 60).code,
    'String s = "This could have been "\n    + "a very long line that would have "\n    + "wrapped around.";');
});

test('separates imports from what follows', () => {
  assert.equal(format('import java.awt.*; import javax.swing.*; public class X { }'),
    'import java.awt.*;\nimport javax.swing.*;\n\npublic class X {\n}');
});
