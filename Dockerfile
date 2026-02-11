FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

COPY package*.json ./
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev && npm cache clean --force
RUN npx playwright install chromium

COPY src ./src
COPY README.md CONTEXT.md ./

RUN mkdir -p /app/.session && chown -R pwuser:pwuser /app

USER pwuser

ENV NODE_ENV=production
ENV PORT=3000
ENV HEADLESS=true

EXPOSE 3000

CMD ["node", "src/server.js"]
