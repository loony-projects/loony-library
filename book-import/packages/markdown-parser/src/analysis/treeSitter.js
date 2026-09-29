import { createRequire } from "node:module";
import { registerAnalyzer } from "./registry.js";

// Level-2 syntax analysis backed by tree-sitter grammars (WASM builds, via
// web-tree-sitter - no native compilation, no network, nothing executed).
// tree-sitter is error-tolerant: a book fragment such as a bare statement
// list or a truncated function still yields a tree, with ERROR/MISSING
// nodes marking what didn't parse. Facts below are read only from node
// types and fields the grammar actually defines; nothing is inferred from
// text patterns.
//
// Facts are top-level only (declarations directly in the snippet, or
// directly inside an ERROR node at the top level of a fragment), because
// that's what the grammar makes unambiguous: a nested `let` is a local, not
// a declaration the snippet exports.

const require = createRequire(import.meta.url);
const MAX_SNIPPET_BYTES = 256 * 1024;
const MAX_SYNTAX_ERRORS = 20;

let runtime = null; // Promise<{ Parser, Language }> - module-level loader cache only; no parse state
const grammars = new Map(); // wasm path -> Promise<{ parser, version }>

function loadRuntime() {
  runtime ??= import("web-tree-sitter").then(async ({ Parser, Language }) => {
    await Parser.init();
    return { Parser, Language };
  });
  return runtime;
}

function loadGrammar(pkg, wasm) {
  const key = `${pkg}/${wasm}`;
  if (!grammars.has(key)) {
    grammars.set(
      key,
      loadRuntime().then(async ({ Parser, Language }) => {
        const language = await Language.load(require.resolve(key));
        const parser = new Parser();
        parser.setLanguage(language);
        const { version } = require(`${pkg}/package.json`);
        return { parser, version };
      })
    );
  }
  return grammars.get(key);
}

function range(node) {
  return {
    startLine: node.startPosition.row + 1,
    startColumn: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1,
  };
}

const field = (node, name) => node?.childForFieldName(name) ?? null;
const fields = (node, name) => node?.childrenForFieldName(name)?.filter(Boolean) ?? [];
const textOf = (node) => (node ? node.text : null);

function collectSyntaxErrors(root) {
  const errors = [];
  if (!root.hasError) return errors;
  const walk = (node) => {
    if (errors.length >= MAX_SYNTAX_ERRORS) return;
    if (node.isMissing) {
      errors.push({ message: `Missing "${node.type}"`, range: range(node) });
      return;
    }
    if (node.type === "ERROR") {
      const excerpt = node.text.replace(/\s+/g, " ").slice(0, 40);
      errors.push({ message: `Unexpected syntax: "${excerpt}"`, range: range(node) });
      return;
    }
    if (node.hasError) for (const child of node.children) walk(child);
  };
  walk(root);
  return errors;
}

function hasErrorReaching(root, end) {
  const walk = (node) => {
    if ((node.type === "ERROR" || node.isMissing) && node.endIndex >= end) return true;
    return node.hasError && node.children.some(walk);
  };
  return walk(root);
}

// Calls visit(node) for each top-level named node, descending into ERROR
// nodes (a fragment's recoverable declarations often sit inside one).
function forEachTopLevel(root, visit) {
  for (const node of root.namedChildren) {
    if (node.type === "ERROR") forEachTopLevel(node, visit);
    else visit(node);
  }
}

// ---- per-language fact extraction ----------------------------------------

function declaration(kind, nameNode, node, exported = null) {
  return { kind, name: nameNode ? textOf(nameNode) : null, exported, range: range(node) };
}

const RUST_ITEMS = {
  function_item: "function",
  function_signature_item: "function",
  struct_item: "struct",
  enum_item: "enum",
  union_item: "union",
  trait_item: "trait",
  type_item: "type",
  const_item: "const",
  static_item: "static",
  mod_item: "module",
  macro_definition: "macro",
};

