const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');

const app = express();
const PORT = process.env.PORT || 8001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// SIMPLIFIED AGENT TOOLS IMPLEMENTATION

class RefactAgent {
  constructor() {
    this.tools = {
      search: this.searchCodebase.bind(this),
      tree: this.getFileTree.bind(this),
      cat: this.readFiles.bind(this),
      locate: this.locateFiles.bind(this),
      patch: this.applyPatch.bind(this),
      think: this.planTask.bind(this),
      web: this.fetchWebContent.bind(this)
    };
    this.workspaces = new Map(); // Store project workspaces
  }

  async searchCodebase(query, projectId) {
    const workspace = this.workspaces.get(projectId);
    if (!workspace) return [];
    
    // Simple text search
    const results = [];
    for (const [filePath, content] of Object.entries(workspace.files)) {
      if (content.toLowerCase().includes(query.toLowerCase())) {
        results.push({
          file: filePath,
          matches: content.split('\n').filter(line => 
            line.toLowerCase().includes(query.toLowerCase())
          )
        });
      }
    }
    return results;
  }

  async getFileTree(projectId) {
    const workspace = this.workspaces.get(projectId);
    if (!workspace) return {};
    
    const tree = {};
    for (const filePath of Object.keys(workspace.files)) {
      const parts = filePath.split('/');
      let current = tree;
      for (const part of parts) {
        if (!current[part]) {
          current[part] = {};
        }
        current = current[part];
      }
    }
    return tree;
  }

  async readFiles(files, projectId) {
    const workspace = this.workspaces.get(projectId);
    if (!workspace) return {};
    
    const result = {};
    for (const file of files) {
      if (workspace.files[file]) {
        result[file] = workspace.files[file];
      }
    }
    return result;
  }

  async locateFiles(taskDescription, projectId) {
    const workspace = this.workspaces.get(projectId);
    if (!workspace) return [];
    
    const relevantFiles = [];
    const files = Object.keys(workspace.files);
    
    // Simple relevance scoring
    for (const file of files) {
      if (taskDescription.toLowerCase().includes('component') && file.includes('component')) {
        relevantFiles.push({ file, relevance: 0.9 });
      } else if (taskDescription.toLowerCase().includes('style') && file.includes('.css')) {
        relevantFiles.push({ file, relevance: 0.8 });
      } else if (file.includes('.js') || file.includes('.jsx') || file.includes('.ts')) {
        relevantFiles.push({ file, relevance: 0.5 });
      }
    }
    
    return relevantFiles.sort((a, b) => b.relevance - a.relevance);
  }

  async applyPatch(changes, projectId, githubToken) {
    const workspace = this.workspaces.get(projectId);
    if (!workspace) throw new Error('Workspace not found');
    
    // Apply changes to workspace
    for (const change of changes) {
      if (change.type === 'create' || change.type === 'update') {
        workspace.files[change.file] = change.content;
      } else if (change.type === 'delete') {
        delete workspace.files[change.file];
      }
    }
    
    // Commit to GitHub
    const octokit = new Octokit({ auth: githubToken });
    const commits = [];
    
    for (const change of changes) {
      try {
        const result = await octokit.repos.createOrUpdateFileContents({
          owner: workspace.owner,
          repo: workspace.repo,
          path: change.file,
          message: `Agent: ${change.type} ${change.file}`,
          content: Buffer.from(change.content || '').toString('base64')
        });
        commits.push(result.data.commit.sha);
      } catch (error) {
        console.error(`Error patching ${change.file}:`, error.message);
      }
    }
    
    return commits;
  }

  async planTask(taskDescription) {
    const planningPrompt = `You are an expert software architect. Break down this task into a detailed execution plan:

Task: ${taskDescription}

Create a step-by-step plan that includes:
1. Understanding phase (what files to examine, what context to gather)
2. Planning phase (what changes are needed, dependencies, potential issues)  
3. Execution phase (specific code changes, file operations, testing)

Respond with a structured plan in JSON format:
{
  "understanding": [{"step": "...", "tool": "tree|cat|search|locate", "target": "..."}],
  "planning": [{"analysis": "...", "dependencies": [...], "risks": [...]}],
  "execution": [{"action": "...", "files": [...], "changes": "..."}]
}`;

    const response = await this.callClaudeAPI(planningPrompt);
    try {
      return JSON.parse(response.choices[0].message.content);
    } catch {
      return { error: "Failed to parse plan", raw: response.choices[0].message.content };
    }
  }

