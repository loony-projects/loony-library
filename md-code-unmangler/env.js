'use strict';

const fs = require('fs');

// Minimal .env parser - deliberately dependency-free (no `dotenv` package)
// to keep this project at zero npm dependencies. Supports KEY=VALUE lines,
// blank lines, `#` comments, and optional matching single/double quotes
// around the value. Nothing more exotic (no variable expansion, no
// multiline values) - configs here are plain paths/names/flags.
function parseEnvContent(content) {
  const result = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key) continue;

    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
    if (quoted) value = value.slice(1, -1);

    result[key] = value;
  }
  return result;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return parseEnvContent(fs.readFileSync(filePath, 'utf8'));
}

// Merges parsed .env values into process.env, without overriding a
// variable that's already set in the real environment - matches the
// conventional dotenv precedence (real env wins over .env file values).
// Returns just the keys that were actually applied, for logging.
function applyEnv(parsed) {
  const applied = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      applied[key] = value;
    }
  }
  return applied;
}

function parseBoolEnv(value) {
  if (value === undefined) return undefined;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

module.exports = { parseEnvContent, loadEnvFile, applyEnv, parseBoolEnv };