function rustFacts(root) {
  const imports = [];
  const declarations = [];
  forEachTopLevel(root, (node) => {
    const isPub = node.namedChildren.some((c) => c.type === "visibility_modifier");
    if (node.type === "use_declaration") imports.push({ source: textOf(field(node, "argument")), range: range(node) });
    else if (node.type === "extern_crate_declaration") imports.push({ source: textOf(field(node, "name")), range: range(node) });
    else if (RUST_ITEMS[node.type]) declarations.push(declaration(RUST_ITEMS[node.type], field(node, "name"), node, isPub));
    else if (node.type === "impl_item") {
      const trait = textOf(field(node, "trait"));
      const type = textOf(field(node, "type"));
      declarations.push({ kind: "impl", name: trait ? `${trait} for ${type}` : type, exported: null, range: range(node) });
    } else if (node.type === "let_declaration") declarations.push(declaration("variable", field(node, "pattern"), node));
  });
  return { imports, declarations };
}

const C_NAME_TYPES = new Set([
  "identifier",
  "field_identifier",
  "type_identifier",
  "qualified_identifier",
  "destructor_name",
  "operator_name",
  "template_function",
]);

function declaratorName(node) {
  let current = node;
  for (let i = 0; current && i < 16; i++) {
    if (C_NAME_TYPES.has(current.type)) return current;
    current = field(current, "declarator") ?? current.namedChildren.find((c) => c.type.endsWith("declarator") || C_NAME_TYPES.has(c.type)) ?? null;
  }
  return null;
}

function hasFunctionDeclarator(node) {
  let current = node;
  for (let i = 0; current && i < 16; i++) {
    if (current.type === "function_declarator") return true;
    current = field(current, "declarator");
  }
  return false;
}

const isStatic = (node) => node.namedChildren.some((c) => c.type === "storage_class_specifier" && c.text === "static");

const C_TYPE_SPECIFIERS = { struct_specifier: "struct", union_specifier: "union", enum_specifier: "enum", class_specifier: "class" };

function cFamilyFacts(root, { cpp }) {
  const imports = [];
  const declarations = [];

  const typeSpecifier = (node) => {
    const kind = C_TYPE_SPECIFIERS[node.type];
    if (kind && field(node, "name") && field(node, "body")) declarations.push(declaration(kind, field(node, "name"), node));
  };

  const visit = (node) => {
    switch (node.type) {
      case "preproc_include":
        imports.push({ source: textOf(field(node, "path")), range: range(node) });
        return;
      case "preproc_def":
      case "preproc_function_def":
        declarations.push(declaration("macro", field(node, "name"), node));
        return;
      case "function_definition":
        declarations.push(declaration("function", declaratorName(field(node, "declarator")), node, !isStatic(node)));
        return;
      case "declaration": {
        typeSpecifier(field(node, "type") ?? node);
        for (const d of fields(node, "declarator")) {
          const kind = hasFunctionDeclarator(d) ? "function" : "variable";
          declarations.push(declaration(kind, declaratorName(d), node, !isStatic(node)));
        }
        return;
      }
      case "type_definition":
        typeSpecifier(field(node, "type") ?? node);
        for (const d of fields(node, "declarator")) declarations.push(declaration("typedef", declaratorName(d), node));
        return;
      case "struct_specifier":
      case "union_specifier":
      case "enum_specifier":
      case "class_specifier":
        typeSpecifier(node);
        return;
      default:
        break;
    }
    if (!cpp) return;
    switch (node.type) {
      case "namespace_definition":
        declarations.push(declaration("namespace", field(node, "name"), node));
        return;
      case "template_declaration":
        for (const child of node.namedChildren) if (child.type !== "template_parameter_list") visit(child);
        return;
      case "linkage_specification":
        for (const child of field(node, "body")?.namedChildren ?? []) visit(child);
        return;
      case "alias_declaration":
        declarations.push(declaration("type", field(node, "name"), node));
        return;
      case "using_declaration":
        imports.push({ source: node.text.replace(/^using\s+|;$/g, "").trim(), range: range(node) });
        return;
      default:
        // class body fragments ("class A { ... };" parses as a declaration
        // or a bare specifier followed by ";") - specifier handled above.
        if (C_TYPE_SPECIFIERS[node.type]) typeSpecifier(node);
    }
  };
  forEachTopLevel(root, visit);
  return { imports, declarations };
}

const goExported = (name) => (name ? /^\p{Lu}/u.test(name) : null);

