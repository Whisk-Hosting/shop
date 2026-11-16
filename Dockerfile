# The shop's pages and admin screens, the site editor (cms/) and Whisk's commerce engine, in one image.

# Trade ordering: empty here, so this is a plain public shop. Whisk fills this stage with its
# private @whisk/shop-b2b plugin for a Promoted app whose whisk.yaml says b2b: true.
FROM scratch AS whisk-shop-b2b

# Whisk's commerce engine: empty here. Whisk fills this stage with the engine for every shop's
# build; a shop whose API its node's engine does not answer (a preview) starts it beside its
# pages (main.go).
FROM scratch AS whisk-commerce-engine

# The site editor, a Next.js app that takes minutes to build, in a stage that reads only cms/: a
# change to the shop's pages leaves it as it was, and the builder reuses it.
FROM node:24-trixie-slim AS cms
WORKDIR /app/cms
COPY cms/package.json cms/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY cms/ ./
# Next.js's own cache persists between builds, so a change to the editor rebuilds only what it
# touches.
RUN --mount=type=cache,target=/app/cms/.next/cache npm run build
# The editor runs with only its production packages.
RUN --mount=type=cache,target=/root/.npm npm prune --omit=dev --no-audit --no-fund

# The shop's pages: one small Go program with no packages of its own (main.go).
FROM golang:1.27-alpine AS server
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server .

# The admin's screens (Medusa's admin dashboard with the shop's own, src/admin, and trade
# ordering's when Whisk installed it) built into plain files, and the migrate step compiled.
FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# npm's cache persists between builds, so unchanged dependencies are not downloaded again.
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY --from=whisk-shop-b2b / node_modules/@whisk/shop-b2b/
COPY . .
RUN node scripts/shop.mjs shop

# The shop runs on Google's distroless Node image: Node for the editor and the migrate step, with
# no shell, package manager or other tools. The pages' server itself needs none of it.
FROM gcr.io/distroless/nodejs24-debian13:nonroot
# On the PATH, node runs the editor and the migrate command from whisk.yaml.
ENV PATH=/nodejs/bin:/usr/local/bin:/usr/bin:/bin
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/build ./
COPY --from=server /out/server ./server
COPY --from=cms /app/cms ./cms
COPY --from=whisk-commerce-engine --chmod=755 / ./engine/
USER nonroot
EXPOSE 8080
# The Sentry and OpenTelemetry SDKs add about 100 MB to a process, and this app already needs
# most of its memory for the processes it runs.
# doctor: allow W140 W141 too big for the SDKs
ENTRYPOINT ["/app/server"]
