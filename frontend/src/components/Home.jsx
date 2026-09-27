import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { BookDashed } from "lucide-react";
import { api } from "../api";
import { useAccount } from "./Account";
import ReadingSkeleton from "./common/ReadingSkeleton";
import { EmptyState, ErrorState } from "./common/States";

export default function Home() {
  const { bookSlug } = useParams();
  const { editor } = useAccount();
  const [error, setError] = useState(null);
  const [firstSectionId, setFirstSectionId] = useState(undefined);

  useEffect(() => {
    setFirstSectionId(undefined);
    setError(null);
    api
      .toc(bookSlug)
      .then((toc) => {
        const first = toc.chapters.find((c) => c.sections.length > 0)
          ?.sections[0];
        setFirstSectionId(first ? first.id : null);
      })
      .catch((e) => setError(e.message));
  }, [bookSlug]);

  if (error) return <ErrorState title="Couldn’t open this book" message={error} />;
  if (firstSectionId === undefined) return <ReadingSkeleton />;
  if (firstSectionId === null)
    return (
      <EmptyState
        icon={BookDashed}
        title="No content found"
        description={
          editor
            ? "This book has no sections yet. Add a chapter from the contents panel to begin."
            : "This book doesn’t have any published sections yet."
        }
      />
    );
  return <Navigate to={`/${bookSlug}/sections/${firstSectionId}`} replace />;
}
