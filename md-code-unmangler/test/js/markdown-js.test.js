'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatJsMarkdown, classify, looksLikeJs } = require('../../js/markdown-js.cjs');

const run = markdown => formatJsMarkdown(markdown).text;

test('fences a flattened JavaScript paragraph', () => {
  assert.equal(run('Intro.\n\nvar a = 1; console.log(a);\n\nMore prose.'),
    'Intro.\n\n```js\nvar a = 1;\nconsole.log(a);\n```\n\nMore prose.');
});

test('splits a listing caption from the code on the same line', () => {
  assert.equal(run("*Listing 2-43.* error1.js try { throw new Error('x'); } catch (e) { console.log(e); }"),
    "*Listing 2-43.* error1.js\n\n```js\ntry {\n  throw new Error('x');\n} catch (e) {\n  console.log(e);\n}\n```");
});

test('splits several listings squashed into one paragraph', () => {
  const out = run("module.exports = { something: 123 }; *Listing 3-10.* app.js var foo = require('./foo'); "
    + '*Listing 3-12.* Sample Run of app.js \\$ node app.js initial something: 123');
  assert.equal(out, [
    '```js', 'module.exports = { something: 123 };', '```', '',
    '*Listing 3-10.* app.js', '', '```js', "var foo = require('./foo');", '```', '',
    '*Listing 3-12.* Sample Run of app.js', '', '```console', '$ node app.js initial something: 123', '```',
  ].join('\n'));
});

test('splits a running page header from code', () => {
  assert.equal(run("Chapter 6 ■ Getting Started with HTTP response.end(); }"),
    'Chapter 6 ■ Getting Started with HTTP\n\n```js\nresponse.end();\n}\n```');
});

test('shell sessions get one command per line', () => {
  assert.equal(run('\\$ node app.js -t 100 { \\_: [], t: 100 } \\$ node app.js -rfs'),
    '```console\n$ node app.js -t 100 { _: [], t: 100 }\n$ node app.js -rfs\n```');
});

test('HTML gets one tag per line, short elements on one line', () => {
  assert.equal(run('<html> <script src="./require.js"> </script> <body> <p>Hello</p> </body> </html>'),
    '```html\n<html>\n  <script src="./require.js"></script>\n  <body>\n    <p>Hello</p>\n  </body>\n</html>\n```');
});

test('JSON is pretty-printed', () => {
  assert.equal(run('{ "main" : "./lib/main.js" }'), '```json\n{ "main": "./lib/main.js" }\n```');
});

test('prose, including prose that mentions code, is left alone', () => {
  for (const prose of [
    'We will be using server.js, which is a very basic HTTP web server (node server.js).',
    'function is a first-class citizen in JavaScript.',
    'var is function scoped, unlike let.',
    'Also worth mentioning is the fact that catch(function(){}) is just sugar for then(null,function(){}). So it works.',
  ]) assert.equal(run(prose), prose);
});

test('recognizes code that continues a listing from the previous page', () => {
  assert.equal(looksLikeJs("} else { console.log('b'); }"), true);
  assert.equal(looksLikeJs(".use('/home', function (req, res) { res.end(); })"), true);
  assert.equal(looksLikeJs('Person .find({ city: \'LA\' }).exec(callback);'), true);
  assert.equal(looksLikeJs('function send404(response) { response.end(); }'), true); // digits in the name
});

test('classifies each kind of code', () => {
  assert.equal(classify('\\$ npm install'), 'console');
  assert.equal(classify('<!DOCTYPE html> <html></html>'), 'html');
  assert.equal(classify('[ { "a": 1 } ]'), 'json');
  assert.equal(classify("console.log('hi');"), 'js');
  assert.equal(classify('Hello world.'), null);
});

test('formats existing js fences and leaves other fences untouched', () => {
  assert.equal(run('```js\nvar a={b:1}\n```\n\n```py\nx  =  1\n```'), '```js\nvar a = { b: 1 }\n```\n\n```py\nx  =  1\n```');
});

test('removes bold keyword markers but keeps the ** operator', () => {
  assert.equal(run("**const** messages = require(**path**.join(\\_\\_**dirname**, 'routes')); x = a ** 2;"),
    "```js\nconst messages = require(path.join(__dirname, 'routes'));\nx = a ** 2;\n```");
});

test('an italic comment ends exactly at its closing *', () => {
  assert.equal(run('f() *//outputs Boo* console.log(f.boo) *//outputs 1*'),
    '```js\nf() //outputs Boo\nconsole.log(f.boo) //outputs 1\n```');
});

test('a sentence on the line after a listing stays prose', () => {
  assert.equal(run("var a = 1; b();\nSo either copy or type the code shown prior into a file."),
    '```js\nvar a = 1;\nb();\n```\n\nSo either copy or type the code shown prior into a file.');
});

test('keeps CRLF line endings', () => {
  assert.equal(run("Text.\r\n\r\nvar a = 1; b();\r\n"), 'Text.\r\n\r\n```js\r\nvar a = 1;\r\nb();\r\n```\r\n');
});
