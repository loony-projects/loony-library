'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatJs, formatJson, compiles } = require('../../js/format-js.cjs');

const format = code => {
  const result = formatJs(code);
  assert.equal(result.skipped, undefined, `skipped: ${result.skipped}`);
  return result.code;
};

test('rebuilds statements and blocks from flattened code', () => {
  assert.equal(format(
    "function longRunningOperation(callback) { // simulate a 3 second operation setTimeout(callback, 3000); } "
    + "function userClicked() { console.log('starting'); longRunningOperation(function () { console.log('ending'); }); } "
    + '// simulate a user action userClicked();'),
  [
    'function longRunningOperation(callback) {',
    '  // simulate a 3 second operation',
    '  setTimeout(callback, 3000);',
    '}',
    'function userClicked() {',
    "  console.log('starting');",
    '  longRunningOperation(function () {',
    "    console.log('ending');",
    '  });',
    '}',
    '// simulate a user action',
    'userClicked();',
  ].join('\n'));
});

test('a comment after `;` trails it; a following comment starts a new line', () => {
  assert.equal(format('foo(); // Is this global?: true console.log(global.foo); // 123 // with the new operator var x = new foo();'),
    'foo(); // Is this global?: true\nconsole.log(global.foo); // 123\n// with the new operator\nvar x = new foo();');
});

test('removes Markdown escapes outside strings and joins split tokens', () => {
  assert.equal(format('var foo = {}; foo.\\_\\_proto\\_\\_.bar= 123;'), 'var foo = {};\nfoo.__proto__.bar = 123;');
  assert.equal(format('function\\* gen() { yield 1; }'), 'function* gen() {\n  yield 1;\n}');
  assert.equal(format("app.controller(['\\$scope', function (\\$scope) {}]);"), "app.controller(['$scope', function ($scope) {}]);");
});

test('breaks an object holding a function and splits the statement after it', () => {
  assert.equal(format("var foo = { bar: 123, bas: function () { console.log(this.bar); } } console.log(foo.bar);"), [
    'var foo = {',
    '  bar: 123,',
    '  bas: function () {',
    '    console.log(this.bar);',
    '  },',
    '}',
    'console.log(foo.bar);',
  ].join('\n'));
});

test('short objects and arrays stay on one line', () => {
  assert.equal(format("var foo = { a: 1, b: 'a string', c: [1, 2, 3] };"), "var foo = { a: 1, b: 'a string', c: [1, 2, 3] };");
});

test('a trailing comment never forces the code before it to wrap', () => {
  assert.equal(format("try { throw new Error('connection failed'); // Notify callback that connection succeeded? } catch (e) {}"),
    "try {\n  throw new Error('connection failed'); // Notify callback that connection succeeded?\n} catch (e) {}");
});

test('long call arguments break one per line', () => {
  assert.equal(format("someFunctionWithALongName(firstArgumentValue, secondArgumentValue, 'a third argument', 4);"), [
    'someFunctionWithALongName(',
    '  firstArgumentValue,',
    '  secondArgumentValue,',
    "  'a third argument',",
    '  4',
    ');',
  ].join('\n'));
});

test('callbacks hug their call, first or last argument', () => {
  assert.equal(format("setInterval(function() {console.log('tick');}, 1000)"),
    "setInterval(function () {\n  console.log('tick');\n}, 1000)");
  assert.equal(format('app.get(\'/\', (req, res) => { res.end(); });'), "app.get('/', (req, res) => {\n  res.end();\n});");
});

test('indents switch cases', () => {
  assert.equal(format('switch (x) { case 1: foo(); break; default: bar(); }'),
    'switch (x) {\n  case 1:\n    foo();\n    break;\n  default:\n    bar();\n}');
});

test('keywords used as property names are spaced like names', () => {
  assert.equal(format('p.then(function (v) { a(v); }).catch(function (e) { b(e); });'),
    'p.then(function (v) {\n  a(v);\n}).catch(function (e) {\n  b(e);\n});');
});

test('comment boundaries: method chains and async functions end a comment', () => {
  assert.equal(format('var app = connect() // register a middleware .use(function (req, res, next) { next(); });'),
    'var app = connect() // register a middleware\n  .use(function (req, res, next) {\n    next();\n  });');
  assert.equal(format('w.reject(e); // Note the use of Error willReject .then(f);'),
    'w.reject(e); // Note the use of Error\nwillReject.then(f);');
  assert.equal(format('// A thought experiment async function foo() { await bar(); }'),
    '// A thought experiment\nasync function foo() {\n  await bar();\n}');
});

