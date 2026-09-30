# ---- build the React client
FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- API server (also serves the built client)
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY samples/ /app/samples/
COPY --from=client /app/client/dist /app/client/dist
EXPOSE 4000
CMD ["node", "src/index.js"]
