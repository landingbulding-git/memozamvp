import Database from 'better-sqlite3';
import path from 'path';

// Store DB in the project root directory
const dbPath = path.resolve(process.cwd(), 'memoza.sqlite');
const db = new Database(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    notion_access_token TEXT NOT NULL,
    notion_bot_id TEXT,
    notion_workspace_name TEXT,
    notion_user_name TEXT,
    notion_user_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Migrate existing tables that predate these columns
try { db.exec('ALTER TABLE sessions ADD COLUMN notion_user_name TEXT'); } catch {}
try { db.exec('ALTER TABLE sessions ADD COLUMN notion_user_id TEXT'); } catch {}

export default db;
