FROM node:20-slim

WORKDIR /app

COPY xiaos-call-pwa/package.json xiaos-call-pwa/package-lock.json* ./
RUN npm ci --omit=dev

COPY xiaos-call-pwa/ ./

EXPOSE 3000

CMD ["node", "server.js"]
