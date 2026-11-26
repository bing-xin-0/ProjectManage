import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');
mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'project-pulse.sqlite'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email TEXT,
  github_token TEXT,
  github_username TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  repo_full_name TEXT,
  repo_remote TEXT,
  repo_default_branch TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  visibility TEXT NOT NULL DEFAULT 'private',
  share_token TEXT,
  share_message_policy TEXT NOT NULL DEFAULT 'hidden',
  starred INTEGER NOT NULL DEFAULT 0,
  tags TEXT,
  idle_days_override INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_active_at TEXT,
  UNIQUE(owner_id, name)
);

CREATE TABLE IF NOT EXISTS commits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  hash TEXT NOT NULL,
  message TEXT,
  author TEXT,
  author_email TEXT,
  committed_at TEXT NOT NULL,
  committed_offset TEXT,
  branch TEXT,
  UNIQUE(project_id, hash)
);

CREATE TABLE IF NOT EXISTS project_local_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  machine_id TEXT NOT NULL,
  local_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(project_id, machine_id)
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  machine_id TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL,
  first_sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at TEXT,
  UNIQUE(project_id, type)
);

CREATE INDEX IF NOT EXISTS idx_commits_project_time ON commits(project_id, committed_at);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
`;

db.exec(schema);

// 轻量迁移：为已有库补新增列（无 ALTER IF NOT EXISTS，手动检查）
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}
ensureColumn('users', 'github_token', 'TEXT');
ensureColumn('users', 'github_username', 'TEXT');
ensureColumn('projects', 'source', "TEXT NOT NULL DEFAULT 'manual'");
ensureColumn('projects', 'repo_full_name', 'TEXT');
ensureColumn('projects', 'repo_default_branch', 'TEXT');

export function nowIso(): string {
  return new Date().toISOString();
}