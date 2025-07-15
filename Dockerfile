FROM smallcloud/refact_self_hosting:latest

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

EXPOSE $PORT

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:$PORT/v1/caps || exit 1
CMD refact-lsp \
    --address-url ${AI_PROVIDER:-Anthropic} \
    --api-key $ANTHROPIC_API_KEY \
    --http-port $PORT \
    --host 0.0.0.0 \
    --logs-stderr \
    --vecdb \
    --ast
