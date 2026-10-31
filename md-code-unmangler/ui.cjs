'use strict';

/**
 * Terminal output helpers for the command line: colour, symbols, paths,
 * progress bars. No dependencies. Colour is used only on a terminal, and
 * follows the NO_COLOR (https://no-color.org) and FORCE_COLOR conventions.
 */

const os = require('os');
const path = require('path');

function colorEnabled(stream = process.stdout) {
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0') return true;
  if (process.env.NO_COLOR !== undefined) return false;
  return Boolean(stream.isTTY) && process.env.TERM !== 'dumb';
}

function makeStyle(enabled) {
  const wrap = (open, close) => text => (enabled ? `\x1b[${open}m${text}\x1b[${close}m` : String(text));
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    blue: wrap(34, 39),
    magenta: wrap(35, 39),
    cyan: wrap(36, 39),
    enabled,
  };
}

const SYMBOLS = { ok: '✔', warn: '⚠', error: '✖', info: '●', arrow: '→', dot: '·', bar: '█', track: '░' };

// /home/me/Books/x -> ~/Books/x
function tilde(file) {
  const home = process.env.HOME || os.homedir();
  const resolved = path.resolve(file);
  return resolved === home ? '~' : resolved.startsWith(home + path.sep) ? `~${resolved.slice(home.length)}` : resolved;
}

function bar(done, total, width = 20) {
  if (!total) return '';
  const filled = Math.round((Math.min(done, total) / total) * width);
  return SYMBOLS.bar.repeat(filled) + SYMBOLS.track.repeat(width - filled);
}

const percent = (done, total) => (total ? `${Math.round((done / total) * 100)}%` : '');

function duration(ms) {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Length without ANSI codes, for padding coloured text.
const visibleLength = text => String(text).replace(/\x1b\[\d+m/g, '').length;
const padEnd = (text, width) => text + ' '.repeat(Math.max(0, width - visibleLength(text)));

module.exports = { colorEnabled, makeStyle, SYMBOLS, tilde, bar, percent, duration, plural, padEnd, visibleLength };
