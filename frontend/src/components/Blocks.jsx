import DOMPurify from "dompurify";
import { api } from "../api";
import { highlightCode } from "../highlight";
import { renderBlock, renderInline } from "../renderMarkdown";

// Renders the block's own stored markdown (bold, italic, inline code,
// links - see migration/src/parseFile.js and backend/src/parseMarkdown.js,
// which keep the original source alongside the flattened `text` used for
// search) instead of the flattened plain text, so what's on the page
// matches what the editor's live preview already showed while writing it.
function Paragraph({ content }) {
  return (
    <p
      dangerouslySetInnerHTML={{
        __html: renderInline(content.markdown || content.text),
      }}
    />
  );
}

function ListBlock({ content }) {
  return (
    <div
      className="block-list"
      dangerouslySetInnerHTML={{ __html: renderBlock(content.markdown) }}
    />
  );
}

function ImageBlock({ content }) {
  return (
    <figure className="block-image">
      <img
        src={api.imageUrl(content.src)}
        alt={content.alt || content.caption || ""}
      />
      {content.caption && <figcaption>{content.caption}</figcaption>}
    </figure>
  );
}

function TableBlock({ content }) {
  return (
    <div
      className="block-table-wrap"
      dangerouslySetInnerHTML={{ __html: renderBlock(content.markdown) }}
    />
  );
}

function BlockquoteBlock({ content }) {
  return (
    <div
      className="block-blockquote"
      dangerouslySetInnerHTML={{ __html: renderBlock(content.markdown) }}
    />
  );
}

function CodeBlock({ content }) {
  const { html, language } = highlightCode(content.code, content.lang);
  return (
    <pre className="block-code">
      <code
        className={`hljs language-${language}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </pre>
  );
}

// "border: 1px solid #333; padding: 15px" -> { border: "1px solid #333",
// padding: "15px" } - React's style prop wants an object, not the raw
// attribute string.
function parseStyleAttribute(styleStr) {
  const style = {};
  for (const declaration of styleStr.split(";")) {
    const i = declaration.indexOf(":");
    if (i === -1) continue;
    const prop = declaration.slice(0, i).trim();
    const value = declaration.slice(i + 1).trim();
    if (!prop || !value) continue;
    style[prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  return style;
}

// A handful of HTML attributes React exposes under a different prop name
// than the one authors actually write.
const ATTR_TO_PROP = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  readonly: "readOnly",
};

// Sanitizes the wrapper's own opening/closing tag (its attributes are
// otherwise never checked - only each child block sanitizes its own
// content) by round-tripping a placeholder-free version through DOMPurify,
// then reads the tag name and surviving attributes back out with the
// browser's own HTML parser rather than hand-rolled attribute parsing.
function sanitizeWrapperTag(openTag, closeTag) {
  const clean = DOMPurify.sanitize(`${openTag}${closeTag}`);
  const el = new DOMParser().parseFromString(clean, "text/html").body
    .firstElementChild;
  if (!el) return null; // DOMPurify rejected the tag entirely (e.g. <script>)
  const props = {};
  for (const attr of el.attributes) {
    if (attr.name === "style") {
      props.style = parseStyleAttribute(attr.value);
      continue;
    }
    props[ATTR_TO_PROP[attr.name] || attr.name] = attr.value;
  }
  return { tagName: el.tagName.toLowerCase(), props };
}

// A block-level HTML tag whose matching close tag was found later in the
// source (see mergeHtmlWrappers in parseMarkdown.js/parseFile.js) - renders
// as a real wrapping element around its children, each dispatched back
// through Block so ordinary markdown, nested HTML, code, images etc. all
// render exactly as they would as top-level blocks.
function HtmlWrapperBlock({ content }) {
  const parsed = sanitizeWrapperTag(content.openTag, content.closeTag);
  if (!parsed)
    return content.children.map((child, i) => <Block key={i} block={child} />);
  const Tag = parsed.tagName;
  return (
    <Tag {...parsed.props}>
      {content.children.map((child, i) => (
        <Block key={i} block={child} />
      ))}
    </Tag>
  );
}

// A standalone raw-HTML block from the source markdown - sanitized here,
// at render time, since this is persisted content shown to every future
// viewer (unlike the editor's own live preview, which only ever renders in
// the editing user's browser).
function HtmlBlock({ content }) {
  if (content.children) return <HtmlWrapperBlock content={content} />;
  return (
    <div
      className="block-html"
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content.html) }}
    />
  );
}

// An in-book heading that isn't a real document section (e.g. "a) Adding
// personal prenominal prefixes:" or "{a-}:" inside a worked example) - kept
// out of navigation, rendered in place as a minor heading instead.
function SubheadingBlock({ content }) {
  return <h4 className="block-subheading">{content.text}</h4>;
}

const RENDERERS = {
  paragraph: Paragraph,
  list: ListBlock,
  image: ImageBlock,
  table: TableBlock,
  blockquote: BlockquoteBlock,
  subheading: SubheadingBlock,
  code: CodeBlock,
  html: HtmlBlock,
};

export default function Block({ block }) {
  const Renderer = RENDERERS[block.block_type];
  if (!Renderer) return null;
  return <Renderer content={block.content} />;
}
