import test from "node:test";
import assert from "node:assert/strict";
import { Marked } from "marked";
import { mathExtensions } from "../src/mathMarkdown.js";

const md = new Marked({ extensions: mathExtensions });
const formulas = (text) => (md.parse(text).match(/class="katex"/g) || []).length;

test("inline and display math render; LaTeX markdown would mangle survives", () => {
  assert.equal(formulas("the ratio $\\frac{a}{b}$ and $x_1 + x_2$"), 2);
  assert.equal(formulas("$$E = mc^2$$"), 1);
  assert.match(md.parse("$x_1 + x_2$"), /katex/);
  assert.doesNotMatch(md.parse("$x_1 + x_2$"), /<em>/);
});

test("Bodo text: the danda, attached postpositions and operators close a formula", () => {
  assert.equal(formulas("बिदाबा $ab$। बेनि $a$ आरो $b$"), 3);
  assert.equal(formulas("$x$आ $y$नि"), 2);
  assert.equal(formulas("= $\\frac{1}{2}$∠ABQ, $\\frac{1}{4}$(sum), $\\frac{1}{4}$th part"), 3);
});

test("prices, shell prompts and shell variables stay text", () => {
  for (const text of ["costs $5 or $10.", "price $5,$10 each", "luciano$ telnet localhost luciano$ ok", "echo $HOME and $PATH", "echo $HOME and $(date)"]) {
    assert.equal(formulas(text), 0, text);
  }
});

test("bad LaTeX shows as an error span, not a crash", () => {
  assert.match(md.parse("$\\frac{1}{$"), /katex-error|\$\\frac/);
});
