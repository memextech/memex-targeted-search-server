# Memex Targeted Search Server

A Model Context Protocol (MCP) server that provides targeted search capabilities across Memex conversation history and project files.

## Overview

This MCP server enables AI agents to efficiently search through:
- **Conversation History**: 952+ conversation files from Memex with metadata, titles, summaries, and message content
- **Project Files**: 516+ project directories in the user's workspace with various file types and technologies

## Features

### 🔍 Core Search Tools

1. **`search_conversations`** - Search conversation history by text, metadata, and filters
2. **`get_conversation_snippet`** - Retrieve specific parts of conversations without context overload
3. **`search_projects`** - Search project files by content, file types, and names
4. **`get_project_overview`** - Get project summaries with technology detection
5. **`find_command`** - **NEW!** Find specific commands, CLI usage, or code snippets from conversation history

### 🎯 Smart Context Management

- Returns targeted snippets instead of full conversations
- Limits search scope to prevent context explosion
- Supports faceted filtering (dates, projects, file types)
- Provides relevance scoring for search results

## Installation

```bash
# Clone the repository
git clone https://github.com/memextech/memex-targeted-search-server.git
cd memex-targeted-search-server

# Install dependencies
npm install

# Build the project
npm run build
```

## Configuration

The server is configured to search:
- **Conversation History**: `~/Library/Application Support/Memex/history/`
- **Project Files**: `~/Workspace/`

### MCP Server Configuration

Add to your MCP configuration (e.g., Claude Desktop config):

```json
{
  "mcpServers": {
    "memex-search": {
      "command": "node",
      "args": ["/path/to/memex-targeted-search-server/dist/index.js"]
    }
  }
}
```

## Usage Examples

### 1. Find Forgotten Commands

#### "I don't remember what the command is to run the memex agent cli"
```typescript
find_command({
  query: "memex agent cli",
  command_type: "cli",
  limit: 5
})
```

#### Find specific npm commands
```typescript
find_command({
  query: "npm install",
  command_type: "cli",
  limit: 5
})
```

**Example Response:**
```json
{
  "query": "npm install",
  "total_found": 3,
  "commands": [
    {
      "command": "npm install -g firebase-tools",
      "context": "Install Firebase CLI: `npm install -g firebase-tools`\n- Login to Firebase: `firebase login`",
      "conversation_id": "abc123",
      "conversation_title": "Firebase Setup Guide",
      "message_index": 7,
      "confidence": 0.9,
      "type": "cli"
    }
  ]
}
```

### 2. Search Conversations

#### Find conversations about specific topics
```typescript
search_conversations({
  query: "3D modeling",
  limit: 5
})
```

**Example Response:**
```json
{
  "total_found": 3,
  "conversations": [
    {
      "conversation_id": "a3edfc8f-0978-415e-9de8-18f4d94ea3a2",
      "title": "3D Interactive Solar System Model",
      "summary": "Design an engaging, visually appealing 3D representation of planets and celestial bodies",
      "created_at": "2025-05-27T17:13:26Z",
      "project": "Stellar 3d solar system",
      "message_count": 76,
      "relevance": "content"
    }
  ]
}
```

#### Filter by date range and project
```typescript
search_conversations({
  query: "python",
  project: "cad_example",
  date_from: "2025-01-01",
  date_to: "2025-03-01",
  limit: 3
})
```

### 3. Get Conversation Details

#### Retrieve specific messages from a conversation
```typescript
get_conversation_snippet({
  conversation_id: "bf283daa-25d3-434f-ad7e-9adda48cdcdd",
  message_start: 1,
  message_count: 3
})
```

**Example Response:**
```json
{
  "conversation_id": "bf283daa-25d3-434f-ad7e-9adda48cdcdd",
  "title": "3D Model 3MF File Creation",
  "message_range": "1-3",
  "total_messages": 30,
  "messages": [
    {
      "index": 1,
      "role": "user",
      "content": "can I create a 3D model in .3mf?"
    },
    {
      "index": 2,
      "role": "assistant",
      "content": "I'll help you create a 3D model using PythonOCC and convert it to .3mf format..."
    }
  ]
}
```

### 4. Search Projects

#### Find files by technology
```typescript
search_projects({
  query: "interface",
  file_types: ["ts", "js"],
  limit: 10
})
```

#### Search all project files
```typescript
search_projects({
  query: "streamlit",
  limit: 5
})
```

