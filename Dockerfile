FROM smallcloud/refact_self_hosting:latest

# Install curl for health checks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Expose the port (Railway will set $PORT)
EXPOSE $PORT

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:$PORT/v1/caps || exit 1

# Find and use the correct binary name
RUN find / -name "*refact*" -type f 2>/dev/null || echo "Checking for binaries..."
RUN ls -la /usr/local/bin/ || echo "No /usr/local/bin/"
RUN ls -la /app/ || echo "No /app/"

# Try different possible command names
CMD if [ -f "/app/refact-lsp" ]; then \
        /app/refact-lsp --address-url ${AI_PROVIDER:-Anthropic} --api-key $ANTHROPIC_API_KEY --http-port $PORT --host 0.0.0.0 --logs-stderr --vecdb --ast; \
    elif [ -f "/usr/local/bin/refact-lsp" ]; then \
        /usr/local/bin/refact-lsp --address-url ${AI_PROVIDER:-Anthropic} --api-key $ANTHROPIC_API_KEY --http-port $PORT --host 0.0.0.0 --logs-stderr --vecdb --ast; \
    elif [ -f "/usr/bin/refact-lsp" ]; then \
        /usr/bin/refact-lsp --address-url ${AI_PROVIDER:-Anthropic} --api-key $ANTHROPIC_API_KEY --http-port $PORT --host 0.0.0.0 --logs-stderr --vecdb --ast; \
    else \
        echo "refact-lsp binary not found!" && exit 1; \
    fi
