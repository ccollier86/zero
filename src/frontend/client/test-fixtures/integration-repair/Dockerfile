FROM oven/bun:1.4.0-slim@sha256:4c3ac64f41e0a47e28403789a63ecdca7987f322fa811bf5b3cb0f25f18443cc
COPY framework.tgz /input/framework.tgz
WORKDIR /qualification
COPY package.json ./package.json
RUN bun install
COPY app ./app
COPY server ./server
COPY zero.config.ts ./zero.config.ts
COPY tsconfig.json ./tsconfig.json
RUN bun --no-env-file node_modules/@zero/framework/src/cli/run.ts build
EXPOSE 4319
CMD ["bun", "--no-env-file", "dist/server.js"]
