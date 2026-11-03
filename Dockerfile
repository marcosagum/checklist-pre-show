FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DADOS_DIR=/app/dados
COPY server.js inicial.json package.json ./
COPY public ./public
RUN mkdir -p /app/dados && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
