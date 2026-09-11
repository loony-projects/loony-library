import { api } from "../api";

function Paragraph({ content }) {
  return <p>{content.text}</p>;
}

function ListBlock({ content }) {
  const Tag = content.ordered ? "ol" : "ul";
  return (
    <Tag>
      {content.items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </Tag>
  );
}

function ImageBlock({ content }) {
  return (
    <figure className="block-image">
      <img src={api.imageUrl(content.src)} alt={content.alt || content.caption || ""} />
      {content.caption && <figcaption>{content.caption}</figcaption>}
    </figure>
  );
}

function TableBlock({ content }) {
  return (
    <div className="block-table-wrap">
      <table>
        {content.headers?.length > 0 && (
          <thead>
            <tr>
              {content.headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {content.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockquoteBlock({ content }) {
  return <blockquote>{content.text}</blockquote>;
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
};

export default function Block({ block }) {
  const Renderer = RENDERERS[block.block_type];
  if (!Renderer) return null;
  return <Renderer content={block.content} />;
}
