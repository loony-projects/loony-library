import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import "dotenv/config";
import { router as bookRouter } from "./routes/book.js";
import { router as categoriesRouter } from "./routes/categories.js";
import { router as sectionsRouter } from "./routes/sections.js";
import { router as searchRouter } from "./routes/search.js";
import { router as referenceRouter } from "./routes/reference.js";
import { router as importReportRouter } from "./routes/importReport.js";

import { authenticate, authRouter, editor, frontendOrigins } from "./auth.js";
import { featuresRouter, visibility } from "./features.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = path.resolve(__dirname, "..", "data", "images");
const COVERS_DIR = path.resolve(__dirname, "..", "data", "covers");
// The built frontend (`npm run build` in frontend/). When it's there, this
// server is the whole site - app, API and images on one origin - which is
// how https://books.lovegood.in is served through the Cloudflare tunnel.
const FRONTEND_DIR = path.resolve(__dirname, "..", "..", "frontend", "dist");
const FRONTEND_INDEX = path.join(FRONTEND_DIR, "index.html");

export const app = express();
// cloudflared (or another reverse proxy on this machine) ends TLS: trust its
// X-Forwarded-Proto/Host so req.protocol, req.secure and req.hostname are the
// public ones (https://books.lovegood.in), not http://localhost:4000.
app.set("trust proxy", "loopback");

app.use(
  cors({
    origin: frontendOrigins(),
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));
app.use("/images", express.static(IMAGES_DIR));
app.use("/covers", express.static(COVERS_DIR));

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api", authenticate, authRouter, featuresRouter);
app.use("/api", visibility);
app.use("/api", (req, res, next) =>
  ["GET", "HEAD", "OPTIONS"].includes(req.method)
    ? next()
    : editor(req, res, next),
);
app.use("/api", importReportRouter);
app.use("/api", bookRouter);
app.use("/api", categoriesRouter);
app.use("/api", sectionsRouter);
app.use("/api", searchRouter);
app.use("/api", referenceRouter);

// Frontend files, then index.html for the app's own routes (/books/x/...),
// so a reload or a shared link works. Checked per request: building the
// frontend doesn't need a restart.
const frontendFiles = express.static(FRONTEND_DIR, { index: false });
app.use((req, res, next) => (fs.existsSync(FRONTEND_INDEX) ? frontendFiles(req, res, next) : next()));
app.get(/^\/(?!api\/|api$|images\/|covers\/)/, (req, res, next) =>
  fs.existsSync(FRONTEND_INDEX) ? res.sendFile(FRONTEND_INDEX) : next(),
);

app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.use((err, req, res, next) => {
  console.error(err);
  res
    .status(err.status || 500)
    .json({ error: err.status ? err.message : "Request failed" });
});
