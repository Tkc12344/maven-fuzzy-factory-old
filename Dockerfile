# syntax=docker/dockerfile:1.7
FROM node:22.14.0-bookworm-slim AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client ./
RUN npm run build

FROM node:22.14.0-bookworm-slim AS server
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
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
