# The shop's pages and admin screens, and Whisk's commerce and content engines, in one image.

# Trade ordering: empty here, so this is a plain public shop. Whisk fills this stage with its
# private @whisk/shop-b2b plugin for a Promoted app whose whisk.yaml says b2b: true.
FROM scratch AS whisk-shop-b2b

# Whisk's commerce engine: empty here. Whisk fills this stage with the engine for every shop's
# build; a shop whose API its node's engine does not answer (a preview) starts it beside its
# pages (main.go).
FROM scratch AS whisk-commerce-engine

# Whisk's content engine: empty here. Whisk fills this stage with the engine for every shop's
# build; a shop whose site editor its node's engine does not answer (a preview) starts it beside
# its pages (editor.go).
FROM scratch AS whisk-content-engine

# The shop's pages: one small Go program with no packages of its own (main.go).
FROM golang:1.27-alpine AS server
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server .

# The admin's screens (Medusa's admin dashboard with the shop's own, src/admin, and trade
# ordering's when Whisk installed it) built into plain files.
FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# npm's cache persists between builds, so unchanged dependencies are not downloaded again.
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY --from=whisk-shop-b2b / node_modules/@whisk/shop-b2b/
COPY . .
RUN node scripts/shop.mjs shop

# Google's distroless static image: the pages' server, both engines and the shop's files, with no
# shell, Node or other tools. The server also runs the migrate command from whisk.yaml.
FROM gcr.io/distroless/static-debian13:nonroot
WORKDIR /app
COPY --from=build /app/build ./
COPY --from=server /out/server ./server
COPY --from=whisk-commerce-engine --chmod=755 / ./engine/
COPY --from=whisk-content-engine --chmod=755 / ./engine/
USER nonroot
EXPOSE 8080
# doctor: allow W140 W141 the engines and the pages' server log every error they meet as JSON
ENTRYPOINT ["/app/server"]
