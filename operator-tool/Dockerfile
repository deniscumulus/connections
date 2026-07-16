FROM node:22-slim

WORKDIR /app

COPY package*.json ./
COPY server.mjs ./
COPY worker.mjs ./
COPY ga4-automation.mjs ./
COPY gsc-automation.mjs ./
COPY seranking-automation.mjs ./
COPY managewp-automation.mjs ./
COPY yamix-automation.mjs ./
COPY public ./public

RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libpangocairo-1.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN npm install

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=false
RUN cd /app && npm exec -- playwright install --with-deps chromium

RUN mkdir -p /app/data && chown -R node:node /app

USER node

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4173
ENV DATA_DIR=/app/data

EXPOSE 4173

CMD ["node", "server.mjs"]
