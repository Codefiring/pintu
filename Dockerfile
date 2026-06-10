# ---- frontend build ----
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- server runtime ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/src ./src
# app.js resolves ../../frontend/dist relative to server/src
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist
EXPOSE 3000
USER node
CMD ["node", "src/index.js"]
