FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/triggers
ARG GIT_SHA=unknown
ARG GIT_SUBJECT=unknown
ENV GIT_SHA=$GIT_SHA
ENV GIT_SUBJECT=$GIT_SUBJECT
ENV NODE_ENV=production
EXPOSE 3000
VOLUME ["/app/data", "/app/uploads"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
