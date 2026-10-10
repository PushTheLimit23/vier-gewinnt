# Bauplan für den Spiel-Container
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public ./public
# Ordner für die Spielhistorie (wird in Coolify als "Persistent Storage" eingebunden)
RUN mkdir -p /app/data
ENV NODE_ENV=production DATA_DIR=/app/data PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
