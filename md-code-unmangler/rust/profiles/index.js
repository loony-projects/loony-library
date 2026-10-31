'use strict';

const boldKeywords = require('./bold-keywords');
const boldPlainComments = require('./bold-plain-comments');
const keywordDensity = require('./keyword-density');

const PROFILES = [boldKeywords, boldPlainComments, keywordDensity];

function getProfile(name) {
  const profile = PROFILES.find((p) => p.name === name);
  if (!profile) {
    const names = PROFILES.map((p) => p.name).join(', ');
    throw new Error(`Unknown profile "${name}". Available: ${names}`);
  }
  return profile;
}

// Picks whichever profile's isCodeParagraph matches more lines in the
// given file contents. Most profiles are unambiguous this way - one's
// detection heuristic is tuned to a marker another book's conversion
// never produces - but bold-keywords and bold-plain-comments share the
// exact same detection (both bold every keyword) and only differ in
// their comment convention, so they always tie on count alone. When the
// top profiles tie, each gets a chance to break it via its own
// `tieBreakScore(matchedLines)`, which looks at the actual comment style
// used in the lines that matched.
function detectProfile(fileContents) {
  const matchedLinesByProfile = new Map(PROFILES.map((p) => [p, []]));

  for (const content of fileContents) {
    let fence = null;
    for (const line of content.split('\n')) {
      // Code that is already fenced says nothing about how the rest was extracted.
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (marker && (!fence || (marker[1][0] === fence[0] && marker[1].length >= fence.length))) {
        fence = fence ? null : marker[1];
        continue;
      }
      if (fence) continue;
      for (const profile of PROFILES) {
        if (profile.isCodeParagraph(line)) matchedLinesByProfile.get(profile).push(line);
      }
    }
  }

  const scores = PROFILES.map((profile) => ({
    profile,
    count: matchedLinesByProfile.get(profile).length,
  }));
  scores.sort((a, b) => b.count - a.count);

  if (scores[0].count === 0) {
    throw new Error(
      'Could not auto-detect a profile: no code paragraphs matched any known profile. ' +
        'Pass --profile explicitly.'
    );
  }

  const tied = scores.filter((s) => s.count === scores[0].count);
  if (tied.length === 1) {
    const runnerUp = scores[1];
    return { profile: tied[0].profile, scores, confident: !runnerUp || tied[0].count > runnerUp.count };
  }

  const tieBreak = tied
    .map((s) => ({
      profile: s.profile,
      score: s.profile.tieBreakScore ? s.profile.tieBreakScore(matchedLinesByProfile.get(s.profile)) : 0,
    }))
    .sort((a, b) => b.score - a.score);

  const confident = tieBreak.length < 2 || tieBreak[0].score > tieBreak[1].score;
  return { profile: tieBreak[0].profile, scores, confident, tieBreak };
}

module.exports = { PROFILES, getProfile, detectProfile };
