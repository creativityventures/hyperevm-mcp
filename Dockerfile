# Builds the server from this repository's source and runs it over stdio.
#
# Here because directory checks need a container they can start and speak MCP
# to. It is deliberately built from source rather than pulled from npm: an image
# that installs the published tarball would prove the tarball runs, not that
# this source produces it.
#
#   docker build -t hyperevm-mcp .
#   docker run --rm -i hyperevm-mcp
#
# `-i` matters. The transport is stdin/stdout; without it the server has nothing
# to talk to and exits.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
# Runtime dependencies only — the TypeScript compiler stays in the build stage.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# No keys, no configuration, no writable state: nothing here needs root.
USER node

ENTRYPOINT ["node", "dist/index.js"]
