# Loony Library — ER Diagram

Entity-relationship diagram for the schema described in [app_idea.md](./app_idea.md) and implemented in [migration/schema.sql](../migration/schema.sql).

```mermaid
erDiagram
    BOOKS ||--o{ CHAPTERS : has
    CHAPTERS ||--o{ SECTIONS : has
    SECTIONS ||--o{ SECTIONS : "parent_id (subsections)"
    SECTIONS ||--o{ CONTENT_BLOCKS : has
    CONTENT_BLOCKS ||--o| FIGURES : "block_type = image"
    CONTENT_BLOCKS ||--o| TABLES : "block_type = table"
    BOOKS ||--o{ GLOSSARY_TERMS : has
    BOOKS ||--o{ SYMBOLS : has

    BOOKS {
        uuid id PK
        text title
        text author
        text publisher
        text isbn
        text edition
        text price
        int published_year
    }

    CHAPTERS {
        uuid id PK
        uuid book_id FK
        text number "1..16, null = front matter"
        text slug
        text title
        int sort_order
    }

    SECTIONS {
        uuid id PK
        uuid chapter_id FK
        uuid parent_id FK "self-reference, nullable"
        text numbering "3.3.1.2.1, nullable"
        text title
        int depth
        int sort_order
        text source_file "traceability only"
    }

    CONTENT_BLOCKS {
        uuid id PK
        uuid section_id FK
        text block_type "paragraph|list|image|table|blockquote|subheading|code"
        int sort_order
        jsonb content
        tsvector tsv "generated, indexed"
    }

    FIGURES {
        uuid id PK
        uuid content_block_id FK
        text image_path
        text caption
        text alt_text
    }

    TABLES {
        uuid id PK
        uuid content_block_id FK
        jsonb headers
        jsonb rows
    }

    GLOSSARY_TERMS {
        uuid id PK
        uuid book_id FK
        text term
        text expansion
        text category
    }

    SYMBOLS {
        uuid id PK
        uuid book_id FK
        text symbol
        text description
    }
```

## Reading the diagram

- **BOOKS → CHAPTERS → SECTIONS** is the outline. `SECTIONS` self-references via `parent_id` because the source numbering nests arbitrarily deep (e.g. `1.5.4.1.1.1`); `depth` is derived from the dot-count in `numbering`, not from the markdown `#` level, since the source markdown is inconsistent about heading levels.
- **SECTIONS → CONTENT_BLOCKS** is the actual renderable content: one row per paragraph, list, image, table, blockquote, code block, or subheading, in `sort_order`. `subheading` exists for markdown headings in the source that aren't real document sections (glossed labels, worked-example lead-ins) — they render in place on the page instead of becoming their own navigable `sections` row.
- **CONTENT_BLOCKS → FIGURES / TABLES** are 1:0..1 side tables that only exist for blocks of the matching `block_type`, holding the structured data (image path + caption, or table headers/rows) instead of overloading `content_blocks.content` with every shape.
- **GLOSSARY_TERMS** and **SYMBOLS** hang off `BOOKS` directly rather than the outline, since they're book-level reference lists (Abbreviations, Conventional Symbols and Suprasegmentals), not sections of prose.
- Full-text search runs on `content_blocks.tsv`, a generated `tsvector` column indexed with GIN — no separate search table needed at this scale (~1,400 content blocks).
