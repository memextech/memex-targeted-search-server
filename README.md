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

### 🎯 Smart Context Management

- Returns targeted snippets instead of full conversations
- Limits search scope to prevent context explosion
- Supports faceted filtering (dates, projects, file types)
- Provides relevance scoring for search results

## Installation

```bash
npm install
npm run build
```

## Configuration

The server is configured to search:
- **Conversation History**: `~/Library/Application Support/Memex/history/`
- **Project Files**: `~/Workspace/`

## Usage Examples

### Search Conversations
```typescript
// Find conversations about 3D modeling
search_conversations({
  query: "3D model",
  limit: 5,
  date_from: "2025-01-01"
})

// Find conversations in specific project
search_conversations({
  query: "python",
  project: "cad_example",
  limit: 3
})
```

### Get Conversation Details
```typescript
// Get specific messages from a conversation
get_conversation_snippet({
  conversation_id: "bf283daa-25d3-434f-ad7e-9adda48cdcdd",
  message_start: 1,
  message_count: 5
})
```

### Search Projects
```typescript
// Find TypeScript files
search_projects({
  query: "interface",
  file_types: ["ts", "js"],
  limit: 10
})

// Search all project files
search_projects({
  query: "streamlit",
  limit: 5
})
```

### Get Project Overview
```typescript
// Analyze project structure and tech stack
get_project_overview({
  project_name: "memex_targeted_search_server"
})
```

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

---

🤖 Generated with [Memex](https://memex.tech)
Co-Authored-By: Memex <noreply@memex.tech>