# Refact.ai Backend for Vibe-Code Tool

AI-powered backend for generating landing pages and web components.

## Environment Variables Required:
- `ANTHROPIC_API_KEY` - Your Anthropic/Claude API key  
- `AI_PROVIDER` - (Optional) Set to "Anthropic" by default

## API Endpoints:
- `POST /v1/chat/completions` - Generate components via chat
- `GET /v1/caps` - Health check & capabilities

## Usage:
```javascript
const component = await fetch('https://your-app.up.railway.app/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [{ role: "user", content: "Create a hero section" }],
    model: "claude-3-5-sonnet"
  })
});
