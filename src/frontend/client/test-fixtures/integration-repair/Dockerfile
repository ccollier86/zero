FROM oven/bun:1.4.4-slim@sha256:13b43f8bb2c63f5d89c56205c4279b85620363296a00ada33ff7ad568f3688e7
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
