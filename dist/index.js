#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
// Configuration
const MEMEX_HISTORY_PATH = path.join(process.env.HOME, "Library", "Application Support", "Memex", "history");
const WORKSPACE_PATH = path.join(process.env.HOME, "Workspace");
class MemexSearchServer {
    server;
    constructor() {
        this.server = new index_js_1.Server({
            name: "memex-search-server",
            version: "1.0.0",
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupToolHandlers();
    }
    setupToolHandlers() {
        // List available tools
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
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
                    }
                ]
            };
        });
        // Handle tool calls
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
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
                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
            }
            catch (error) {
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
    async searchConversations(args) {
        const { query, limit = 10, project, date_from, date_to } = args;
        try {
            // Get all conversation files
            const files = await fs.promises.readdir(MEMEX_HISTORY_PATH);
            const jsonFiles = files.filter(f => f.endsWith('.json'));
            const results = [];
            for (const file of jsonFiles.slice(0, 100)) { // Limit to prevent overwhelming
                try {
                    const filePath = path.join(MEMEX_HISTORY_PATH, file);
                    const content = await fs.promises.readFile(filePath, 'utf-8');
                    const data = JSON.parse(content);
                    // Apply filters
                    if (project && data.metadata?.project !== project)
                        continue;
                    if (date_from || date_to) {
                        const createdAt = new Date(data.metadata?.created_at);
                        if (date_from && createdAt < new Date(date_from))
                            continue;
                        if (date_to && createdAt > new Date(date_to))
                            continue;
                    }
                    // Check if query matches
                    const title = data.title || '';
                    const summary = data.summary || '';
                    const queryLower = query.toLowerCase();
                    let relevance = '';
                    let matches = false;
                    if (title.toLowerCase().includes(queryLower)) {
                        relevance = 'title';
                        matches = true;
                    }
                    else if (summary.toLowerCase().includes(queryLower)) {
                        relevance = 'summary';
                        matches = true;
                    }
                    else {
                        // Check first few messages for content match
                        const messages = data.messages || [];
                        for (let i = 0; i < Math.min(messages.length, 5); i++) {
                            if (messages[i].content?.toLowerCase().includes(queryLower)) {
                                relevance = 'content';
                                matches = true;
                                break;
                            }
                        }
                    }
                    if (matches) {
                        results.push({
                            title,
                            summary,
                            metadata: data.metadata,
                            filePath: file,
                            relevance
                        });
                    }
                    if (results.length >= limit)
                        break;
                }
                catch (error) {
                    // Skip files that can't be parsed
                    continue;
                }
            }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            total_found: results.length,
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
        catch (error) {
            throw new Error(`Failed to search conversations: ${error}`);
        }
    }
    async getConversationSnippet(args) {
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
                            messages: snippet.map((msg, idx) => ({
                                index: message_start + idx,
                                role: msg.role,
                                content: msg.content?.substring(0, 500) + (msg.content?.length > 500 ? '...' : '')
                            }))
                        }, null, 2)
                    }
                ]
            };
        }
        catch (error) {
            throw new Error(`Failed to get conversation snippet: ${error}`);
        }
    }
    async searchProjects(args) {
        const { query, file_types = [], limit = 10 } = args;
        try {
            const queryLower = query.toLowerCase();
            const results = [];
            // Get all project directories
            const projects = await fs.promises.readdir(WORKSPACE_PATH);
            for (const project of projects.slice(0, 20)) { // Limit projects to search
                const projectPath = path.join(WORKSPACE_PATH, project);
                try {
                    const stat = await fs.promises.stat(projectPath);
                    if (!stat.isDirectory())
                        continue;
                    // Search files in project
                    await this.searchInProject(projectPath, project, queryLower, file_types, results, limit);
                    if (results.length >= limit)
                        break;
                }
                catch (error) {
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
        }
        catch (error) {
            throw new Error(`Failed to search projects: ${error}`);
        }
    }
    async searchInProject(projectPath, projectName, query, fileTypes, results, limit) {
        try {
            const files = await fs.promises.readdir(projectPath);
            for (const file of files) {
                if (results.length >= limit)
                    break;
                const filePath = path.join(projectPath, file);
                const stat = await fs.promises.stat(filePath);
                if (stat.isDirectory() && file !== 'node_modules' && file !== '.git') {
                    // Recursively search subdirectories (limited depth)
                    await this.searchInProject(filePath, projectName, query, fileTypes, results, limit);
                }
                else if (stat.isFile()) {
                    const ext = path.extname(file).substring(1);
                    // Filter by file types if specified
                    if (fileTypes.length > 0 && !fileTypes.includes(ext))
                        continue;
                    // Check filename match
                    if (file.toLowerCase().includes(query)) {
                        results.push({
                            project: projectName,
                            file: path.relative(path.join(process.env.HOME, 'Workspace'), filePath),
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
                                        file: path.relative(path.join(process.env.HOME, 'Workspace'), filePath),
                                        match: lines[i].trim().substring(0, 200),
                                        line: i + 1
                                    });
                                    break; // Only first match per file
                                }
                            }
                        }
                        catch (error) {
                            // Skip files that can't be read
                        }
                    }
                }
            }
        }
        catch (error) {
            // Skip directories that can't be read
        }
    }
    isTextFile(ext) {
        const textExtensions = ['js', 'ts', 'py', 'java', 'cpp', 'c', 'h', 'css', 'html', 'xml', 'json', 'md', 'txt', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'sh', 'rb', 'php', 'go', 'rs', 'swift', 'kt'];
        return textExtensions.includes(ext.toLowerCase());
    }
    async getProjectOverview(args) {
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
        }
        catch (error) {
            throw new Error(`Failed to get project overview: ${error}`);
        }
    }
    async analyzeProject(projectPath) {
        const analysis = {
            name: path.basename(projectPath),
            path: projectPath,
            file_count: 0,
            directories: [],
            file_types: {},
            main_files: [],
            technologies: []
        };
        try {
            const files = await fs.promises.readdir(projectPath);
            for (const file of files) {
                const filePath = path.join(projectPath, file);
                const stat = await fs.promises.stat(filePath);
                if (stat.isDirectory() && file !== 'node_modules' && file !== '.git') {
                    analysis.directories.push(file);
                }
                else if (stat.isFile()) {
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
        }
        catch (error) {
            throw new Error(`Failed to analyze project: ${error}`);
        }
        return analysis;
    }
    async run() {
        const transport = new stdio_js_1.StdioServerTransport();
        await this.server.connect(transport);
        console.error("Memex Search MCP Server running on stdio");
    }
}
// Run the server
const server = new MemexSearchServer();
server.run().catch(console.error);
//# sourceMappingURL=index.js.map