  async fetchWebContent(url) {
    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(url);
      const html = await response.text();
      
      // Simple text extraction
      const textContent = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
        
      return textContent.substring(0, 5000);
    } catch (error) {
      return `Error fetching ${url}: ${error.message}`;
    }
  }

  async callClaudeAPI(prompt) {
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
  }

  async executeAgentWorkflow(taskDescription, projectId, githubToken) {
    // 1. Planning phase
    const plan = await this.planTask(taskDescription);
    console.log('Agent Plan:', plan);
    
    // 2. Understanding phase
    const context = {};
    if (plan.understanding) {
      for (const step of plan.understanding) {
        switch (step.tool) {
          case 'tree':
            context.fileTree = await this.getFileTree(projectId);
            break;
          case 'cat':
            context.files = await this.readFiles(step.target ? step.target.split(',') : [], projectId);
            break;
          case 'search':
            context.searchResults = await this.searchCodebase(step.target || '', projectId);
            break;
          case 'locate':
            context.relevantFiles = await this.locateFiles(step.target || taskDescription, projectId);
            break;
        }
      }
    }
    
    // 3. Execution phase with context
    const executionPrompt = `You are an autonomous coding agent with GitHub commit capabilities. Execute this task:

Task: ${taskDescription}

Plan: ${JSON.stringify(plan, null, 2)}

Context: ${JSON.stringify(context, null, 2)}

Based on the plan and context, provide the exact code changes needed. You MUST format your response as valid JSON:

{
  "changes": [
    {"type": "create", "file": "src/components/Hero.jsx", "content": "import React from 'react';\\n\\nconst Hero = () => {\\n  return (\\n    <div>Hero Component</div>\\n  );\\n};\\n\\nexport default Hero;"},
    {"type": "update", "file": "src/App.jsx", "content": "updated file content here"}
  ],
  "reasoning": "Created Hero component and updated App.jsx to use it"
}

Make actual working React components with Tailwind CSS that can be directly applied to GitHub.`;

    const response = await this.callClaudeAPI(executionPrompt);
    
    try {
      const result = JSON.parse(response.choices[0].message.content);
      
      // Apply the patches
      if (result.changes && result.changes.length > 0) {
        const commits = await this.applyPatch(result.changes, projectId, githubToken);
        return {
          success: true,
          changes: result.changes,
          reasoning: result.reasoning,
          commits: commits,
          plan: plan
        };
      }
      
      return { success: false, error: "No changes generated", response: response.choices[0].message.content };
    } catch (error) {
      return { success: false, error: "Failed to parse agent response", raw: response.choices[0].message.content };
    }
  }
}

// Initialize agent
const agent = new RefactAgent();

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'refact-agent-full',
    version: '3.0.0',
    features: ['agent-tools', 'autonomous-patching', 'github-integration', 'supabase-chat'],
    agent_tools: Object.keys(agent.tools),
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
        "supports_github": true,
        "supports_persistent_chat": true,
        "supports_autonomous_patching": true,
        "supports_agent_tools": true
      }
    },
    "agent_tools": {
      "search": "Find similar code using text search",
      "tree": "Get file tree with symbols",
      "cat": "Read multiple files", 
      "locate": "Find relevant files for tasks",
      "patch": "Apply changes to files and commit to GitHub",
      "think": "Analyze complex problems and create execution plans",
      "web": "Fetch web pages for documentation"
    },
    "version": "3.0.0"
  });
});

