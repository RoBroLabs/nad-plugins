FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS sdk-gate

ENV COREPACK_HOME=/opt/corepack
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl openssl unzip \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p "$COREPACK_HOME" \
  && corepack enable \
  && corepack prepare pnpm@9.15.0 --activate \
  && chown -R node:node "$COREPACK_HOME"

WORKDIR /workspace
RUN chown node:node /workspace
COPY --chown=node:node . .
USER node
RUN pnpm install --frozen-lockfile --strict-peer-dependencies
RUN bash devkit/scripts/ci-install-deno.sh
ENV PATH="/workspace/.ci-tools:${PATH}"

CMD ["bash", "devkit/scripts/ci-sdk-gate.sh"]
