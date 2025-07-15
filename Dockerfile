FROM node:18-alpine

WORKDIR /app

# Copy package.json and install dependencies
COPY package.json .
RUN npm install

# Copy server file
COPY server.js .

EXPOSE $PORT

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:$PORT/health || exit 1

CMD ["node", "server.js"]
