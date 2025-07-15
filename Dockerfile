FROM node:18-alpine

WORKDIR /app

# Create package.json
RUN echo '{"name":"refact-proxy","version":"1.0.0","dependencies":{"express":"^4.18.0","axios":"^1.6.0","cors":"^2.8.5"}}' > package.json

# Install dependencies
RUN npm install

# Copy server file
COPY server.js .

EXPOSE $PORT

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:$PORT/health || exit 1

CMD ["node", "server.js"]