function goFacts(root) {
  const imports = [];
  const declarations = [];
  let packageName = null;
  const named = (kind, nameNode, node) => {
    const d = declaration(kind, nameNode, node);
    d.exported = goExported(d.name);
    declarations.push(d);
  };
  forEachTopLevel(root, (node) => {
    switch (node.type) {
      case "package_clause":
        packageName = textOf(node.namedChildren[0]);
        break;
      case "import_declaration":
        for (const spec of node.descendantsOfType("import_spec")) {
          imports.push({ source: textOf(field(spec, "path"))?.replace(/^"|"$/g, "") ?? null, range: range(spec) });
        }
        break;
      case "function_declaration":
        named("function", field(node, "name"), node);
        break;
      case "method_declaration":
        named("method", field(node, "name"), node);
        break;
      case "type_declaration":
        for (const spec of node.namedChildren) if (field(spec, "name")) named("type", field(spec, "name"), spec);
        break;
      case "var_declaration":
      case "const_declaration": {
        const kind = node.type === "var_declaration" ? "variable" : "const";
        for (const spec of node.descendantsOfType(["var_spec", "const_spec"])) for (const n of fields(spec, "name")) named(kind, n, spec);
        break;
      }
      case "short_var_declaration":
        for (const n of field(node, "left")?.namedChildren ?? []) if (n.type === "identifier") named("variable", n, node);
        break;
      default:
        break;
    }
  });
  return { imports, declarations, package: packageName };
}

const JAVA_TYPES = {
  class_declaration: "class",
  interface_declaration: "interface",
  enum_declaration: "enum",
  record_declaration: "record",
  annotation_type_declaration: "annotation",
  method_declaration: "method",
  constructor_declaration: "constructor",
};

function javaFacts(root) {
  const imports = [];
  const declarations = [];
  let packageName = null;
  const isPublic = (node) => {
    const modifiers = node.namedChildren.find((c) => c.type === "modifiers");
    return modifiers ? /\bpublic\b/.test(modifiers.text) : false;
  };
  forEachTopLevel(root, (node) => {
    if (node.type === "package_declaration") packageName = textOf(node.namedChildren.find((c) => c.type !== "annotation"));
    else if (node.type === "import_declaration") imports.push({ source: node.text.replace(/^import\s+(static\s+)?|;$/g, "").trim(), range: range(node) });
    else if (JAVA_TYPES[node.type]) declarations.push(declaration(JAVA_TYPES[node.type], field(node, "name"), node, isPublic(node)));
    else if (node.type === "field_declaration" || node.type === "local_variable_declaration") {
      for (const d of fields(node, "declarator")) declarations.push(declaration("variable", field(d, "name"), node, node.type === "field_declaration" ? isPublic(node) : null));
    }
  });
  return { imports, declarations, package: packageName };
}

function pythonFacts(root) {
  const imports = [];
  const declarations = [];
  const visit = (node) => {
    if (["import_statement", "import_from_statement", "future_import_statement"].includes(node.type)) {
      imports.push({ source: node.text.replace(/\s+/g, " "), range: range(node) });
    } else if (node.type === "function_definition") declarations.push(declaration("function", field(node, "name"), node));
    else if (node.type === "class_definition") declarations.push(declaration("class", field(node, "name"), node));
    else if (node.type === "decorated_definition") visit(field(node, "definition"));
    else if (node.type === "expression_statement") {
      const assignment = node.namedChildren.find((c) => c.type === "assignment");
      const left = field(assignment, "left");
      if (left?.type === "identifier") declarations.push(declaration("variable", left, node));
    }
  };
  forEachTopLevel(root, (node) => node && visit(node));
  return { imports, declarations };
}

const JS_DECLARATIONS = {
  function_declaration: "function",
  generator_function_declaration: "function",
  function_signature: "function",
  class_declaration: "class",
  abstract_class_declaration: "class",
  interface_declaration: "interface",
  type_alias_declaration: "type",
  enum_declaration: "enum",
  internal_module: "namespace",
  module: "namespace",
};

