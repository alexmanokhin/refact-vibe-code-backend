const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 8001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// In-memory project storage
const projects = new Map();

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'refact-proxy-advanced',
    version: '2.0.0',
    features: ['github', 'projects', 'complex-apps'],
    timestamp: new Date().toISOString() 
  });
});

// Enhanced capabilities
app.get('/v1/caps', (req, res) => {
  res.json({
    "chat_models": {
      "claude-3-5-sonnet": {
        "n_ctx": 200000,
        "supports_tools": true,
        "supports_multimodality": true,
        "supports_agent": true,
        "supports_reasoning": true,
        "supports_complex_apps": true,
        "supports_databases": true,
        "supports_github": true
      }
    },
    "features": {
      "project_management": true,
      "github_integration": true,
      "database_generation": true,
      "full_stack_apps": true,
      "file_operations": true
    },
    "version": "2.0.0"
  });
});

// Create new project with GitHub repo
app.post('/v1/projects/create', async (req, res) => {
  try {
    const { project_name, github_token, complexity = 'simple' } = req.body;
    
    const projectId = uuidv4();
    const repoName = project_name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    
    // Create GitHub repository
    const octokit = new Octokit({ auth: github_token });
    const repo = await octokit.repos.createForAuthenticatedUser({
      name: repoName,
      description: `${complexity} app created with VibeCode`,
      private: false,
      auto_init: true
    });
    
    // Generate initial project structure
    const projectStructure = generateProjectStructure(complexity);
    
    // Commit initial files
    await commitFilesToRepo(octokit, repo.data.owner.login, repoName, projectStructure);
    
    // Store project info
    projects.set(projectId, {
      id: projectId,
      name: project_name,
      complexity,
      github_repo: repo.data.html_url,
      github_clone_url: repo.data.clone_url,
      owner: repo.data.owner.login,
      repo_name: repoName,
      created_at: new Date(),
      files: projectStructure
    });
    
    res.json({
      project_id: projectId,
      github_repo_url: repo.data.html_url,
      clone_url: repo.data.clone_url,
      complexity,
      initial_structure: Object.keys(projectStructure)
    });
    
  } catch (error) {
    console.error('Project creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate component/feature for existing project
app.post('/v1/projects/:projectId/generate', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { prompt, github_token, feature_type = 'component' } = req.body;
    
    const project = projects.get(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Build context-aware prompt
    const contextualPrompt = buildAdvancedPrompt(prompt, {}, feature_type, project.complexity);
    
    // Generate with Claude
    const response = await callClaudeAPI(contextualPrompt);
    
    res.json({
      generated_content: response.choices[0].message.content,
      project_info: {
        id: project.id,
        name: project.name,
        github_repo: project.github_repo
      }
    });
    
  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Original chat completions endpoint (for backward compatibility)
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

// HELPER FUNCTIONS

const callClaudeAPI = async (prompt) => {
  const response = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }]
  }, {
    headers: {
      'Authorization': `Bearer ${process.env.ANTHROPIC_API_KEY}`,
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    }
  });

  return {
    choices: [{
      message: {
        role: 'assistant',
        content: response.data.content[0].text
      }
    }]
  };
};

const buildAdvancedPrompt = (userPrompt, currentFiles, featureType, complexity) => {
  let prompt = `You are building a ${complexity} ${featureType === 'database' ? 'full-stack' : 'React'} application. `;
  prompt += `User request: ${userPrompt}\n\n`;
  prompt += `Please provide clean, modern React components with Tailwind CSS.`;
  return prompt;
};

const generateProjectStructure = (complexity) => {
  const baseStructure = {
    'package.json': generatePackageJson(complexity),
    'README.md': generateReadme(complexity),
    '.gitignore': generateGitignore(),
    'src/App.js': generateMainApp(complexity),
    'src/index.js': generateIndex(),
    'src/index.css': generateStyles(),
    'src/components/Hero.js': generateHeroComponent(),
    'public/index.html': generateHTML()
  };
  
  if (complexity === 'complex') {
    Object.assign(baseStructure, {
      'backend/package.json': generateBackendPackageJson(),
      'backend/server.js': generateExpressServer(),
      'backend/prisma/schema.prisma': generatePrismaSchema(),
      '.env.example': generateEnvExample()
    });
  }
  
  return baseStructure;
};

const commitFilesToRepo = async (octokit, owner, repo, files) => {
  const commits = [];
  
  for (const [filePath, content] of Object.entries(files)) {
    try {
      const result = await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: filePath,
        message: `Add ${filePath}`,
        content: Buffer.from(content).toString('base64')
      });
      commits.push(result.data.commit.sha);
    } catch (error) {
      console.error(`Error committing ${filePath}:`, error.message);
    }
  }
  
  return commits;
};

