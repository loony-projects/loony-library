// ZIP's stored method keeps this small exporter dependency-free.
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function zip(files) {
  const locals = [],
    central = [];
  let offset = 0;
  for (const [name, value] of files) {
    const n = Buffer.from(name),
      b = Buffer.isBuffer(value) ? value : Buffer.from(value),
      crc = crc32(b);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(b.length, 18);
    h.writeUInt32LE(b.length, 22);
    h.writeUInt16LE(n.length, 26);
    locals.push(h, n, b);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(b.length, 20);
    c.writeUInt32LE(b.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += h.length + n.length + b.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
export const xml = (s) =>
  String(s ?? "").replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
export async function epub(book, sections) {
  const { unified } = await import("unified");
  const { default: remarkParse } = await import("remark-parse");
  const { default: remarkGfm } = await import("remark-gfm");
  const { blocksToMarkdown } = await import("../../frontend/src/markdown.js");
  const { readFile } = await import("node:fs/promises");
  const { resolve, sep } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { imageType } = await import("./imageType.js");
  const parser = unified().use(remarkParse).use(remarkGfm);
  const assets = new Map();
  const root = fileURLToPath(new URL("../data/images/", import.meta.url));
  async function render(node) {
    if (node.type === "image") {
      // Only package local raster assets. Never fetch editor-supplied URLs.
      const filename = resolve(root, node.url);
      if (filename.startsWith(root.endsWith(sep) ? root : root + sep)) {
        try {
          const bytes = await readFile(filename),
            type = imageType(bytes);
          if (type) {
            if (!assets.has(filename))
              assets.set(filename, {
                name: `image-${assets.size}.${type}`,
                bytes,
                type,
              });
            return `<img src="${assets.get(filename).name}" alt="${xml(node.alt)}" />`;
          }
        } catch {
          /* Keep a descriptive fallback for missing assets. */
        }
      }
      return `<span>[Image: ${xml(node.alt || node.url)}]</span>`;
    }
    const children = (
      await Promise.all((node.children || []).map(render))
    ).join("");
    switch (node.type) {
      case "root":
        return children;
      case "text":
        return xml(node.value);
      case "paragraph":
        return `<p>${children}</p>`;
      case "heading":
        return `<h${node.depth}>${children}</h${node.depth}>`;
      case "strong":
        return `<strong>${children}</strong>`;
      case "emphasis":
        return `<em>${children}</em>`;
      case "delete":
        return `<del>${children}</del>`;
      case "inlineCode":
        return `<code>${xml(node.value)}</code>`;
      case "code":
        return `<pre><code>${xml(node.value)}</code></pre>`;
      case "blockquote":
        return `<blockquote>${children}</blockquote>`;
      case "list":
        return node.ordered ? `<ol>${children}</ol>` : `<ul>${children}</ul>`;
      case "listItem":
        return `<li>${children}</li>`;
      case "link":
        return /^(https?:|mailto:|#)/.test(node.url)
          ? `<a href="${xml(node.url)}">${children}</a>`
          : children;
      case "table":
        return `<table><tbody>${children}</tbody></table>`;
      case "tableRow":
        return `<tr>${children}</tr>`;
      case "tableCell":
        return `<td>${children}</td>`;
      case "thematicBreak":
        return "<hr />";
      case "break":
        return "<br />";
      // Raw HTML is represented as text to keep the package script-free.
      case "html":
        return `<pre>${xml(node.value)}</pre>`;
      default:
        return children;
    }
  }
  const pages = [];
  for (const [i, s] of sections.entries())
    pages.push({
      id: `s${i}`,
      title: s.title,
      body: await render(parser.parse(blocksToMarkdown(s.blocks))),
    });
  if (!pages.length)
    pages.push({
      id: "empty",
      title: book.title,
      body: "<p>No published sections.</p>",
    });
  const page = (title, body) =>
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${xml(title)}</title></head><body>${body}</body></html>`;
  const files = [
    ["mimetype", "application/epub+zip"],
    [
      "META-INF/container.xml",
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ],
  ];
  files.push([
    "OEBPS/nav.xhtml",
    page(
      "Contents",
      `<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><h1>Contents</h1><ol>${pages.map((p) => `<li><a href="${p.id}.xhtml">${xml(p.title)}</a></li>`).join("")}</ol></nav>`,
    ),
  ]);
  files.push([
    "OEBPS/package.opf",
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:uuid:${xml(book.id)}</dc:identifier><dc:title>${xml(book.title)}</dc:title><dc:language>${xml(book.language)}</dc:language><dc:creator>${xml(book.author)}</dc:creator><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z/, "Z")}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${pages.map((p) => `<item id="${p.id}" href="${p.id}.xhtml" media-type="application/xhtml+xml"/>`).join("")}${[...assets.values()].map((a, i) => `<item id="image${i}" href="${a.name}" media-type="image/${a.type === "jpg" ? "jpeg" : a.type}"/>`).join("")}</manifest><spine>${pages.map((p) => `<itemref idref="${p.id}"/>`).join("")}</spine></package>`,
  ]);
  for (const p of pages)
    files.push([
      `OEBPS/${p.id}.xhtml`,
      page(p.title, `<h1>${xml(p.title)}</h1>${p.body}`),
    ]);
  for (const a of assets.values()) files.push([`OEBPS/${a.name}`, a.bytes]);
  return zip(files);
}