// Create new project with workspace
app.post('/v1/projects/create', async (req, res) => {
  try {
    const { project_name, github_token, complexity = 'simple', user_id } = req.body;
    
    const slug = project_name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    
    // Create GitHub repository
    const octokit = new Octokit({ auth: github_token });
    const repo = await octokit.repos.createForAuthenticatedUser({
      name: slug,
      description: `${complexity} app created with Refact Agent`,
      private: false,
      auto_init: true
    });
    
    // Store project in Supabase
    const { data: project, error } = await supabase
      .from('projects')
      .insert({
        name: project_name,
        slug: slug,
        complexity,
        github_repo: repo.data.html_url,
        github_clone_url: repo.data.clone_url,
        owner: repo.data.owner.login,
        repo_name: slug,
        user_id: user_id || null
      })
      .select()
      .single();

    if (error) throw error;

    // Create workspace for agent
    agent.workspaces.set(project.id, {
      id: project.id,
      owner: repo.data.owner.login,
      repo: slug,
      files: {}
    });

    // Generate initial project structure
    const projectStructure = generateProjectStructure(complexity);
    
    // Add to workspace
    agent.workspaces.get(project.id).files = projectStructure;
    
    // Commit initial files
    await commitFilesToRepo(octokit, repo.data.owner.login, slug, projectStructure);
    
    res.json({
      project_id: project.id,
      project_slug: project.slug,
      github_repo_url: repo.data.html_url,
      clone_url: repo.data.clone_url,
      complexity,
      agent_ready: true,
      initial_structure: Object.keys(projectStructure)
    });
    
  } catch (error) {
    console.error('Project creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// AUTONOMOUS AGENT CHAT - Full capabilities
app.post('/v1/projects/:projectId/agent', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { task, github_token, auto_approve = false } = req.body;
    
    // Get project
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .or(`id.eq.${projectId},slug.eq.${projectId}`)
      .single();
      
    if (projectError || !project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Ensure workspace exists
    if (!agent.workspaces.has(project.id)) {
      // Load workspace from GitHub
      const octokit = new Octokit({ auth: github_token });
      const workspace = await loadWorkspaceFromGitHub(octokit, project);
      agent.workspaces.set(project.id, workspace);
    }

    // Execute autonomous agent workflow
    const result = await agent.executeAgentWorkflow(task, project.id, github_token);
    
    res.json({
      success: result.success,
      task: task,
      plan: result.plan,
      changes: result.changes,
      reasoning: result.reasoning,
      commits: result.commits,
      github_repo: project.github_repo,
      error: result.error,
      raw_response: result.raw
    });

  } catch (error) {
    console.error('Agent execution error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper functions
const loadWorkspaceFromGitHub = async (octokit, project) => {
  const workspace = {
    id: project.id,
    owner: project.owner,
    repo: project.repo_name,
    files: {}
  };
  
  try {
    const { data: contents } = await octokit.repos.getContent({
      owner: project.owner,
      repo: project.repo_name,
      path: ''
    });
    
    for (const item of contents) {
      if (item.type === 'file') {
        const { data: file } = await octokit.repos.getContent({
          owner: project.owner,
          repo: project.repo_name,
          path: item.path
        });
        
        workspace.files[item.path] = Buffer.from(file.content, 'base64').toString();
      }
    }
  } catch (error) {
    console.error('Error loading workspace:', error.message);
  }
  
  return workspace;
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

const generateProjectStructure = (complexity) => {
  return {
    'src/App.jsx': `import React from 'react';

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <h1 className="text-4xl font-bold text-center py-20">
        Welcome to your Refact Agent project!
      </h1>
      <p className="text-center text-gray-600">
        This project has autonomous agent capabilities
      </p>
    </div>
  );
}

export default App;`,
    'package.json': JSON.stringify({
      name: "refact-agent-project",
      version: "1.0.0",
      dependencies: {
        react: "^18.0.0",
        "react-dom": "^18.0.0",
        "@tailwindcss/forms": "^0.5.0"
      }
    }, null, 2),
    'README.md': `# Refact Agent Project

This project was created with autonomous agent capabilities.

## Features
- Autonomous code generation
- GitHub integration
- Real-time file patching
- Agent tool support

## Getting Started
\`\`\`bash
npm install
npm start
\`\`\`
`
  };
};

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🤖 Refact.ai Agent running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🛠️ Agent Tools: ${Object.keys(agent.tools).join(', ')}`);
  console.log(`🔧 Autonomous patching enabled`);
});

// CHAT INTERFACE WITH SUPABASE PERSISTENCE (Missing endpoint)

// Chat with project (approve, modify, ask questions)
app.post('/v1/projects/:projectId/chat', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { message, github_token, session_id } = req.body;
    
    // Get project
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .or(`id.eq.${projectId},slug.eq.${projectId}`)
      .single();
      
    if (projectError || !project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get or create chat session
    let chatSession;
    if (session_id) {
      const { data } = await supabase
        .from('chat_sessions')
        .select('*')
        .eq('id', session_id)
        .single();
      chatSession = data;
    } else {
      // Get the main session or create one
      const { data: sessions } = await supabase
        .from('chat_sessions')
        .select('*')
        .eq('project_id', project.id)
        .limit(1);
        
      if (sessions && sessions.length > 0) {
        chatSession = sessions[0];
      } else {
        const { data: newSession } = await supabase
          .from('chat_sessions')
          .insert({
            project_id: project.id,
            session_name: 'Main Chat'
          })
          .select()
          .single();
        chatSession = newSession;
      }
    }

    // Get chat history
    const { data: chatHistory } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('session_id', chatSession.id)
      .order('timestamp', { ascending: true });

    // Add user message to history
    await supabase
      .from('chat_messages')
      .insert({
        session_id: chatSession.id,
        role: 'user',
        content: message
      });

    // Analyze user intent
    const intent = analyzeUserIntent(message);
    let response = '';
    let action_taken = null;

    if (intent.type === 'approve') {
      // User wants to approve and commit using agent
      if (!agent.workspaces.has(project.id)) {
        const octokit = new Octokit({ auth: github_token });
        const workspace = await loadWorkspaceFromGitHub(octokit, project);
        agent.workspaces.set(project.id, workspace);
      }

      // Use agent to commit the current state
      const result = await agent.executeAgentWorkflow(
        "Commit all current changes to GitHub", 
        project.id, 
        github_token
      );
      
      if (result.success) {
        response = "✅ Perfect! I've committed your code to GitHub using the autonomous agent! 🚀\n\nYour website is now live at: " + project.github_repo;
        action_taken = 'committed_to_github';
      } else {
        response = "❌ I had trouble committing to GitHub: " + (result.error || 'Unknown error');
        action_taken = 'commit_failed';
      }

    } else if (intent.type === 'deploy' || message.toLowerCase().includes('see the website') || message.toLowerCase().includes('final html')) {
      // User wants to see the deployed website
      response = `🌐 To see your completed website, you have a few options:

**Option 1: Deploy to Vercel (Easiest)**
1. Go to [vercel.com](https://vercel.com)
2. Connect your GitHub account
3. Import your repository: ${project.github_repo}
4. Click "Deploy" - it will be live in 2 minutes!

**Option 2: Deploy to Netlify**
1. Go to [netlify.com](https://netlify.com)
2. Drag and drop your project files
3. Get instant live URL

**Option 3: GitHub Pages**
1. Go to your repo: ${project.github_repo}
2. Settings → Pages → Deploy from main branch

**Your repo has all the code ready to deploy!** 🚀

Would you like me to help you set up automatic deployment?`;
      action_taken = 'deployment_help';

    } else if (intent.type === 'modify') {
      // User wants to modify the code using agent
      const result = await agent.executeAgentWorkflow(message, project.id, github_token);
      
      if (result.success) {
        response = "✨ Great! I've updated your code using the autonomous agent:\n\n" + 
                  `**Changes made:**\n${result.changes.map(c => `- ${c.type}: ${c.file}`).join('\n')}\n\n` +
                  `**Reasoning:** ${result.reasoning}\n\n` +
                  "💬 The changes have been committed to GitHub! Check your repository or deploy to see the updates.";
        action_taken = 'code_modified_by_agent';
      } else {
        response = "🤔 I had trouble making those changes: " + (result.error || 'Unknown error');
        action_taken = 'modification_failed';
      }

    } else {
      // General conversation
      const conversationPrompt = buildConversationPrompt(message, chatHistory, project);
      const aiResponse = await agent.callClaudeAPI(conversationPrompt);
      
      response = aiResponse.choices[0].message.content;
      action_taken = 'general_chat';
    }

    // Add AI response to history
    await supabase
      .from('chat_messages')
      .insert({
        session_id: chatSession.id,
        role: 'assistant',
        content: response,
        action_taken
      });

    res.json({
      message: response,
      action_taken,
      session_id: chatSession.id,
      project_info: {
        id: project.id,
        slug: project.slug,
        name: project.name,
        github_repo: project.github_repo
      }
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper functions for chat
const analyzeUserIntent = (message) => {
  const msg = message.toLowerCase();
  
  if (msg.includes('commit') || msg.includes('approve') || msg.includes('looks good') || 
      msg.includes('perfect') || msg.includes('push')) {
    return { type: 'approve' };
  }
  
  if (msg.includes('deploy') || msg.includes('see the website') || msg.includes('final html') ||
      msg.includes('live version') || msg.includes('view the site')) {
    return { type: 'deploy' };
  }
  
  if (msg.includes('change') || msg.includes('modify') || msg.includes('update') ||
      msg.includes('make it') || msg.includes('add') || msg.includes('remove')) {
    return { type: 'modify' };
  }
  
  return { type: 'general' };
};

const buildConversationPrompt = (userMessage, chatHistory, project) => {
  let prompt = `You are an AI assistant helping with the ${project.name} project. `;
  
  if (chatHistory && chatHistory.length > 0) {
    prompt += `Previous conversation:\n`;
    chatHistory.slice(-4).forEach(msg => {
      prompt += `${msg.role}: ${msg.content}\n`;
    });
    prompt += `\n`;
  }
  
  prompt += `User: ${userMessage}\n\nRespond helpfully and conversationally. If they want to see their website, suggest deployment options.`;
  
  return prompt;
};

