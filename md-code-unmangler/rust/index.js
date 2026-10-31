'use strict';

/**
 * Rust step of the cleaner (run via `node cleaner/index.cjs --lang rust`).
 * Converts Rust listings that PDF-to-Markdown conversion squashed onto one
 * paragraph line back into indented ```rs fenced blocks. Each source style is
 * a profile (see profiles/); all profiles share the brace-depth reflow engine.
 */
const { reflow } = require('./reflow');
const { convertParagraph, convertFile, convertMarkdown } = require('./convert');
const { PROFILES, getProfile, detectProfile } = require('./profiles');

module.exports = {
  reflow,
  convertParagraph,
  convertFile,
  convertMarkdown,
  PROFILES,
  getProfile,
  detectProfile,
};
