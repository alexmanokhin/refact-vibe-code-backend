FROM rust:1.75

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Clone the Refact repository
RUN git clone https://github.com/smallcloudai/refact.git /app
WORKDIR /app

# Build the Rust engine
WORKDIR /app/refact-agent/engine
RUN cargo build --release

# Expose the port
EXPOSE $PORT

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:$PORT/v1/caps || exit 1

# Run the built binary
CMD ./target/release/refact-lsp \
    --address-url ${AI_PROVIDER:-Anthropic} \
    --api-key $ANTHROPIC_API_KEY \
    --http-port $PORT \
    --host 0.0.0.0 \
    --logs-stderr \
    --vecdb \
    --ast \
    --workspace-folder /tmp
