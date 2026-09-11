import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";

export default function GlossaryPage() {
  const { bookSlug } = useParams();
  const [terms, setTerms] = useState(null);

  useEffect(() => {
    setTerms(null);
    api.glossary(bookSlug).then((d) => setTerms(d.terms));
  }, [bookSlug]);

  if (!terms) return <p className="loading">Loading…</p>;

  return (
    <article className="section-page">
      <h1>Abbreviations</h1>
      <dl className="glossary">
        {terms.map((t, i) => (
          <div key={i} className="glossary-entry">
            <dt>{t.term}</dt>
            <dd dangerouslySetInnerHTML={{ __html: t.expansion }} />
          </div>
        ))}
      </dl>
    </article>
  );
}
