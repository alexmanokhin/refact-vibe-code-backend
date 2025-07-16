const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 8001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://your-project.supabase.co',
  process.env.SUPABASE_ANON_KEY || 'your-anon-key'
);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'refact-proxy-advanced',
    version: '2.1.0',
    features: ['github', 'projects', 'complex-apps', 'supabase-chat'],
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
        "supports_persistent_chat": true
      }
    },
    "features": {
      "project_management": true,
      "github_integration": true,
      "database_generation": true,
      "full_stack_apps": true,
      "file_operations": true,
      "persistent_chat": true,
      "supabase_storage": true
    },
    "version": "2.1.0"
  });
});

// Create new project with GitHub repo
app.post('/v1/projects/create', async (req, res) => {
  try {
    const { project_name, github_token, complexity = 'simple', user_id } = req.body;
    
    const slug = project_name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    
    // Create GitHub repository
    const octokit = new Octokit({ auth: github_token });
    const repo = await octokit.repos.createForAuthenticatedUser({
      name: slug,
      description: `${complexity} app created with VibeCode`,
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

    // Create initial chat session
    const { data: session } = await supabase
      .from('chat_sessions')
      .insert({
        project_id: project.id,
        user_id: user_id || null,
        session_name: 'Main Chat'
      })
      .select()
      .single();

    // Generate initial project structure
    const projectStructure = generateProjectStructure(complexity);
    
    // Commit initial files
    await commitFilesToRepo(octokit, repo.data.owner.login, slug, projectStructure);
    
    res.json({
      project_id: project.id,
      project_slug: project.slug,
      session_id: session.id,
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

// Get project by ID or slug
app.get('/v1/projects/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    
    // Try to find by ID first, then by slug
    let query = supabase.from('projects').select('*');
    
    if (identifier.includes('-') && identifier.length > 30) {
      // Looks like UUID
      query = query.eq('id', identifier);
    } else {
      // Looks like slug
      query = query.eq('slug', identifier);
    }
    
    const { data: project, error } = await query.single();
    
    if (error || !project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Get chat sessions for this project
    const { data: sessions } = await supabase
      .from('chat_sessions')
      .select('*')
      .eq('project_id', project.id);
    
    res.json({
      project,
      chat_sessions: sessions
    });
    
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({ error: error.message });
  }
});

// CHAT INTERFACE WITH SUPABASE PERSISTENCE

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
      // User wants to approve and commit
      const { data: pendingCode } = await supabase
        .from('pending_code')
        .select('*')
        .eq('session_id', chatSession.id)
        .eq('status', 'pending');
        
      if (pendingCode && pendingCode.length > 0) {
        try {
          const octokit = new Octokit({ auth: github_token });
          await commitPendingCodeToGitHub(octokit, project, pendingCode);
          
          // Mark code as committed
          await supabase
            .from('pending_code')
            .update({ status: 'committed' })
            .eq('session_id', chatSession.id)
            .eq('status', 'pending');
          
          response = "✅ Perfect! I've committed your code to GitHub. Your HI VIBE landing page is now live in your repository! 🚀\n\nYou can find the updated files at: " + project.github_repo;
          action_taken = 'committed_to_github';
        } catch (error) {
          response = "❌ I had trouble committing to GitHub. Please check your token permissions. Error: " + error.message;
          action_taken = 'commit_failed';
        }
      } else {
        response = "🤔 I don't have any pending code to commit. Would you like me to generate something first?";
        action_taken = 'no_pending_code';
      }

    } else if (intent.type === 'modify') {
      // User wants to modify the code
      const modificationPrompt = buildModificationPrompt(message, chatHistory);
      const aiResponse = await callClaudeAPI(modificationPrompt);
      
      // Parse and store new code
      const codeFiles = parseGeneratedCode(aiResponse.choices[0].message.content);
      
      // Clear old pending code
      await supabase
        .from('pending_code')
        .delete()
        .eq('session_id', chatSession.id)
        .eq('status', 'pending');
      
      // Store new pending code
      for (const [filePath, content] of Object.entries(codeFiles)) {
        await supabase
          .from('pending_code')
          .insert({
            session_id: chatSession.id,
            file_path: filePath,
            content: content,
            status: 'pending'
          });
      }
      
      response = "✨ Great idea! I've updated the code based on your feedback:\n\n" + 
                aiResponse.choices[0].message.content + 
                "\n\n💬 What do you think? Say 'commit it' if you're happy with the changes, or ask for more modifications!";
      action_taken = 'code_modified';

    } else {
      // General conversation
      const conversationPrompt = buildConversationPrompt(message, chatHistory);
      const aiResponse = await callClaudeAPI(conversationPrompt);
      
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

// Get chat history for a session
app.get('/v1/projects/:projectId/chat/:sessionId/history', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const { data: messages, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('timestamp', { ascending: true });
      
    if (error) throw error;
    
    res.json({ messages });
    
  } catch (error) {
    console.error('Get chat history error:', error);
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

// HELPER FUNCTIONS (abbreviated for space)
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

const analyzeUserIntent = (message) => {
  const msg = message.toLowerCase();
  
  if (msg.includes('commit') || msg.includes('approve') || msg.includes('looks good') || 
      msg.includes('perfect') || msg.includes('deploy') || msg.includes('push')) {
    return { type: 'approve' };
  }
  
  if (msg.includes('change') || msg.includes('modify') || msg.includes('update') ||
      msg.includes('make it') || msg.includes('add') || msg.includes('remove')) {
    return { type: 'modify' };
  }
  
  return { type: 'general' };
};

const buildModificationPrompt = (userMessage, chatHistory) => {
  let prompt = `You are helping modify a React component. `;
  
  if (chatHistory && chatHistory.length > 0) {
    prompt += `Previous conversation context:\n`;
    chatHistory.slice(-4).forEach(msg => {
      prompt += `${msg.role}: ${msg.content}\n`;
    });
    prompt += `\n`;
  }
  
  prompt += `User request: ${userMessage}\n\n`;
  prompt += `Please provide the updated code that addresses their feedback.`;
  
  return prompt;
};

const buildConversationPrompt = (userMessage, chatHistory) => {
  let prompt = `You are an AI assistant helping with a coding project. `;
  
  if (chatHistory && chatHistory.length > 0) {
    prompt += `Previous conversation:\n`;
    chatHistory.slice(-4).forEach(msg => {
      prompt += `${msg.role}: ${msg.content}\n`;
    });
    prompt += `\n`;
  }
  
  prompt += `User: ${userMessage}\n\nRespond helpfully and conversationally.`;
  
  return prompt;
};

const parseGeneratedCode = (aiResponse) => {
  // Simple code parsing - extract files
  const codeBlocks = {};
  
  if (aiResponse.includes('```')) {
    const matches = aiResponse.match(/```[\s\S]*?```/g);
    if (matches) {
      matches.forEach((match, index) => {
        const cleanCode = match.replace(/```jsx?/g, '').replace(/```/g, '').trim();
        codeBlocks[`src/component_${index}.jsx`] = cleanCode;
      });
    }
  }
  
  return codeBlocks;
};

const commitPendingCodeToGitHub = async (octokit, project, pendingCodeArray) => {
  const commits = [];
  
  for (const codeItem of pendingCodeArray) {
    try {
      const result = await octokit.repos.createOrUpdateFileContents({
        owner: project.owner,
        repo: project.repo_name,
        path: codeItem.file_path,
        message: `Update ${codeItem.file_path} via HI VIBE chat`,
        content: Buffer.from(codeItem.content).toString('base64')
      });
      commits.push(result.data.commit.sha);
    } catch (error) {
      console.error(`Error committing ${codeItem.file_path}:`, error.message);
    }
  }
  
  return commits;
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
        Welcome to your new project!
      </h1>
    </div>
  );
}

export default App;`,
    'package.json': JSON.stringify({
      name: "vibe-code-project",
      version: "1.0.0",
      dependencies: {
        react: "^18.0.0",
        "react-dom": "^18.0.0"
      }
    }, null, 2)
  };
};

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Advanced Refact proxy server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🤖 Projects API: http://localhost:${PORT}/v1/projects`);
  console.log(`💬 Chat API: http://localhost:${PORT}/v1/projects/{id}/chat`);
  console.log(`🗄️ Using Supabase for persistence`);
});
