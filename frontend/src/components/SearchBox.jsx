import { useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";

export default function SearchBox() {
  const { bookSlug } = useParams();
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const navigate = useNavigate();

  function onChange(e) {
    const value = e.target.value;
    setQ(value);
    clearTimeout(timer.current);
    if (!value.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      const data = await api.search(bookSlug, value);
      setResults(data.results);
      setOpen(true);
    }, 250);
  }

  function goTo(sectionId) {
    setOpen(false);
    setQ("");
    navigate(`/${bookSlug}/sections/${sectionId}`);
  }

  return (
    <div className="search-box">
      <input
        type="search"
        placeholder="Search the grammar..."
        value={q}
        onChange={onChange}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <ul className="search-results">
          {results.length === 0 && <li className="search-empty">No matches</li>}
          {results.map((r) => (
            <li key={r.section_id}>
              <button onMouseDown={() => goTo(r.section_id)}>
                <div className="search-result-title">
                  {r.chapter_title} {r.numbering ? `– ${r.numbering} ${r.title}` : ""}
                </div>
                <div
                  className="search-result-snippet"
                  dangerouslySetInnerHTML={{ __html: r.snippet }}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
