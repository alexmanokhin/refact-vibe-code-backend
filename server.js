const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'refact-proxy', timestamp: new Date().toISOString() });
});

// Capabilities endpoint - mimic Refact's response
app.get('/v1/caps', (req, res) => {
  res.json({
    "chat_models": {
      "claude-3-5-sonnet": {
        "n_ctx": 200000,
        "supports_tools": true,
        "supports_multimodality": true,
        "supports_agent": true,
        "supports_reasoning": true
      }
    },
    "completion_models": {},
    "embedding_models": {},
    "providers": ["anthropic"],
    "version": "proxy-1.0.0"
  });
});

// Chat completions - proxy to Anthropic API
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: req.body.model || 'claude-3-5-sonnet-20241022',
      max_tokens: req.body.max_tokens || 4000,
      messages: req.body.messages,
      system: req.body.system || "You are a helpful AI assistant that generates clean, modern React components with Tailwind CSS."
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.ANTHROPIC_API_KEY}`,
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    });

    // Convert Anthropic response to OpenAI-compatible format
    res.json({
      choices: [{
        message: {
          role: 'assistant',
          content: response.data.content[0].text
        },
        finish_reason: 'stop'
      }],
      model: req.body.model || 'claude-3-5-sonnet',
      usage: {
        prompt_tokens: response.data.usage?.input_tokens || 0,
        completion_tokens: response.data.usage?.output_tokens || 0,
        total_tokens: (response.data.usage?.input_tokens || 0) + (response.data.usage?.output_tokens || 0)
      }
    });
  } catch (error) {
    console.error('Error calling Anthropic API:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to process chat request',
      details: error.response?.data?.error || error.message 
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Refact proxy server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🤖 API endpoint: http://localhost:${PORT}/v1/chat/completions`);
});
