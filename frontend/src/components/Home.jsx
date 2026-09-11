import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { api } from "../api";

export default function Home() {
  const { bookSlug } = useParams();
  const [firstSectionId, setFirstSectionId] = useState(undefined);

  useEffect(() => {
    setFirstSectionId(undefined);
    api.toc(bookSlug).then((toc) => {
      const first = toc.chapters.find((c) => c.sections.length > 0)?.sections[0];
      setFirstSectionId(first ? first.id : null);
    });
  }, [bookSlug]);

  if (firstSectionId === undefined) return <p className="loading">Loading…</p>;
  if (firstSectionId === null) return <p className="error">No content found.</p>;
  return <Navigate to={`/${bookSlug}/sections/${firstSectionId}`} replace />;
}
