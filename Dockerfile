FROM rust:1.75-slim as builder

# Install dependencies
RUN apt-get update && apt-get install -y \
    git \
    pkg-config \
    libssl-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Clone and checkout a working commit (before rmcp dependency issue)
RUN git clone https://github.com/smallcloudai/refact.git /src
WORKDIR /src

# Go back to a commit from a few weeks ago (before dependency issues)
RUN git checkout HEAD~20

# Build the engine
WORKDIR /src/refact-agent/engine
RUN cargo build --release

# Runtime stage - smaller final image
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy only the built binary
COPY --from=builder /src/refact-agent/engine/target/release/refact-lsp /usr/local/bin/

# Expose port
EXPOSE $PORT

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:$PORT/v1/caps || exit 1

# Run the binary
CMD refact-lsp \
    --address-url ${AI_PROVIDER:-Anthropic} \
    --api-key $ANTHROPIC_API_KEY \
    --http-port $PORT \
    --host 0.0.0.0 \
    --logs-stderr \
    --vecdb \
    --ast \
    --workspace-folder /tmp
