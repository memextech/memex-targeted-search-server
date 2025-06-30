import * as fs from "fs";
import * as path from "path";
import Database from "sqlite3";
import Fuse from "fuse.js";

export interface IndexedConversation {
  id: string;
  conversation_id: string;
  title: string;
  summary: string;
  created_at: string;
  project?: string;
  file_path: string;
  message_count: number;
}

export interface IndexedMessage {
  id: string;
  conversation_id: string;
  message_index: number;
  role: string;
  content: string;
  content_type: 'text' | 'code' | 'command';
  tokens?: string[];
}

export interface IndexedCommand {
  id: string;
  conversation_id: string;
  message_index: number;
  command: string;
  command_type: 'cli' | 'code' | 'config';
  context: string;
  confidence: number;
}

export interface SearchResult {
  type: 'conversation' | 'message' | 'command';
  item: IndexedConversation | IndexedMessage | IndexedCommand;
  score: number;
  highlights?: string[];
}

export class SearchIndex {
  private db: Database.Database;
  private conversationFuse?: Fuse<IndexedConversation>;
  private messageFuse?: Fuse<IndexedMessage>;
  private commandFuse?: Fuse<IndexedCommand>;
  private isInitialized = false;

  constructor(private dbPath: string = ':memory:') {
    this.db = new Database.Database(dbPath);
    this.initializeDatabase();
  }

  private initializeDatabase() {
    // Create tables for full-text search
    this.db.serialize(() => {
      // Conversations table with FTS
      this.db.run(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          conversation_id TEXT UNIQUE,
          title TEXT,
          summary TEXT,
          created_at TEXT,
          project TEXT,
          file_path TEXT,
          message_count INTEGER
        )
      `);

      this.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(
          conversation_id, title, summary, project
        )
      `);

      // Messages table with FTS
      this.db.run(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT,
          message_index INTEGER,
          role TEXT,
          content TEXT,
          content_type TEXT,
          FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id)
        )
      `);

      this.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          conversation_id, content
        )
      `);

      // Commands table with FTS
      this.db.run(`
        CREATE TABLE IF NOT EXISTS commands (
          id TEXT PRIMARY KEY,
          conversation_id TEXT,
          message_index INTEGER,
          command TEXT,
          command_type TEXT,
          context TEXT,
          confidence REAL,
          FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id)
        )
      `);

