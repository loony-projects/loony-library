const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

async function get(path) {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

async function send(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

const put = (path, body) => send("PUT", path, body);
const post = (path, body) => send("POST", path, body);

async function del(path) {
  const res = await fetch(`${API_URL}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
}

export const api = {
  books: () => get("/api/books"),
  book: (slug) => get(`/api/books/${slug}`),
  toc: (slug) => get(`/api/books/${slug}/toc`),
  createChapter: (bookSlug, { title, number }) => post(`/api/books/${bookSlug}/chapters`, { title, number }),
  deleteChapter: (id) => del(`/api/chapters/${id}`),
  section: (id) => get(`/api/sections/${id}`),
  createSection: ({ chapterId, parentId, title, markdown }) =>
    post("/api/sections", { chapter_id: chapterId, parent_id: parentId, title, markdown }),
  updateSection: (id, markdown) => put(`/api/sections/${id}`, { markdown }),
  deleteSection: (id) => del(`/api/sections/${id}`),
  search: (slug, q) => get(`/api/books/${slug}/search?q=${encodeURIComponent(q)}`),
  glossary: (slug) => get(`/api/books/${slug}/glossary`),
  symbols: (slug) => get(`/api/books/${slug}/symbols`),
  imageUrl: (path) => `${API_URL}/images/${path}`,
};
