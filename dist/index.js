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
                    case "find_command":
                        return await this.findCommand(args);
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
                    // Enhanced matching with multiple strategies
                    const title = data.title || '';
                    const summary = data.summary || '';
                    const queryLower = query.toLowerCase();
                    const queryTerms = query.split(/\s+/).filter((term) => term.length > 2);
                    let relevance = '';
                    let matches = false;
                    let confidence = 0;
                    // Check title match
                    if (this.smartMatch(title.toLowerCase(), queryLower, queryTerms)) {
                        relevance = 'title';
                        matches = true;
                        confidence = 0.9;
                    }
                    // Check summary match
                    else if (this.smartMatch(summary.toLowerCase(), queryLower, queryTerms)) {
                        relevance = 'summary';
                        matches = true;
                        confidence = 0.8;
                    }
                    // Check content match with better algorithm
                    else {
                        const messages = data.messages || [];
                        let bestMatchConfidence = 0;
                        for (let i = 0; i < Math.min(messages.length, 10); i++) {
                            const content = messages[i].content || '';
                            const contentLower = content.toLowerCase();
                            if (this.smartMatch(contentLower, queryLower, queryTerms)) {
                                const messageConfidence = this.calculateMessageConfidence(content, query);
                                if (messageConfidence > bestMatchConfidence) {
                                    bestMatchConfidence = messageConfidence;
                                    relevance = `content (message ${i})`;
                                    matches = true;
                                    confidence = messageConfidence;
                                }
                            }
                        }
                    }
                    if (matches) {
                        results.push({
                            title,
                            summary,
                            metadata: data.metadata,
                            filePath: file,
                            relevance: `${relevance} (confidence: ${confidence.toFixed(2)})`
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
    async findCommand(args) {
        const { query, command_type = "any", limit = 5 } = args;
        try {
            const results = [];
            // Get all conversation files
            const files = await fs.promises.readdir(MEMEX_HISTORY_PATH);
            const jsonFiles = files.filter(f => f.endsWith('.json'));
            for (const file of jsonFiles.slice(0, 20)) { // Limit files to search for debugging
                try {
                    const filePath = path.join(MEMEX_HISTORY_PATH, file);
                    const content = await fs.promises.readFile(filePath, 'utf-8');
                    const data = JSON.parse(content);
                    const messages = data.messages || [];
                    for (let i = 0; i < messages.length; i++) {
                        const message = messages[i];
                        if (!message.content)
                            continue;
                        // Simple backtick command extraction for debugging
                        const content = message.content;
                        const backtickMatches = content.match(/`([^`]+)`/g);
                        if (backtickMatches) {
                            for (const match of backtickMatches) {
                                const command = match.slice(1, -1); // Remove backticks
                                const commandLower = command.toLowerCase();
                                const queryLower = query.toLowerCase();
                                // Check if command contains query terms
                                if (commandLower.includes(queryLower) || queryLower.split(/\s+/).some((term) => commandLower.includes(term))) {
                                    let confidence = 0.8;
                                    // Boost for exact match
                                    if (commandLower.includes(queryLower)) {
                                        confidence += 0.1;
                                    }
                                    results.push({
                                        command: command,
                                        context: this.getContextAround(content.split('\n'), 0, 2),
                                        conversation_id: data.metadata?.conversation_id || '',
                                        conversation_title: data.title || '',
                                        message_index: i,
                                        confidence: confidence,
                                        type: 'cli'
                                    });
                                }
                            }
                        }
                    }
                    if (results.length >= limit * 3)
                        break; // Get more than needed for sorting
                }
                catch (error) {
                    continue; // Skip files that can't be parsed
                }
            }
            // Sort by confidence and take top results
            const sortedResults = results
                .sort((a, b) => b.confidence - a.confidence)
                .slice(0, limit);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            query,
                            total_found: sortedResults.length,
                            commands: sortedResults,
                            debug: `Searched ${jsonFiles.slice(0, 20).length} files`
                        }, null, 2)
                    }
                ]
            };
        }
        catch (error) {
            throw new Error(`Failed to find commands: ${error}`);
        }
    }
    extractCommands(content, query, commandType) {
        const commands = [];
        const lines = content.split('\n');
        const queryLower = query.toLowerCase();
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineLower = line.toLowerCase();
            // More permissive matching - if line contains any query term OR has command patterns
            const hasQueryTerm = queryLower.split(/\s+/).some((term) => lineLower.includes(term));
            const hasCommandPattern = this.hasCommandPatterns(line);
            if (!hasQueryTerm && !hasCommandPattern)
                continue;
            // Extract different types of commands
            const cliCommands = this.extractCliCommands(line, queryLower);
            const codeCommands = this.extractCodeCommands(line, queryLower);
            const configCommands = this.extractConfigCommands(line, queryLower);
            // Add commands based on type filter
            if (commandType === "any" || commandType === "cli") {
                commands.push(...cliCommands.map(cmd => ({
                    ...cmd,
                    context: this.getContextAround(lines, i, 2),
                    type: 'cli'
                })));
            }
            if (commandType === "any" || commandType === "code") {
                commands.push(...codeCommands.map(cmd => ({
                    ...cmd,
                    context: this.getContextAround(lines, i, 2),
                    type: 'code'
                })));
            }
            if (commandType === "any" || commandType === "config") {
                commands.push(...configCommands.map(cmd => ({
                    ...cmd,
                    context: this.getContextAround(lines, i, 2),
                    type: 'config'
                })));
            }
        }
        return commands;
    }
    containsQueryTerms(text, query) {
        const queryTerms = query.split(/\s+/).filter((term) => term.length > 2);
        return queryTerms.some((term) => text.includes(term));
    }
    extractCliCommands(line, query) {
        const commands = [];
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
    extractCodeCommands(line, query) {
        const commands = [];
        // Code patterns (function calls, imports, etc.)
        const codePatterns = [
            /import\s+.+from\s+['"`](.+)['"`]/i, // imports
            /require\(['"`](.+)['"`]\)/i, // requires
            /(\w+\.\w+\([^)]*\))/g, // method calls
            /new\s+(\w+)/i, // constructors
            /class\s+(\w+)/i, // class definitions
            /function\s+(\w+)/i, // function definitions
            /const\s+(\w+)\s*=/i, // const declarations
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
    extractConfigCommands(line, query) {
        const commands = [];
        // Configuration patterns
        const configPatterns = [
            /["']([^"']*(?:config|setting|option)[^"']*)["']/i, // config strings
            /(\w+):\s*(.+)/, // key: value pairs
            /--(\w+(?:-\w+)*)/g, // command line flags
            /-(\w)/g, // short flags
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
    getContextAround(lines, lineIndex, contextLines) {
        const start = Math.max(0, lineIndex - contextLines);
        const end = Math.min(lines.length, lineIndex + contextLines + 1);
        return lines.slice(start, end).join('\n').trim();
    }
    smartMatch(text, query, queryTerms) {
        // Direct match
        if (text.includes(query))
            return true;
        // Fuzzy term matching - all terms must be present
        const requiredTerms = queryTerms.filter((term) => term.length > 2);
        const foundTerms = requiredTerms.filter((term) => text.includes(term));
        // Require at least 80% of terms to match
        return foundTerms.length >= Math.ceil(requiredTerms.length * 0.8);
    }
    calculateMessageConfidence(content, query) {
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
    hasCommandPatterns(content) {
        const commandPatterns = [
            /\$\s+\w+/, // $ command
            /npm\s+\w+/i, // npm commands
            /git\s+\w+/i, // git commands
            /python\s+\w+/i, // python commands
            /node\s+\w+/i, // node commands
            /--\w+/, // command flags
        ];
        return commandPatterns.some(pattern => pattern.test(content));
    }
    hasCLIPatterns(content) {
        const cliPatterns = [
            /^\s*\$\s+/m, // $ prefix
            /^\s*>\s+/m, // > prefix
            /^\s*#\s+/m, // # prefix
            /terminal|command|cli|shell/i,
        ];
        return cliPatterns.some(pattern => pattern.test(content));
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