test('code continuing after several comments is indented once', () => {
  assert.equal(format('p // first .then(a) // second .catch(b);'), 'p // first\n  .then(a) // second\n  .catch(b);');
});

test('comment boundaries: prose that merely mentions code stays in the comment', () => {
  assert.equal(format('// an async function to load an item function loadItem(id) {}'),
    '// an async function to load an item\nfunction loadItem(id) {}');
  assert.equal(format('// logs on Unix: /foo console.log(1);'), '// logs on Unix: /foo\nconsole.log(1);');
});

test('comment boundaries in semicolon-free code', () => {
  assert.equal(format('getUrl() { // define method without "function" return "http://" + this.url }'),
    'getUrl() {\n  // define method without "function"\n  return "http://" + this.url\n}');
  assert.equal(format('// return the value x()'), '// return the value\nx()');
});

test('debugger, break and continue end a statement', () => {
  assert.equal(format('debugger http.createServer()'), 'debugger\nhttp.createServer()');
  assert.equal(format('switch (m) { case 1: a() break // next one case 2: b() }'),
    'switch (m) {\n  case 1:\n    a()\n    break // next one\n  case 2:\n    b()\n}');
});

test('comments after a trailing comment are standalone lines', () => {
  assert.equal(format('const d = new D() // All the info in event // "handler" is defined here exports.handler = 1'),
    'const d = new D() // All the info in event\n// "handler" is defined here\nexports.handler = 1');
});

test('semicolon-free if/else on one line gets a line break before else', () => {
  assert.equal(format('if (ok) return next() else return res.send(401)'), 'if (ok) return next()\nelse return res.send(401)');
  assert.equal(format('if (ok) { a() } else { b() }'), 'if (ok) {\n  a()\n} else {\n  b()\n}');
});

test('a run of spaces inside a comment marks a lost line break', () => {
  assert.equal(format("switch (m) {    // Key is in payload    case 'DELETE':      del()      break }"),
    "switch (m) {\n  // Key is in payload\n  case 'DELETE':\n    del()\n    break\n}");
});

test('a Markdown-escaped block comment is a comment, not a regex', () => {
  assert.equal(format('var foo = /\\* whatever you want \\*/ 1;'), 'var foo = /* whatever you want */ 1;');
});

test('tells regular expressions from division', () => {
  assert.equal(format('var re = /ab+c/i; var x = a / b / c;'), 'var re = /ab+c/i;\nvar x = a / b / c;');
});

test('formatting is stable', () => {
  const once = format("var http = require('http'); http.createServer(function (req, res) { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('hi'); }).listen(3000); // listen");
  assert.equal(format(once), once);
});

test('a stray } from a page break ends its statement like a block', () => {
  assert.equal(format('res.end(); } var server = 1;'), 'res.end();\n}\nvar server = 1;');
  assert.equal(format('send(); } else { b(); }'), 'send();\n} else {\n  b();\n}');
  assert.equal(format("res.end(); } ).listen(3000);"), 'res.end();\n}).listen(3000);');
});

test('code cut off at a page break is formatted but reported as not compiling', () => {
  const result = formatJs('function send404(response) { response.writeHead(404, {');
  assert.equal(result.skipped, undefined);
  assert.equal(result.valid, false);
});

test('compiles() checks syntax without running the code', () => {
  assert.equal(compiles('process.exit(1)'), true);
  assert.equal(compiles('return 1;'), true); // allowed inside the async-function wrapper
  assert.equal(compiles('var = ;'), false);
});

test('formats JSON and rejects non-JSON', () => {
  assert.equal(formatJson('{ "main" : "./lib/main.js" }').code, '{ "main": "./lib/main.js" }');
  const pkg = formatJson('{ "name": "foo", "version": "0.0.0", "description": "", "main": "index.js", "scripts": { "test": "echo" }, "author": "", "license": "ISC" }');
  assert.equal(pkg.code.split('\n').length, 9);
  assert.equal(pkg.valid, true);
  assert.equal(formatJson('{ name: "foo" }'), null);
});
