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

import { authenticate, authRouter, editor } from "./auth.js";
import { featuresRouter, visibility } from "./features.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = path.resolve(__dirname, "..", "data", "images");
const COVERS_DIR = path.resolve(__dirname, "..", "data", "covers");

export const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
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
app.use("/api", bookRouter);
app.use("/api", categoriesRouter);
app.use("/api", sectionsRouter);
app.use("/api", searchRouter);
app.use("/api", referenceRouter);

app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.use((err, req, res, next) => {
  console.error(err);
  res
    .status(err.status || 500)
    .json({ error: err.status ? err.message : "Request failed" });
});
