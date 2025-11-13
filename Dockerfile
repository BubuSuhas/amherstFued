# Multi-stage build: build Angular app, install server deps, then run minimal image

FROM node:20-alpine AS build
WORKDIR /app

# Install root deps and build Angular
COPY package*.json ./
COPY angular.json tsconfig*.json ./
COPY public ./public
COPY src ./src
# Prepare server deps (needs access to root due to "familyfeud": "file:..")
COPY server/package.json ./server/package.json
RUN npm ci \
  && npm run build \
  && npm ci --prefix server --omit=dev
# Copy remaining server sources after deps to maximize cache
COPY server ./server

# --- Runtime image ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Copy server and built assets
COPY --from=build /app/server /app/server
COPY --from=build /app/dist /app/dist

# Healthcheck (best-effort)
EXPOSE 3001
ENV PORT=3001
HEALTHCHECK CMD wget -qO- http://localhost:$PORT/api/ping || exit 1

CMD ["node", "server/index.js"]
