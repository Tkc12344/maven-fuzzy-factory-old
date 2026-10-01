# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client ./
RUN npm run build

FROM node:22-bookworm-slim AS server
WORKDIR /app
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev \
  && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY server ./server
COPY --from=client /app/client/dist ./client/dist

RUN groupadd --system --gid 10001 mff \
  && useradd --system --uid 10001 --gid mff --home /var/lib/mff --create-home mff \
  && mkdir -p /var/lib/mff/warehouse /tmp \
  && chown -R mff:mff /var/lib/mff /app /tmp

USER 10001
WORKDIR /app/server
ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/data \
    WAREHOUSE_DIR=/var/lib/mff/warehouse \
    CLIENT_DIR=/app/client/dist
EXPOSE 4000
CMD ["node", "src/index.js"]
