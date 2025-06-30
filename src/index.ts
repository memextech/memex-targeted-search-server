#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { SearchIndex } from "./SearchIndex.js";

const execAsync = promisify(exec);

// Configuration
const MEMEX_HISTORY_PATH = path.join(process.env.HOME!, "Library", "Application Support", "Memex", "history");
const WORKSPACE_PATH = path.join(process.env.HOME!, "Workspace");

interface ConversationMetadata {
  title: string;
  summary: string;
  metadata: {
    conversation_id: string;
    created_at: string;
    updated_at: string;
    model: string;
    project?: string;
    user_turn_count: number;
    assistant_turn_count: number;
  };
  filePath: string;
}

interface ConversationMessage {
  role: string;
  content: string;
}

interface ConversationData extends ConversationMetadata {
  messages: ConversationMessage[];
}

interface CommandMatch {
  command: string;
  context: string;
  conversation_id: string;
  conversation_title: string;
  message_index: number;
  confidence: number;
  type: 'cli' | 'code' | 'config';
}

class MemexSearchServer {
  private server: Server;
  private searchIndex: SearchIndex;

  constructor() {
    this.server = new Server(
      {
        name: "memex-search-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.searchIndex = new SearchIndex();
    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "search_conversations",
            description: "Search through Memex conversation history by text content, title, or metadata",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search query to match against conversation content, title, or summary"
                },
                limit: {
                  type: "number",
                  description: "Maximum number of results to return (default: 10)",
                  default: 10
                },
                project: {
                  type: "string",
                  description: "Filter by project name (optional)"
                },
                date_from: {
                  type: "string",
                  description: "Filter conversations from this date (YYYY-MM-DD format, optional)"
                },
                date_to: {
                  type: "string",
                  description: "Filter conversations to this date (YYYY-MM-DD format, optional)"
                }
              },
              required: ["query"]
            }
          },
          {
            name: "get_conversation_snippet",
            description: "Get specific parts of a conversation by conversation ID",
            inputSchema: {
              type: "object",
              properties: {
                conversation_id: {
                  type: "string",
                  description: "The conversation ID to retrieve"
                },
                message_start: {
                  type: "number",
                  description: "Starting message index (default: 0)",
                  default: 0
                },
                message_count: {
                  type: "number",
                  description: "Number of messages to retrieve (default: 10)",
                  default: 10
                }
              },
              required: ["conversation_id"]
            }
          },
          {
            name: "search_projects",
            description: "Search through project files in the workspace",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search query to match against file content or names"
                },
                file_types: {
                  type: "array",
                  items: { type: "string" },
                  description: "File extensions to search (e.g., ['js', 'py', 'md']). If empty, searches all files."
                },
                limit: {
                  type: "number",
                  description: "Maximum number of results to return (default: 10)",
                  default: 10
                }
              },
              required: ["query"]
            }
          },
          {
            name: "get_project_overview",
            description: "Get an overview of a specific project directory",
            inputSchema: {
              type: "object",
              properties: {
                project_name: {
                  type: "string",
                  description: "Name of the project directory to analyze"
                }
              },
              required: ["project_name"]
            }
          },
          {
            name: "find_command",
            description: "Find specific commands, CLI usage, or code snippets from conversation history",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search for specific commands (e.g. 'memex agent cli', 'npm install', 'git commit')"
                },
                command_type: {
                  type: "string",
                  enum: ["cli", "code", "config", "any"],
                  description: "Type of command to search for (default: any)",
                  default: "any"
                },
                limit: {
                  type: "number",
                  description: "Maximum number of results to return (default: 5)",
                  default: 5
                }
              },
              required: ["query"]
            }
          },
          {
            name: "build_search_index",
            description: "Build or rebuild the search index for better performance",
            inputSchema: {
              type: "object",
              properties: {},
              required: []
            }
          },
          {
            name: "get_search_stats",
            description: "Get statistics about the search index",
            inputSchema: {
              type: "object",
              properties: {},
              required: []
            }
          }
        ] satisfies Tool[]
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "search_conversations":
            return await this.searchConversations(args);
          case "get_conversation_snippet":
            return await this.getConversationSnippet(args);
          case "search_projects":
            return await this.searchProjects(args);
          case "get_project_overview":
            return await this.getProjectOverview(args);
          case "find_command":
            return await this.findCommand(args);
          case "build_search_index":
            return await this.buildSearchIndex(args);
          case "get_search_stats":
            return await this.getSearchStats(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    });
  }

  private async searchConversations(args: any) {
    const { query, limit = 10, project, date_from, date_to } = args;
    
    try {
      // Try to use indexed search first
      try {
        const results = await this.searchIndex.searchConversations(query, {
          project,
          dateFrom: date_from,
          dateTo: date_to,
          limit
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                total_found: results.length,
                search_method: "indexed",
                conversations: results.map(r => {
                  const item = r.item as any; // Type assertion for now
                  return {
                    conversation_id: item.conversation_id,
                    title: item.title,
                    summary: item.summary,
                    created_at: item.created_at,
                    project: item.project,
                    message_count: item.message_count,
                    relevance: `indexed search (score: ${r.score.toFixed(2)})`,
                    file: item.file_path
                  };
                })
              }, null, 2)
            }
          ]
        };
      } catch (indexError) {
        // Fall back to original search method
        return await this.fallbackSearchConversations(args);
      }
    } catch (error) {
      throw new Error(`Failed to search conversations: ${error}`);
    }
  }

  private async fallbackSearchConversations(args: any) {
    const { query, limit = 10, project, date_from, date_to } = args;
    
    // Original implementation as fallback
    const files = await fs.promises.readdir(MEMEX_HISTORY_PATH);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    const results: Array<ConversationMetadata & { relevance: string }> = [];
    
    for (const file of jsonFiles.slice(0, 50)) { // Limit for fallback
      try {
        const filePath = path.join(MEMEX_HISTORY_PATH, file);
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        
        // Apply filters
        if (project && data.metadata?.project !== project) continue;
        
        if (date_from || date_to) {
          const createdAt = new Date(data.metadata?.created_at);
          if (date_from && createdAt < new Date(date_from)) continue;
          if (date_to && createdAt > new Date(date_to)) continue;
        }
        
        // Simple search for fallback
        const title = data.title || '';
        const summary = data.summary || '';
        const queryLower = query.toLowerCase();
        
        if (title.toLowerCase().includes(queryLower) || 
            summary.toLowerCase().includes(queryLower)) {
          results.push({
            title,
            summary,
            metadata: data.metadata,
            filePath: file,
            relevance: "fallback search"
          });
        }
        
        if (results.length >= limit) break;
      } catch (error) {
        continue;
      }
    }
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            total_found: results.length,
            search_method: "fallback",
            conversations: results.map(r => ({
              conversation_id: r.metadata.conversation_id,
              title: r.title,
              summary: r.summary,
              created_at: r.metadata.created_at,
              project: r.metadata.project,
              message_count: (r.metadata.user_turn_count || 0) + (r.metadata.assistant_turn_count || 0),
              relevance: r.relevance,
              file: r.filePath
            }))
          }, null, 2)
        }
      ]
    };
  }

  private async getConversationSnippet(args: any) {
    const { conversation_id, message_start = 0, message_count = 10 } = args;
    
    try {
      // Find the conversation file
      const files = await fs.promises.readdir(MEMEX_HISTORY_PATH);
      let targetFile = null;
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(MEMEX_HISTORY_PATH, file);
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const data = JSON.parse(content);
          
          if (data.metadata?.conversation_id === conversation_id) {
            targetFile = data;
            break;
          }
        }
      }
      
      if (!targetFile) {
        throw new Error(`Conversation ${conversation_id} not found`);
      }
      
      const messages = targetFile.messages || [];
      const snippet = messages.slice(message_start, message_start + message_count);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              conversation_id,
              title: targetFile.title,
              message_range: `${message_start}-${message_start + snippet.length - 1}`,
              total_messages: messages.length,
              messages: snippet.map((msg: any, idx: number) => ({
                index: message_start + idx,
                role: msg.role,
                content: msg.content?.substring(0, 500) + (msg.content?.length > 500 ? '...' : '')
              }))
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to get conversation snippet: ${error}`);
    }
  }

  private async searchProjects(args: any) {
    const { query, file_types = [], limit = 10 } = args;
    
    try {
      const queryLower = query.toLowerCase();
      const results: Array<{ project: string; file: string; match: string; line?: number }> = [];
      
      // Get all project directories
      const projects = await fs.promises.readdir(WORKSPACE_PATH);
      
      for (const project of projects.slice(0, 20)) { // Limit projects to search
        const projectPath = path.join(WORKSPACE_PATH, project);
        
        try {
          const stat = await fs.promises.stat(projectPath);
          if (!stat.isDirectory()) continue;
          
          // Search files in project
          await this.searchInProject(projectPath, project, queryLower, file_types, results, limit);
          
          if (results.length >= limit) break;
        } catch (error) {
          continue; // Skip inaccessible projects
        }
      }
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              total_found: results.length,
              results: results.slice(0, limit)
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to search projects: ${error}`);
    }
  }

  private async searchInProject(
    projectPath: string,
    projectName: string,
    query: string,
    fileTypes: string[],
    results: Array<{ project: string; file: string; match: string; line?: number }>,
    limit: number
  ) {
    try {
      const files = await fs.promises.readdir(projectPath);
      
      for (const file of files) {
        if (results.length >= limit) break;
        
        const filePath = path.join(projectPath, file);
        const stat = await fs.promises.stat(filePath);
        
        if (stat.isDirectory() && file !== 'node_modules' && file !== '.git') {
          // Recursively search subdirectories (limited depth)
          await this.searchInProject(filePath, projectName, query, fileTypes, results, limit);
        } else if (stat.isFile()) {
          const ext = path.extname(file).substring(1);
          
          // Filter by file types if specified
          if (fileTypes.length > 0 && !fileTypes.includes(ext)) continue;
          
          // Check filename match
          if (file.toLowerCase().includes(query)) {
            results.push({
              project: projectName,
              file: path.relative(path.join(process.env.HOME!, 'Workspace'), filePath),
              match: `filename: ${file}`
            });
            continue;
          }
          
          // Check content for text files
          if (this.isTextFile(ext)) {
            try {
              const content = await fs.promises.readFile(filePath, 'utf-8');
              const lines = content.split('\n');
              
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(query)) {
                  results.push({
                    project: projectName,
                    file: path.relative(path.join(process.env.HOME!, 'Workspace'), filePath),
                    match: lines[i].trim().substring(0, 200),
                    line: i + 1
                  });
                  break; // Only first match per file
                }
              }
            } catch (error) {
              // Skip files that can't be read
            }
          }
        }
      }
    } catch (error) {
      // Skip directories that can't be read
    }
  }

  private isTextFile(ext: string): boolean {
    const textExtensions = ['js', 'ts', 'py', 'java', 'cpp', 'c', 'h', 'css', 'html', 'xml', 'json', 'md', 'txt', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'sh', 'rb', 'php', 'go', 'rs', 'swift', 'kt'];
    return textExtensions.includes(ext.toLowerCase());
  }

  private async getProjectOverview(args: any) {
    const { project_name } = args;
    const projectPath = path.join(WORKSPACE_PATH, project_name);
    
    try {
      const stat = await fs.promises.stat(projectPath);
      if (!stat.isDirectory()) {
        throw new Error(`${project_name} is not a directory`);
      }
      
      const overview = await this.analyzeProject(projectPath);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(overview, null, 2)
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to get project overview: ${error}`);
    }
  }

  private async analyzeProject(projectPath: string): Promise<any> {
    const analysis = {
      name: path.basename(projectPath),
      path: projectPath,
      file_count: 0,
      directories: [] as string[],
      file_types: {} as Record<string, number>,
      main_files: [] as string[],
      technologies: [] as string[]
    };
    
    try {
      const files = await fs.promises.readdir(projectPath);
      
      for (const file of files) {
        const filePath = path.join(projectPath, file);
        const stat = await fs.promises.stat(filePath);
        
        if (stat.isDirectory() && file !== 'node_modules' && file !== '.git') {
          analysis.directories.push(file);
        } else if (stat.isFile()) {
          analysis.file_count++;
          
          const ext = path.extname(file).substring(1);
          if (ext) {
            analysis.file_types[ext] = (analysis.file_types[ext] || 0) + 1;
          }
          
          // Identify main files
          const mainFiles = ['package.json', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pom.xml', 'README.md', 'main.py', 'index.js', 'index.ts', 'app.py'];
          if (mainFiles.includes(file)) {
            analysis.main_files.push(file);
          }
        }
      }
      
      // Detect technologies
      if (analysis.file_types['js'] || analysis.file_types['ts'] || analysis.main_files.includes('package.json')) {
        analysis.technologies.push('JavaScript/TypeScript');
      }
      if (analysis.file_types['py'] || analysis.main_files.includes('requirements.txt')) {
        analysis.technologies.push('Python');
      }
      if (analysis.file_types['rs'] || analysis.main_files.includes('Cargo.toml')) {
        analysis.technologies.push('Rust');
      }
      if (analysis.file_types['go'] || analysis.main_files.includes('go.mod')) {
        analysis.technologies.push('Go');
      }
      if (analysis.file_types['java'] || analysis.main_files.includes('pom.xml')) {
        analysis.technologies.push('Java');
      }
      
    } catch (error) {
      throw new Error(`Failed to analyze project: ${error}`);
    }
    
    return analysis;
  }

  private async findCommand(args: any) {
    const { query, command_type = "any", limit = 5 } = args;
    
    try {
      // Try indexed search first
      try {
        const results = await this.searchIndex.searchCommands(query, {
          commandType: command_type,
          limit
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                query,
                total_found: results.length,
                search_method: "indexed",
                commands: results.map(r => {
                  const item = r.item as any; // Type assertion for now
                  return {
                    command: item.command,
                    context: item.context,
                    conversation_id: item.conversation_id,
                    conversation_title: `Message ${item.message_index}`,
                    message_index: item.message_index,
                    confidence: item.confidence,
                    type: item.command_type,
                    search_score: r.score
                  };
                })
              }, null, 2)
            }
          ]
        };
      } catch (indexError) {
        // Fall back to original method
        return await this.fallbackFindCommand(args);
      }
    } catch (error) {
      throw new Error(`Failed to find commands: ${error}`);
    }
  }

  private async fallbackFindCommand(args: any) {
    const { query, command_type = "any", limit = 5 } = args;
    
    const results: CommandMatch[] = [];
    
    // Simplified fallback implementation
    const files = await fs.promises.readdir(MEMEX_HISTORY_PATH);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    for (const file of jsonFiles.slice(0, 10)) {
      try {
        const filePath = path.join(MEMEX_HISTORY_PATH, file);
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        
        const messages = data.messages || [];
        for (let i = 0; i < messages.length; i++) {
          const message = messages[i];
          if (!message.content) continue;
          
          const backtickMatches = message.content.match(/`([^`]+)`/g);
          if (backtickMatches) {
            for (const match of backtickMatches) {
              const command = match.slice(1, -1);
              const commandLower = command.toLowerCase();
              const queryLower = query.toLowerCase();
              
              if (commandLower.includes(queryLower)) {
                results.push({
                  command: command,
                  context: this.getContextAround(message.content.split('\n'), 0, 1),
                  conversation_id: data.metadata?.conversation_id || '',
                  conversation_title: data.title || '',
                  message_index: i,
                  confidence: 0.8,
                  type: 'cli'
                });
              }
            }
          }
          
          if (results.length >= limit) break;
        }
        if (results.length >= limit) break;
      } catch (error) {
        continue;
      }
    }
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            query,
            total_found: results.length,
            search_method: "fallback",
            commands: results.slice(0, limit)
          }, null, 2)
        }
      ]
    };
  }

  private extractCommands(content: string, query: string, commandType: string): Array<{command: string, context: string, confidence: number, type: 'cli' | 'code' | 'config'}> {
    const commands: Array<{command: string, context: string, confidence: number, type: 'cli' | 'code' | 'config'}> = [];
    const lines = content.split('\n');
    const queryLower = query.toLowerCase();
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineLower = line.toLowerCase();
      
      // More permissive matching - if line contains any query term OR has command patterns
      const hasQueryTerm = queryLower.split(/\s+/).some((term: string) => lineLower.includes(term));
      const hasCommandPattern = this.hasCommandPatterns(line);
      
      if (!hasQueryTerm && !hasCommandPattern) continue;
      
      // Extract different types of commands
      const cliCommands = this.extractCliCommands(line, queryLower);
      const codeCommands = this.extractCodeCommands(line, queryLower);
      const configCommands = this.extractConfigCommands(line, queryLower);
      
      // Add commands based on type filter
      if (commandType === "any" || commandType === "cli") {
        commands.push(...cliCommands.map(cmd => ({
          ...cmd,
          context: this.getContextAround(lines, i, 2),
          type: 'cli' as const
        })));
      }
      
      if (commandType === "any" || commandType === "code") {
        commands.push(...codeCommands.map(cmd => ({
          ...cmd,
          context: this.getContextAround(lines, i, 2),
          type: 'code' as const
        })));
      }
      
      if (commandType === "any" || commandType === "config") {
        commands.push(...configCommands.map(cmd => ({
          ...cmd,
          context: this.getContextAround(lines, i, 2),
          type: 'config' as const
        })));
      }
    }
    
    return commands;
  }

  private containsQueryTerms(text: string, query: string): boolean {
    const queryTerms = query.split(/\s+/).filter((term: string) => term.length > 2);
    return queryTerms.some((term: string) => text.includes(term));
  }

  private extractCliCommands(line: string, query: string): Array<{command: string, confidence: number}> {
    const commands: Array<{command: string, confidence: number}> = [];
    
    // Simple but effective patterns
    const patterns = [
      // Backtick commands (most reliable)
      { regex: /`([^`]+)`/g, confidence: 0.9 },
      // Commands with $ prefix
      { regex: /\$\s*([^\n\r]+)/g, confidence: 0.8 },
      // npm/yarn commands
      { regex: /(npm|yarn|pnpm)\s+([^\s\n]+(?:\s+[^\s\n]+)*)/gi, confidence: 0.7 },
      // git commands
      { regex: /(git)\s+([^\s\n]+(?:\s+[^\s\n]+)*)/gi, confidence: 0.7 },
      // firebase commands
      { regex: /(firebase)\s+([^\s\n]+(?:\s+[^\s\n]+)*)/gi, confidence: 0.7 },
      // memex commands
      { regex: /(memex)\s+([^\s\n]+(?:\s+[^\s\n]+)*)/gi, confidence: 0.8 },
    ];
    
    for (const { regex, confidence: baseConfidence } of patterns) {
      const matches = Array.from(line.matchAll(regex));
      for (const match of matches) {
        let command = match[1];
        if (match[2]) {
          command = `${match[1]} ${match[2]}`;
        }
        
        let confidence = baseConfidence;
        
        // Boost confidence if query terms match
        const commandLower = command.toLowerCase();
        const queryTerms = query.split(/\s+/);
        
        for (const term of queryTerms) {
          if (commandLower.includes(term)) {
            confidence += 0.1;
          }
        }
        
        commands.push({
          command: command.trim(),
          confidence: Math.min(confidence, 1.0)
        });
      }
    }
    
    return commands;
  }

  private extractCodeCommands(line: string, query: string): Array<{command: string, confidence: number}> {
    const commands: Array<{command: string, confidence: number}> = [];
    
    // Code patterns (function calls, imports, etc.)
    const codePatterns = [
      /import\s+.+from\s+['"`](.+)['"`]/i,  // imports
      /require\(['"`](.+)['"`]\)/i,         // requires
      /(\w+\.\w+\([^)]*\))/g,               // method calls
      /new\s+(\w+)/i,                       // constructors
      /class\s+(\w+)/i,                     // class definitions
      /function\s+(\w+)/i,                  // function definitions
      /const\s+(\w+)\s*=/i,                 // const declarations
    ];
    
    for (const pattern of codePatterns) {
      const matches = line.matchAll(new RegExp(pattern.source, pattern.flags));
      for (const match of matches) {
        const command = match[1] || match[0];
        let confidence = 0.5;
        
        const commandLower = command.toLowerCase();
        const queryTerms = query.split(/\s+/);
        
        for (const term of queryTerms) {
          if (commandLower.includes(term)) {
            confidence += 0.15;
          }
        }
        
        commands.push({
          command: command.trim(),
          confidence: Math.min(confidence, 1.0)
        });
      }
    }
    
    return commands;
  }

  private extractConfigCommands(line: string, query: string): Array<{command: string, confidence: number}> {
    const commands: Array<{command: string, confidence: number}> = [];
    
    // Configuration patterns
    const configPatterns = [
      /["']([^"']*(?:config|setting|option)[^"']*)["']/i,  // config strings
      /(\w+):\s*(.+)/,                                     // key: value pairs
      /--(\w+(?:-\w+)*)/g,                                 // command line flags
      /-(\w)/g,                                            // short flags
    ];
    
    for (const pattern of configPatterns) {
      const matches = line.matchAll(new RegExp(pattern.source, pattern.flags));
      for (const match of matches) {
        const command = match[1] || match[0];
        let confidence = 0.4;
        
        const commandLower = command.toLowerCase();
        const queryTerms = query.split(/\s+/);
        
        for (const term of queryTerms) {
          if (commandLower.includes(term)) {
            confidence += 0.1;
          }
        }
        
        commands.push({
          command: command.trim(),
          confidence: Math.min(confidence, 1.0)
        });
      }
    }
    
    return commands;
  }

  private getContextAround(lines: string[], lineIndex: number, contextLines: number): string {
    const start = Math.max(0, lineIndex - contextLines);
    const end = Math.min(lines.length, lineIndex + contextLines + 1);
    return lines.slice(start, end).join('\n').trim();
  }

  private smartMatch(text: string, query: string, queryTerms: string[]): boolean {
    // Direct match
    if (text.includes(query)) return true;
    
    // Fuzzy term matching - all terms must be present
    const requiredTerms = queryTerms.filter((term: string) => term.length > 2);
    const foundTerms = requiredTerms.filter((term: string) => text.includes(term));
    
    // Require at least 80% of terms to match
    return foundTerms.length >= Math.ceil(requiredTerms.length * 0.8);
  }

  private calculateMessageConfidence(content: string, query: string): number {
    const contentLower = content.toLowerCase();
    const queryLower = query.toLowerCase();
    let confidence = 0.3;
    
    // Boost for exact query match
    if (contentLower.includes(queryLower)) {
      confidence += 0.4;
    }
    
    // Boost for command patterns
    if (this.hasCommandPatterns(content)) {
      confidence += 0.2;
    }
    
    // Boost for memex-related content
    if (contentLower.includes('memex')) {
      confidence += 0.1;
    }
    
    // Boost for CLI patterns
    if (this.hasCLIPatterns(content)) {
      confidence += 0.15;
    }
    
    // Boost for code blocks
    if (content.includes('```') || content.includes('`')) {
      confidence += 0.1;
    }
    
    return Math.min(confidence, 1.0);
  }

  private hasCommandPatterns(content: string): boolean {
    const commandPatterns = [
      /\$\s+\w+/,          // $ command
      /npm\s+\w+/i,        // npm commands
      /git\s+\w+/i,        // git commands
      /python\s+\w+/i,     // python commands
      /node\s+\w+/i,       // node commands
      /--\w+/,             // command flags
    ];
    
    return commandPatterns.some(pattern => pattern.test(content));
  }

  private hasCLIPatterns(content: string): boolean {
    const cliPatterns = [
      /^\s*\$\s+/m,        // $ prefix
      /^\s*>\s+/m,         // > prefix
      /^\s*#\s+/m,         // # prefix
      /terminal|command|cli|shell/i,
    ];
    
    return cliPatterns.some(pattern => pattern.test(content));
  }

  private async buildSearchIndex(args: any) {
    try {
      await this.searchIndex.buildIndex(MEMEX_HISTORY_PATH);
      const stats = await this.searchIndex.getStats();
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "success",
              message: "Search index built successfully",
              stats
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to build search index: ${error}`);
    }
  }

  private async getSearchStats(args: any) {
    try {
      const stats = await this.searchIndex.getStats();
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              search_index_stats: stats,
              paths: {
                conversations: MEMEX_HISTORY_PATH,
                projects: WORKSPACE_PATH
              }
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to get search stats: ${error}`);
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Memex Search MCP Server running on stdio");
  }
}

// Run the server
const server = new MemexSearchServer();
server.run().catch(console.error);