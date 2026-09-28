export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

async function get(path) {
  const res = await fetch(`${API_URL}${path}`, { credentials: "include" });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || `Request failed (${res.status})`);
  }
  return res.json();
}

async function send(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || `Request failed (${res.status})`);
  }
  return res.json();
}

const put = (path, body) => send("PUT", path, body);
const post = (path, body) => send("POST", path, body);

async function del(path) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || `Request failed (${res.status})`);
  }
}

async function postForm(path, formData) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  get,
  post,
  put,
  patch: (path, body) => send("PATCH", path, body),
  del,
  postForm,
  download: async (slug, format) => {
    const res = await fetch(
      `${API_URL}/api/books/${slug}/export?format=${format}`,
      { credentials: "include" },
    );
    if (!res.ok) throw new Error("Export failed");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  books: () => get("/api/discover"),
  book: (slug) => get(`/api/books/${slug}`),
  createBook: ({
    title,
    author,
    publisher,
    isbn,
    edition,
    published_year,
    price,
    category_id,
    coverFile,
  }) => {
    const form = new FormData();
    form.append("title", title);
    for (const [key, value] of Object.entries({
      author,
      publisher,
      isbn,
      edition,
      published_year,
      price,
      category_id,
    })) {
      if (value) form.append(key, value);
    }
    if (coverFile) form.append("cover", coverFile);
    return postForm("/api/books", form);
  },
  categories: () => get("/api/categories"),
  createCategory: ({ name, parent_id }) => post("/api/categories", { name, parent_id }),
  toc: (slug) => get(`/api/books/${slug}/toc`),
  createChapter: (bookSlug, { title, number }) =>
    post(`/api/books/${bookSlug}/chapters`, { title, number }),
  deleteChapter: (id) => del(`/api/chapters/${id}`),
  section: (id) => get(`/api/sections/${id}`),
  createSection: ({ chapterId, parentId, title, markdown }) =>
    post("/api/sections", {
      chapter_id: chapterId,
      parent_id: parentId,
      title,
      markdown,
    }),
  updateSection: (id, markdown) => put(`/api/sections/${id}`, { markdown }),
  deleteSection: (id) => del(`/api/sections/${id}`),
  search: (slug, q) =>
    get(`/api/books/${slug}/search?q=${encodeURIComponent(q)}`),
  glossary: (slug) => get(`/api/books/${slug}/glossary`),
  symbols: (slug) => get(`/api/books/${slug}/symbols`),
  imageUrl: (path) => `${API_URL}/images/${path}`,
  coverUrl: (filename) => `${API_URL}/covers/${filename}`,
};
