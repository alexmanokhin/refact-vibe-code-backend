FROM rust:1.75-slim as builder

# Install dependencies
RUN apt-get update && apt-get install -y \
    git \
    pkg-config \
    libssl-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Clone and go back much further
RUN git clone https://github.com/smallcloudai/refact.git /src
WORKDIR /src

# Go back 100 commits to find a stable version
RUN git checkout HEAD~100

# Build the engine
WORKDIR /src/refact-agent/engine
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /src/refact-agent/engine/target/release/refact-lsp /usr/local/bin/
EXPOSE $PORT
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 CMD curl -f http://localhost:$PORT/v1/caps || exit 1
CMD refact-lsp --address-url ${AI_PROVIDER:-Anthropic} --api-key $ANTHROPIC_API_KEY --http-port $PORT --host 0.0.0.0 --logs-stderr --vecdb --ast --workspace-folder /tmp
