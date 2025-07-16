const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');
const fs = require('fs-extra');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 8001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// In-memory project storage (upgrade to database later)
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

// PROJECT MANAGEMENT ENDPOINTS

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
    
    // Read current project files from GitHub
    const octokit = new Octokit({ auth: github_token });
    const currentFiles = await readProjectFiles(octokit, project.owner, project.repo_name);
    
    // Build context-aware prompt
    const contextualPrompt = buildAdvancedPrompt(prompt, currentFiles, feature_type, project.complexity);
    
    // Generate with Claude
    const response = await callClaudeAPI(contextualPrompt);
    
    // Parse response and determine files to create/update
    const updatedFiles = parseAdvancedResponse(response, currentFiles, feature_type);
    
    // Commit changes to GitHub
    const commits = await commitUpdatedFiles(octokit, project.owner, project.repo_name, updatedFiles);
    
    // Update project in memory
    project.files = { ...project.files, ...updatedFiles };
    projects.set(projectId, project);
    
    res.json({
      generated_content: response.choices[0].message.content,
      updated_files: Object.keys(updatedFiles),
      commits: commits,
      github_repo_url: project.github_repo
    });
    
  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ADVANCED GENERATION FUNCTIONS

const generateProjectStructure = (complexity) => {
  const baseStructure = {
    'package.json': generatePackageJson(complexity),
    'README.md': generateReadme(complexity),
    '.gitignore': generateGitignore(),
    'src/App.js': generateMainApp(complexity),
    'src/index.js': generateIndex(),
    'src/index.css': generateStyles(),
    'public/index.html': generateHTML()
  };
  
  if (complexity === 'complex') {
    Object.assign(baseStructure, {
      'backend/package.json': generateBackendPackageJson(),
      'backend/server.js': generateExpressServer(),
      'backend/prisma/schema.prisma': generatePrismaSchema(),
      'backend/routes/auth.js': generateAuthRoutes(),
      'backend/routes/api.js': generateApiRoutes(),
      'backend/middleware/auth.js': generateAuthMiddleware(),
      'src/contexts/AuthContext.js': generateAuthContext(),
      'src/components/Dashboard.js': generateDashboard(),
      'src/components/Login.js': generateLogin(),
      'docker-compose.yml': generateDockerCompose(),
      '.env.example': generateEnvExample()
    });
  }
  
  return baseStructure;
};

const buildAdvancedPrompt = (userPrompt, currentFiles, featureType, complexity) => {
  let prompt = `You are building a ${complexity} ${featureType === 'database' ? 'full-stack' : 'React'} application. `;
  
  if (complexity === 'complex') {
    prompt += `This is a full-stack application with:
- React frontend with Tailwind CSS
- Express.js backend
- PostgreSQL database with Prisma ORM
- JWT authentication
- RESTful API endpoints

Current project structure:
`;
    
    Object.keys(currentFiles).forEach(file => {
      prompt += `- ${file}\n`;
    });
    
    prompt += `\nKey existing files content:\n`;
    
    if (currentFiles['backend/prisma/schema.prisma']) {
      prompt += `Database Schema:\n${currentFiles['backend/prisma/schema.prisma']}\n\n`;
    }
    
    if (currentFiles['src/App.js']) {
      prompt += `Frontend App.js:\n${currentFiles['src/App.js']}\n\n`;
    }
  }
  
  prompt += `User request: ${userPrompt}\n\n`;
  
  if (featureType === 'database') {
    prompt += `Please provide:
1. Updated Prisma schema if needed
2. Backend API routes
3. Frontend components to interact with the new feature
4. Any necessary migrations or setup

Format your response as a JSON object with file paths as keys and content as values.`;
  } else {
    prompt += `Please provide the ${featureType} code that integrates seamlessly with the existing codebase.`;
  }
  
  return prompt;
};

// GitHub Operations
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

const readProjectFiles = async (octokit, owner, repo) => {
  const files = {};
  const filesToRead = [
    'src/App.js', 'package.json', 'backend/server.js', 
    'backend/prisma/schema.prisma', 'backend/routes/auth.js'
  ];
  
  for (const filePath of filesToRead) {
    try {
      const response = await octokit.repos.getContent({
        owner,
        repo,
        path: filePath
      });
      
      if (response.data.content) {
        files[filePath] = Buffer.from(response.data.content, 'base64').toString();
      }
    } catch (error) {
      // File doesn't exist yet
    }
  }
  
  return files;
};