function jsFacts(root) {
  const imports = [];
  const declarations = [];
  const visit = (node, exported) => {
    if (!node) return;
    if (node.type === "import_statement") {
      imports.push({ source: textOf(field(node, "source"))?.replace(/^["'`]|["'`]$/g, "") ?? null, range: range(node) });
    } else if (node.type === "export_statement") {
      const inner = field(node, "declaration");
      if (inner) visit(inner, true);
      else if (field(node, "value")) declarations.push({ kind: "default", name: "default", exported: true, range: range(node) });
      else {
        for (const spec of node.descendantsOfType("export_specifier")) {
          declarations.push({ kind: "export", name: textOf(field(spec, "alias") ?? field(spec, "name")), exported: true, range: range(spec) });
        }
        if (field(node, "source")) imports.push({ source: textOf(field(node, "source")).replace(/^["'`]|["'`]$/g, ""), range: range(node) });
      }
    } else if (node.type === "ambient_declaration") {
      for (const child of node.namedChildren) visit(child, exported);
    } else if (JS_DECLARATIONS[node.type]) {
      declarations.push(declaration(JS_DECLARATIONS[node.type], field(node, "name"), node, exported));
    } else if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
      for (const d of node.namedChildren.filter((c) => c.type === "variable_declarator")) {
        declarations.push(declaration("variable", field(d, "name"), node, exported));
      }
    }
  };
  forEachTopLevel(root, (node) => visit(node, false));
  return { imports, declarations };
}

// ---- analyzers -------------------------------------------------------------

function treeSitterAnalyzer({ id, languages, grammar, facts }) {
  return {
    id,
    languages,
    async analyze(code, { label } = {}) {
      if (Buffer.byteLength(code) > MAX_SNIPPET_BYTES) {
        throw new Error(`snippet larger than ${MAX_SNIPPET_BYTES} bytes`);
      }
      const [pkg, wasm] = grammar(label);
      const { parser, version } = await loadGrammar(pkg, wasm);
      const tree = parser.parse(code);
      try {
        const root = tree.rootNode;
        const syntaxErrors = collectSyntaxErrors(root);
        // An error that reaches the end of the input means the parser ran out
        // of snippet mid-construct - typical of an example cut off by a page
        // break - rather than hitting bad syntax inside it.
        const end = code.trimEnd().length;
        const truncated = syntaxErrors.length > 0 && hasErrorReaching(root, end);
        return {
          parser: `${pkg}@${version}`,
          complete: syntaxErrors.length === 0,
          truncated,
          ...facts(root),
          syntaxErrors,
        };
      } finally {
        tree.delete();
      }
    },
  };
}

export const TREE_SITTER_ANALYZERS = [
  treeSitterAnalyzer({ id: "tree-sitter-rust", languages: ["rust"], grammar: () => ["tree-sitter-rust", "tree-sitter-rust.wasm"], facts: rustFacts }),
  treeSitterAnalyzer({ id: "tree-sitter-c", languages: ["c"], grammar: () => ["tree-sitter-c", "tree-sitter-c.wasm"], facts: (r) => cFamilyFacts(r, { cpp: false }) }),
  treeSitterAnalyzer({ id: "tree-sitter-cpp", languages: ["cpp"], grammar: () => ["tree-sitter-cpp", "tree-sitter-cpp.wasm"], facts: (r) => cFamilyFacts(r, { cpp: true }) }),
  treeSitterAnalyzer({ id: "tree-sitter-go", languages: ["go"], grammar: () => ["tree-sitter-go", "tree-sitter-go.wasm"], facts: goFacts }),
  treeSitterAnalyzer({ id: "tree-sitter-java", languages: ["java"], grammar: () => ["tree-sitter-java", "tree-sitter-java.wasm"], facts: javaFacts }),
  treeSitterAnalyzer({ id: "tree-sitter-python", languages: ["python"], grammar: () => ["tree-sitter-python", "tree-sitter-python.wasm"], facts: pythonFacts }),
  treeSitterAnalyzer({ id: "tree-sitter-javascript", languages: ["javascript"], grammar: () => ["tree-sitter-javascript", "tree-sitter-javascript.wasm"], facts: jsFacts }),
  treeSitterAnalyzer({
    id: "tree-sitter-typescript",
    languages: ["typescript"],
    // "tsx" fences need the TSX grammar; everything else the plain one.
    grammar: (label) => ["tree-sitter-typescript", label?.toLowerCase() === "tsx" ? "tree-sitter-tsx.wasm" : "tree-sitter-typescript.wasm"],
    facts: jsFacts,
  }),
];

for (const analyzer of TREE_SITTER_ANALYZERS) registerAnalyzer(analyzer);
