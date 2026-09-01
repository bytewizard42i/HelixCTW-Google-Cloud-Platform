# HelixCTW GCP edition — Cloud Run container
#
# LEARNING NOTES (John):
# - "FROM node:22-slim" = start from Google's-run-anywhere official Node 22
#   image, "slim" = smaller variant without build tools we don't need.
# - Each instruction creates a layer; layers are cached, so we copy
#   package*.json FIRST and install dependencies BEFORE copying source code —
#   that way editing source doesn't re-run npm ci on every build.
# - "npm ci --omit=dev" installs the exact versions from package-lock.json,
#   skipping dev-only packages. Deterministic installs, smaller image.
# - Cloud Run sets $PORT (default 8080) and expects the app to listen on it;
#   src/server.js reads process.env.PORT.
# - "USER node" drops root privileges inside the container.

FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

USER node

ENV NODE_ENV=production

CMD ["node", "src/server.js"]
