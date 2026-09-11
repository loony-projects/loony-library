import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import "dotenv/config";
import { router as bookRouter } from "./routes/book.js";
import { router as sectionsRouter } from "./routes/sections.js";
import { router as searchRouter } from "./routes/search.js";
import { router as referenceRouter } from "./routes/reference.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = path.resolve(__dirname, "..", "data", "images");

export const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());
app.use("/images", express.static(IMAGES_DIR));

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api", bookRouter);
app.use("/api", sectionsRouter);
app.use("/api", searchRouter);
app.use("/api", referenceRouter);

app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});