**Example Response:**
```json
{
  "total_found": 3,
  "results": [
    {
      "project": "ad_campaign_dashboard",
      "file": "ad_campaign_dashboard/app.py",
      "match": "import streamlit as st",
      "line": 1
    }
  ]
}
```

### 5. Get Project Overview

#### Analyze project structure and tech stack
```typescript
get_project_overview({
  project_name: "memex_targeted_search_server"
})
```

**Example Response:**
```json
{
  "name": "memex_targeted_search_server",
  "path": "/Users/user/Workspace/memex_targeted_search_server",
  "file_count": 8,
  "directories": ["dist", "src"],
  "file_types": {
    "ts": 1,
    "js": 1,
    "json": 3,
    "md": 1
  },
  "main_files": ["package.json", "README.md"],
  "technologies": ["JavaScript/TypeScript"]
}
```

## Real-World Usage Scenarios

### Scenario 1: "I forgot that command..."
```typescript
// User: "I don't remember what the command is to run the memex agent cli"
find_command({
  query: "memex agent",
  command_type: "cli",
  limit: 5
})

// User: "What was that firebase command to deploy?"
find_command({
  query: "firebase deploy",
  command_type: "cli",
  limit: 3
})

// Result: Finds exact commands with context from previous conversations
```

### Scenario 2: Finding Related Work
```typescript
// Agent: "I need to find previous conversations about Blender projects"
search_conversations({
  query: "blender",
  limit: 5
})

// Result: Finds 2 conversations about 3D Manhattan cityscape and geometric skyscraper
// Agent can then drill down into specific conversations for details
```

### Scenario 3: Code Reference Lookup
```typescript
// Agent: "Show me Python projects that use Streamlit"
search_projects({
  query: "streamlit",
  file_types: ["py"],
  limit: 10
})

// Result: Finds specific Python files with Streamlit imports
// Agent can then examine project structure and implementation patterns
```

### Scenario 4: Cross-Reference Discovery
```typescript
// Agent: "Find conversations from January 2025 about 3D modeling"
search_conversations({
  query: "3D model",
  date_from: "2025-01-01",
  date_to: "2025-01-31",
  limit: 5
})

// Agent: "Now show me the related project files"
get_project_overview({
  project_name: "cad_example"
})
```

## API Reference

### search_conversations
- **Purpose**: Search conversation history with flexible filtering
- **Parameters**: `query` (required), `limit`, `project`, `date_from`, `date_to`
- **Returns**: Array of conversation metadata with relevance scoring

### get_conversation_snippet  
- **Purpose**: Retrieve specific message ranges from conversations
- **Parameters**: `conversation_id` (required), `message_start`, `message_count`
- **Returns**: Conversation snippet with message details

### search_projects
- **Purpose**: Search project files by content and metadata
- **Parameters**: `query` (required), `file_types`, `limit`
- **Returns**: Array of file matches with context

### get_project_overview
- **Purpose**: Analyze project structure and technology stack
- **Parameters**: `project_name` (required)
- **Returns**: Project summary with file counts and tech detection

### find_command
- **Purpose**: Find specific commands, CLI usage, or code snippets from conversation history
- **Parameters**: `query` (required), `command_type` (cli/code/config/any), `limit`
- **Returns**: Array of commands with context, confidence scoring, and conversation references

## Architecture

Built with:
- **TypeScript** - Type-safe development
- **MCP SDK** - Official Model Context Protocol SDK
- **Node.js** - Runtime environment
- **File System APIs** - Direct file access for performance

## Performance Considerations

- Limits search scope to prevent overwhelming results
- Uses streaming JSON parsing for large files
- Implements intelligent file filtering
- Caches frequently accessed metadata
- Returns truncated content with full context available on demand

## Agent Experience

The server is designed for optimal agent interaction:
- **Targeted Search**: Find specific information without context overload
- **Faceted Filtering**: Multiple search dimensions (date, project, file type)
- **Progressive Discovery**: Start with summaries, drill down to details
- **Context Preservation**: Maintain conversation and project relationships

## Development

### Running in Development
```bash
npm run dev
```

### Building for Production
```bash
npm run build
npm start
```

### Testing
The server includes comprehensive error handling and graceful degradation for:
- Missing or corrupted conversation files
- Inaccessible project directories
- Invalid JSON parsing
- Large file handling

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

ISC License

---

🤖 Generated with [Memex](https://memex.tech)  
Co-Authored-By: Memex <noreply@memex.tech>