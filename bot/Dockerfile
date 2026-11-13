# syntax=docker/dockerfile:1
# SHED X announcer. Run with a read-only root filesystem and a state volume:
#   docker build -t shed-bot bot/
#   docker run -d --name shed-bot --restart on-failure --read-only --cap-drop ALL \
#     --security-opt no-new-privileges --env-file ./shed-bot.env \
#     -v shed-bot-data:/data shed-bot

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    STATE_FILE=/data/state.json \
    OUT_DIR=/data/out
WORKDIR /app
# Code stays root-owned (read-only for the bot); only /data is writable.
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -m 0700 /data && chown node:node /data
USER node
VOLUME ["/data"]
CMD ["node", "dist/main.js"]
