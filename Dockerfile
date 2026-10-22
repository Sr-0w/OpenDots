# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches/ patches/
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=secret,id=opendots_ca,target=/run/opendots-ca.pem \
    --mount=type=cache,id=opendots-pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
    if [ -f /run/opendots-ca.pem ]; then export NODE_EXTRA_CA_CERTS=/run/opendots-ca.pem; fi; \
    npm install --global pnpm@10.28.0 \
 && pnpm install --frozen-lockfile --prefer-offline
COPY . .
RUN pnpm build

FROM node:24-bookworm-slim
ENV NODE_ENV=production DOCKER_BUILDKIT=1
RUN --mount=type=secret,id=opendots_ca,target=/run/opendots-ca.pem \
    apt-get -o Acquire::https::CaInfo=/run/opendots-ca.pem update \
 && apt-get -o Acquire::https::CaInfo=/run/opendots-ca.pem install -y --no-install-recommends \
    ca-certificates docker.io git \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app/apps/server
# Keep pnpm's relative workspace links intact and use only the frozen install.
# No registry resolution/deploy step is performed after the initial install.
COPY --from=build /src/ /app/
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/index.ts"]