// File generators (you'll need to implement these)
const generatePackageJson = (complexity) => {
  const base = {
    name: "vibe-code-project",
    version: "1.0.0",
    scripts: {
      start: "react-scripts start",
      build: "react-scripts build"
    },
    dependencies: {
      react: "^18.0.0",
      "react-dom": "^18.0.0",
      "react-scripts": "5.0.1",
      "tailwindcss": "^3.0.0"
    }
  };
  
  if (complexity === 'complex') {
    base.scripts.dev = "concurrently \"npm run start\" \"npm run server\"";
    base.scripts.server = "cd backend && npm run dev";
    base.dependencies.axios = "^1.6.0";
    base.dependencies.concurrently = "^8.0.0";
  }
  
  return JSON.stringify(base, null, 2);
};

// Add more generators...

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Advanced Refact proxy server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🤖 Projects API: http://localhost:${PORT}/v1/projects`);
  console.log(`🔧 Features: GitHub integration, Complex apps, Database generation`);
});

// MISSING GENERATOR FUNCTIONS - Add these to the end of server.js

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

const generateMainApp = (complexity) => {
  if (complexity === 'complex') {
    return `import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import Dashboard from './components/Dashboard';
import Login from './components/Login';
import Hero from './components/Hero';
import './index.css';

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="App">
          <Routes>
            <Route path="/" element={<Hero />} />
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<Dashboard />} />
          </Routes>
        </div>
      </Router>
    </AuthProvider>
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

// Complex app generators (for full-stack)
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
      jsonwebtoken: "^9.0.0",
      bcryptjs: "^2.4.3",
      prisma: "^5.7.0",
      "@prisma/client": "^5.7.0"
    },
    devDependencies: {
      nodemon: "^3.0.0"
    }
  }, null, 2);
};

const generateExpressServer = () => {
  return `const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Basic route
app.get('/api/health', (req, res) => {
  res.json({ status: 'Backend is running!' });
});

// Auth routes will be added here

app.listen(PORT, () => {
  console.log(\`Backend server running on port \${PORT}\`);
});`;
};

const generatePrismaSchema = () => {
  return `// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

generator client {
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
  password String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}`;
};

const generateAuthRoutes = () => {
  return `const express = require('express');
const router = express.Router();

router.post('/register', async (req, res) => {
  // Registration logic here
  res.json({ message: 'Registration endpoint' });
});

router.post('/login', async (req, res) => {
  // Login logic here  
  res.json({ message: 'Login endpoint' });
});

module.exports = router;`;
};

const generateApiRoutes = () => {
  return `const express = require('express');
const router = express.Router();

router.get('/users', async (req, res) => {
  // Get users logic
  res.json({ message: 'Users endpoint' });
});

module.exports = router;`;
};

const generateAuthMiddleware = () => {
  return `const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = authMiddleware;`;
};

const generateAuthContext = () => {
  return `import React, { createContext, useContext, useState } from 'react';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  
  const login = async (email, password) => {
    // Login logic here
    console.log('Login:', email);
  };
  
  const logout = () => {
    setUser(null);
  };
  
  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};`;
};

const generateDashboard = () => {
  return `import React from 'react';

const Dashboard = () => {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <div className="mt-6">
          <p className="text-gray-600">Welcome to your dashboard!</p>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;`;
};

const generateLogin = () => {
  return `import React, { useState } from 'react';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  const handleSubmit = (e) => {
    e.preventDefault();
    console.log('Login attempt:', email);
  };
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8">
        <h2 className="text-3xl font-bold text-center">Sign In</h2>
        <form onSubmit={handleSubmit} className="space-y-6">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700"
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;`;
};

const generateDockerCompose = () => {
  return `version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:`;
};

const generateEnvExample = () => {
  return `# Database
DATABASE_URL="postgresql://postgres:password@localhost:5432/myapp"

# JWT
JWT_SECRET="your-secret-key-here"

# API
PORT=3001`;
};


// MISSING GENERATOR FUNCTIONS - Add these to the end of server.js

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


// MISSING GENERATOR FUNCTIONS - Add these to the end of server.js

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

