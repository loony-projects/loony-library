# Backend API image. Built from the repo root because the backend uses code
# outside backend/: book-import's markdown parser (a file: dependency) and
# frontend/src/markdown.js. The same image runs the book loader (the
# compose "import" service), since book-import is installed here anyway.
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# book-import workspace (markdown parser + loader). Manifests first so the
# dependency layer is cached until they change. npm doesn't run the
# tree-sitter grammars' install scripts; only their .wasm files are used.
COPY book-import/package.json book-import/package-lock.json book-import/
COPY book-import/packages/markdown-parser/package.json book-import/packages/markdown-parser/
COPY book-import/packages/migration/package.json book-import/packages/migration/
RUN cd book-import && npm ci --omit=dev --no-audit --no-fund

COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci --omit=dev --no-audit --no-fund

COPY book-import/packages book-import/packages
COPY frontend/src/markdown.js frontend/src/markdown.js
COPY backend/src backend/src
COPY backend/scripts backend/scripts
COPY backend/migrations backend/migrations

# Book images and covers (a volume in docker-compose.yml).
RUN mkdir -p backend/data/images backend/data/covers && chown -R node:node backend/data
USER node

WORKDIR /app/backend
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Apply pending migrations (backend/migrations), then serve.
CMD ["sh", "-c", "node scripts/migrate.js && exec node src/server.js"]
