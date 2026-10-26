FROM oven/bun:1.3.14-slim@sha256:d56a2534ffd262e92c12fd3249d3924d296d97086da773f821d7d0477435ea04
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