      this.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS commands_fts USING fts5(
          conversation_id, command, context
        )
      `);

      // Create indexes
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_commands_conversation_id ON commands(conversation_id)`);
    });
  }

  async buildIndex(historyPath: string): Promise<void> {
    console.error("Building search index...");
    
    try {
      // Clear existing data
      await this.clearIndex();
      
      const files = await fs.promises.readdir(historyPath);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      
      let processed = 0;
      const total = jsonFiles.length;

      // Process in batches to avoid memory issues
      const batchSize = 50;
      for (let i = 0; i < jsonFiles.length; i += batchSize) {
        const batch = jsonFiles.slice(i, i + batchSize);
        await this.processBatch(batch, historyPath);
        processed += batch.length;
        console.error(`Indexed ${processed}/${total} conversations`);
      }

      // Build Fuse.js indexes for fuzzy search
      await this.buildFuseIndexes();
      
      this.isInitialized = true;
      console.error("Search index built successfully");
    } catch (error) {
      console.error(`Failed to build index: ${error}`);
      throw error;
    }
  }

  private async clearIndex(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run("DELETE FROM conversations");
        this.db.run("DELETE FROM conversations_fts");
        this.db.run("DELETE FROM messages");
        this.db.run("DELETE FROM messages_fts");
        this.db.run("DELETE FROM commands");
        this.db.run("DELETE FROM commands_fts", (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }

  private async processBatch(files: string[], historyPath: string): Promise<void> {
    const conversations: IndexedConversation[] = [];
    const messages: IndexedMessage[] = [];
    const commands: IndexedCommand[] = [];

    for (const file of files) {
      try {
        const filePath = path.join(historyPath, file);
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);

        // Index conversation
        const conversation: IndexedConversation = {
          id: `conv_${data.metadata?.conversation_id || file}`,
          conversation_id: data.metadata?.conversation_id || file,
          title: data.title || '',
          summary: data.summary || '',
          created_at: data.metadata?.created_at || '',
          project: data.metadata?.project,
          file_path: file,
          message_count: (data.metadata?.user_turn_count || 0) + (data.metadata?.assistant_turn_count || 0)
        };
        conversations.push(conversation);

        // Index messages and extract commands
        if (data.messages) {
          for (let i = 0; i < data.messages.length; i++) {
            const msg = data.messages[i];
            if (!msg.content) continue;

            // Index message
            const message: IndexedMessage = {
              id: `msg_${conversation.conversation_id}_${i}`,
              conversation_id: conversation.conversation_id,
              message_index: i,
              role: msg.role,
              content: msg.content,
              content_type: this.detectContentType(msg.content)
            };
            messages.push(message);

            // Extract and index commands
            const extractedCommands = this.extractCommands(msg.content, conversation.conversation_id, i);
            commands.push(...extractedCommands);
          }
        }
      } catch (error) {
        console.error(`Failed to process file ${file}: ${error}`);
        continue;
      }
    }

    // Insert into database
    await this.insertConversations(conversations);
    await this.insertMessages(messages);
    await this.insertCommands(commands);
  }

  private detectContentType(content: string): 'text' | 'code' | 'command' {
    // Simple heuristics for content type detection
    if (content.includes('```') || content.includes('`')) return 'code';
    if (this.hasCommandPatterns(content)) return 'command';
    return 'text';
  }

  private hasCommandPatterns(content: string): boolean {
    const patterns = [
      /\$\s+\w+/,
      /npm\s+\w+/i,
      /git\s+\w+/i,
      /python\s+\w+/i,
      /node\s+\w+/i,
      /--\w+/,
      /^\s*>\s+/m,
    ];
    return patterns.some(pattern => pattern.test(content));
  }

  private extractCommands(content: string, conversationId: string, messageIndex: number): IndexedCommand[] {
    const commands: IndexedCommand[] = [];
    const lines = content.split('\n');

    // Extract backtick commands
    const backtickMatches = content.match(/`([^`\n]+)`/g);
    if (backtickMatches) {
      for (const match of backtickMatches) {
        const command = match.slice(1, -1).trim();
        // More strict filtering for backticks
        if (command.length > 3 && command.length < 150 && this.looksLikeCommand(command)) {
          commands.push({
            id: `cmd_${conversationId}_${messageIndex}_${commands.length}`,
            conversation_id: conversationId,
            message_index: messageIndex,
            command: command,
            command_type: this.classifyCommand(command),
            context: this.getCommandContext(lines, command),
            confidence: 0.9
          });
        }
      }
    }

    // Extract other command patterns
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const cliCommands = this.extractLineCommands(line);
      for (const cmd of cliCommands) {
        commands.push({
          id: `cmd_${conversationId}_${messageIndex}_${commands.length}`,
          conversation_id: conversationId,
          message_index: messageIndex,
          command: cmd.command,
          command_type: cmd.type,
          context: this.getContextAround(lines, i, 1),
          confidence: cmd.confidence
        });
      }
    }

    return commands;
  }

  private looksLikeCommand(text: string): boolean {
    const trimmed = text.trim();
    
    // Must be reasonably short to be a command
    if (trimmed.length > 200 || trimmed.length < 3) return false;
    
    // Should not contain certain characters that indicate it's not a command
    if (trimmed.includes('{') || trimmed.includes('}') || trimmed.includes('(') || trimmed.includes(')')) {
      // Exception: allow simple parameter syntax like command --flag=value
      if (!trimmed.match(/^[\w\s\-=\.\/]+$/)) return false;
    }
    
    const commandIndicators = [
      /^(npm|yarn|pnpm|git|python|py|node|tsx|docker|curl|wget|cd|ls|mkdir|cp|mv|rm|firebase|memex)\s/i,
      /^\w+\s+--?\w+/,
      /^\$\s+/,
      /^sudo\s+/i,
      /\.sh$|\.py$|\.js$|\.ts$/,
      /^[a-zA-Z0-9_-]+\s+(install|build|start|deploy|login|init|create|run|test)\b/i
    ];
    return commandIndicators.some(pattern => pattern.test(trimmed));
  }

  private classifyCommand(command: string): 'cli' | 'code' | 'config' {
    if (/^(npm|yarn|git|python|node|docker|curl|firebase|memex)/.test(command)) return 'cli';
    if (/--?\w+/.test(command)) return 'config';
    return 'code';
  }

  private extractLineCommands(line: string): Array<{command: string, type: 'cli' | 'code' | 'config', confidence: number}> {
    const commands: Array<{command: string, type: 'cli' | 'code' | 'config', confidence: number}> = [];
    
    // CLI patterns
    const cliPattern = /\$\s*(.+)/;
    const match = line.match(cliPattern);
    if (match) {
      commands.push({
        command: match[1].trim(),
        type: 'cli',
        confidence: 0.9
      });
    }

    return commands;
  }

  private getCommandContext(lines: string[], command: string): string {
    // Find the line containing the command and get context
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(command)) {
        return this.getContextAround(lines, i, 1);
      }
    }
    return '';
  }

  private getContextAround(lines: string[], lineIndex: number, contextLines: number): string {
    const start = Math.max(0, lineIndex - contextLines);
    const end = Math.min(lines.length, lineIndex + contextLines + 1);
    return lines.slice(start, end).join('\n').trim();
  }

  private async insertConversations(conversations: IndexedConversation[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO conversations 
          (id, conversation_id, title, summary, created_at, project, file_path, message_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const ftsStmt = this.db.prepare(`
          INSERT OR REPLACE INTO conversations_fts 
          (conversation_id, title, summary, project)
          VALUES (?, ?, ?, ?)
        `);

        for (const conv of conversations) {
          stmt.run(conv.id, conv.conversation_id, conv.title, conv.summary, 
                  conv.created_at, conv.project, conv.file_path, conv.message_count);
          ftsStmt.run(conv.conversation_id, conv.title, conv.summary, conv.project || '');
        }

        stmt.finalize((err1) => {
          if (err1) {
            reject(err1);
            return;
          }
          ftsStmt.finalize((err2) => {
            if (err2) reject(err2);
            else resolve();
          });
        });
      });
    });
  }

  private async insertMessages(messages: IndexedMessage[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO messages 
          (id, conversation_id, message_index, role, content, content_type)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        const ftsStmt = this.db.prepare(`
          INSERT OR REPLACE INTO messages_fts 
          (conversation_id, content)
          VALUES (?, ?)
        `);

        for (const msg of messages) {
          stmt.run(msg.id, msg.conversation_id, msg.message_index, 
                  msg.role, msg.content, msg.content_type);
          // Only index substantial content for FTS
          if (msg.content && msg.content.length > 10) {
            ftsStmt.run(msg.conversation_id, msg.content);
          }
        }

        stmt.finalize((err1) => {
          if (err1) {
            reject(err1);
            return;
          }
          ftsStmt.finalize((err2) => {
            if (err2) reject(err2);
            else resolve();
          });
        });
      });
    });
  }

  private async insertCommands(commands: IndexedCommand[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO commands 
          (id, conversation_id, message_index, command, command_type, context, confidence)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const ftsStmt = this.db.prepare(`
          INSERT OR REPLACE INTO commands_fts 
          (conversation_id, command, context)
          VALUES (?, ?, ?)
        `);

        for (const cmd of commands) {
          stmt.run(cmd.id, cmd.conversation_id, cmd.message_index, 
                  cmd.command, cmd.command_type, cmd.context, cmd.confidence);
          ftsStmt.run(cmd.conversation_id, cmd.command, cmd.context);
        }

        stmt.finalize((err1) => {
          if (err1) {
            reject(err1);
            return;
          }
          ftsStmt.finalize((err2) => {
            if (err2) reject(err2);
            else resolve();
          });
        });
      });
    });
  }

  private async buildFuseIndexes(): Promise<void> {
    // Get data for Fuse.js indexes
    const conversations = await this.getAllConversations();
    const messages = await this.getAllMessages();
    const commands = await this.getAllCommands();

    // Configure Fuse.js options
    const conversationOptions = {
      keys: ['title', 'summary', 'project'],
      threshold: 0.3,
      includeScore: true
    };

    const messageOptions = {
      keys: ['content'],
      threshold: 0.4,
      includeScore: true
    };

    const commandOptions = {
      keys: ['command', 'context'],
      threshold: 0.2,
      includeScore: true
    };

    this.conversationFuse = new Fuse(conversations, conversationOptions);
    this.messageFuse = new Fuse(messages, messageOptions);
    this.commandFuse = new Fuse(commands, commandOptions);
  }

  private getAllConversations(): Promise<IndexedConversation[]> {
    return new Promise((resolve, reject) => {
      this.db.all("SELECT * FROM conversations", (err, rows) => {
        if (err) reject(err);
        else resolve(rows as IndexedConversation[]);
      });
    });
  }

  private getAllMessages(): Promise<IndexedMessage[]> {
    return new Promise((resolve, reject) => {
      this.db.all("SELECT * FROM messages LIMIT 10000", (err, rows) => {
        if (err) reject(err);
        else resolve(rows as IndexedMessage[]);
      });
    });
  }

  private getAllCommands(): Promise<IndexedCommand[]> {
    return new Promise((resolve, reject) => {
      this.db.all("SELECT * FROM commands", (err, rows) => {
        if (err) reject(err);
        else resolve(rows as IndexedCommand[]);
      });
    });
  }

  // Public search methods
  async searchConversations(query: string, options: {
    project?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  } = {}): Promise<SearchResult[]> {
    if (!this.isInitialized) {
      throw new Error("Search index not initialized");
    }

    const { project, dateFrom, dateTo, limit = 10 } = options;
    
    // Use FTS for primary search
    let sql = `
      SELECT c.*, bm25(conversations_fts) as rank
      FROM conversations c
      JOIN conversations_fts ON conversations_fts.conversation_id = c.conversation_id
      WHERE conversations_fts MATCH ?
    `;
    
    const params: any[] = [query];
    
    if (project) {
      sql += " AND c.project = ?";
      params.push(project);
    }
    
    if (dateFrom) {
      sql += " AND c.created_at >= ?";
      params.push(dateFrom);
    }
    
    if (dateTo) {
      sql += " AND c.created_at <= ?";
      params.push(dateTo);
    }
    
    sql += " ORDER BY rank LIMIT ?";
    params.push(limit);

    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else {
          const results: SearchResult[] = (rows as any[]).map(row => ({
            type: 'conversation' as const,
            item: row as IndexedConversation,
            score: row.rank || 0
          }));
          resolve(results);
        }
      });
    });
  }

  async searchCommands(query: string, options: {
    commandType?: string;
    limit?: number;
  } = {}): Promise<SearchResult[]> {
    if (!this.isInitialized) {
      throw new Error("Search index not initialized");
    }

    const { commandType, limit = 10 } = options;
    
    let sql = `
      SELECT c.*, bm25(commands_fts) as rank
      FROM commands c
      JOIN commands_fts ON commands_fts.conversation_id = c.conversation_id
      WHERE commands_fts MATCH ?
    `;
    
    const params: any[] = [query];
    
    if (commandType && commandType !== 'any') {
      sql += " AND c.command_type = ?";
      params.push(commandType);
    }
    
    sql += " ORDER BY rank, c.confidence DESC LIMIT ?";
    params.push(limit);

    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else {
          const results: SearchResult[] = (rows as any[]).map(row => ({
            type: 'command' as const,
            item: row as IndexedCommand,
            score: row.rank || 0
          }));
          resolve(results);
        }
      });
    });
  }

  async fuzzySearchCommands(query: string, limit: number = 10): Promise<SearchResult[]> {
    if (!this.isInitialized || !this.commandFuse) {
      throw new Error("Search index not initialized");
    }

    const results = this.commandFuse.search(query, { limit });
    return results.map(result => ({
      type: 'command' as const,
      item: result.item,
      score: result.score || 0
    }));
  }

  async getStats(): Promise<{
    conversations: number;
    messages: number;
    commands: number;
  }> {
    const stats = await Promise.all([
      new Promise<number>((resolve, reject) => {
        this.db.get("SELECT COUNT(*) as count FROM conversations", (err, row: any) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      }),
      new Promise<number>((resolve, reject) => {
        this.db.get("SELECT COUNT(*) as count FROM messages", (err, row: any) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      }),
      new Promise<number>((resolve, reject) => {
        this.db.get("SELECT COUNT(*) as count FROM commands", (err, row: any) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      })
    ]);

    return {
      conversations: stats[0],
      messages: stats[1],
      commands: stats[2]
    };
  }

  close(): void {
    this.db.close();
  }
}