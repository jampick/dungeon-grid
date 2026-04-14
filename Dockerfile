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
EXPOSE 3000
VOLUME ["/app/data", "/app/uploads"]
CMD ["node", "server.js"]
