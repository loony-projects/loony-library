import hljs from "highlight.js/lib/common";

// `lib/common` registers ~40 popular languages (including the ones this
// library's books actually use - Rust, Python, C/C++, ...) instead of
// hljs's full ~190-language build, keeping the bundle small.
export function highlightCode(code, lang) {
  const result =
    lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang }) : hljs.highlightAuto(code);
  return { html: result.value, language: result.language || "plaintext" };
}
