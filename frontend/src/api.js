const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

async function get(path) {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

export const api = {
  books: () => get("/api/books"),
  book: (slug) => get(`/api/books/${slug}`),
  toc: (slug) => get(`/api/books/${slug}/toc`),
  section: (id) => get(`/api/sections/${id}`),
  search: (slug, q) => get(`/api/books/${slug}/search?q=${encodeURIComponent(q)}`),
  glossary: (slug) => get(`/api/books/${slug}/glossary`),
  symbols: (slug) => get(`/api/books/${slug}/symbols`),
  imageUrl: (path) => `${API_URL}/images/${path}`,
};
