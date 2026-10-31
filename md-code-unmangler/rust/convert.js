'use strict';

const { reflow, restorePlaceholders } = require('./reflow');

function convertParagraph(line, profile) {
  // A profile whose source kept its indentation as runs of spaces lays the
  // code out from those first (see indentation.js).
  const laidOut = profile.layoutFromIndentation && profile.layoutFromIndentation(line);
  if (laidOut) return '```rs\n' + laidOut + '\n```';
  const { text, comments } = profile.stripPseudoMarkdown(line);
  const formatted = restorePlaceholders(reflow(text), comments);
  return '```rs\n' + formatted + '\n```';
}

// Converts every code paragraph in a markdown file's contents using the
// given profile. Lines that don't look like code (per
// profile.isCodeParagraph), and lines inside existing fences, pass through unchanged.
function convertFile(content, profile) {
  const lines = content.split('\n');
  let converted = 0;
  let fence = null;

  const out = lines.map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker && (!fence || (marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.trim().slice(marker[1].length)))) {
      fence = fence ? null : marker[1];
      return line;
    }
    if (fence || !profile.isCodeParagraph(line)) return line;
    converted++;
    return convertParagraph(line, profile);
  });

  return { text: out.join('\n'), changed: converted > 0, converted };
}

// Same as convertFile, but keeps the file's CRLF line endings, as the
// other cleaner steps do.
function convertMarkdown(content, profile) {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const result = convertFile(content.replace(/\r\n/g, '\n'), profile);
  return { ...result, text: result.text.replace(/\n/g, eol) };
}

module.exports = { convertParagraph, convertFile, convertMarkdown };