// GENERATOR FUNCTIONS

const generateReadme = (complexity) => {
  return `# VibeCode Generated Project

This project was generated using VibeCode AI.

## Complexity: ${complexity}

## Quick Start

\`\`\`bash
npm install
npm start
\`\`\`

## Deploy

### Vercel
\`\`\`bash
npm run build
# Upload to Vercel
\`\`\`

### Netlify
\`\`\`bash
npm run build
# Upload build folder to Netlify
\`\`\`

## Generated with ❤️ by VibeCode
`;
};

const generateGitignore = () => {
  return `# Dependencies
node_modules/
.pnp
.pnp.js

# Testing
coverage/

# Production
build/

# Environment
.env
.env.local
.env.production

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db

# Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*
`;
};

const generatePackageJson = (complexity) => {
  const base = {
    name: "vibe-code-project",
    version: "1.0.0",
    scripts: {
      start: "react-scripts start",
      build: "react-scripts build",
      test: "react-scripts test",
      eject: "react-scripts eject"
    },
    dependencies: {
      react: "^18.0.0",
      "react-dom": "^18.0.0",
      "react-scripts": "5.0.1",
      "tailwindcss": "^3.0.0"
    }
  };
  
  if (complexity === 'complex') {
    base.dependencies.axios = "^1.6.0";
    base.dependencies["react-router-dom"] = "^6.0.0";
  }
  
  return JSON.stringify(base, null, 2);
};

const generateMainApp = (complexity) => {
  if (complexity === 'complex') {
    return `import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Hero from './components/Hero';
import './index.css';

function App() {
  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<Hero />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;`;
  } else {
    return `import React from 'react';
import Hero from './components/Hero';
import './index.css';

function App() {
  return (
    <div className="App">
      <Hero />
    </div>
  );
}

export default App;`;
  }
};

const generateIndex = () => {
  return `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`;
};

const generateStyles = () => {
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}`;
};

const generateHeroComponent = () => {
  return `import React from 'react';

const Hero = () => {
  return (
    <div className="bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-6xl">
            Welcome to Your
            <span className="text-indigo-600"> Amazing Project</span>
          </h1>
          <p className="mt-6 text-lg leading-8 text-gray-600">
            This project was generated with VibeCode AI. Start building something amazing!
          </p>
          <div className="mt-10 flex items-center justify-center gap-x-6">
            <button className="rounded-md bg-indigo-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
              Get Started
            </button>
            <button className="text-sm font-semibold leading-6 text-gray-900">
              Learn More →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Hero;`;
};

const generateHTML = () => {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#000000" />
    <meta name="description" content="Generated with VibeCode AI" />
    <title>VibeCode Generated App</title>
  </head>
  <body>
    <noscript>You need to enable JavaScript to run this app.</noscript>
    <div id="root"></div>
  </body>
</html>`;
};

const generateBackendPackageJson = () => {
  return JSON.stringify({
    name: "backend",
    version: "1.0.0",
    scripts: {
      start: "node server.js",
      dev: "nodemon server.js"
    },
    dependencies: {
      express: "^4.18.0",
      cors: "^2.8.5",
      prisma: "^5.7.0",
      "@prisma/client": "^5.7.0"
    }
  }, null, 2);
};

const generateExpressServer = () => {
  return `const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'Backend is running!' });
});

app.listen(PORT, () => {
  console.log(\`Backend server running on port \${PORT}\`);
});`;
};

const generatePrismaSchema = () => {
  return `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id       String @id @default(cuid())
  email    String @unique
  name     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}`;
};

const generateEnvExample = () => {
  return `# Database
DATABASE_URL="postgresql://user:password@localhost:5432/myapp"

# API
PORT=3001`;
};

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Advanced Refact proxy server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🤖 Projects API: http://localhost:${PORT}/v1/projects`);
  console.log(`🔧 Features: GitHub integration, Complex apps, Database generation`);
});
