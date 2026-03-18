'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'frog_automation.db');

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    filename   TEXT    NOT NULL,
    filepath   TEXT    NOT NULL UNIQUE,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS spider_configs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    filename   TEXT    NOT NULL,
    filepath   TEXT    NOT NULL UNIQUE,
    is_local   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    url              TEXT    NOT NULL,
    profile_id       INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
    spider_config_id INTEGER REFERENCES spider_configs(id) ON DELETE SET NULL,
    export_tabs      TEXT    NOT NULL,
    status           TEXT    NOT NULL DEFAULT 'queued',
    output_dir       TEXT,
    zip_path         TEXT,
    error            TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    started_at       TEXT,
    completed_at     TEXT,
    cron_expression  TEXT,
    next_run_at      TEXT,
    diff_summary     TEXT
  );
`);

// Idempotent migrations for databases created before cron/diff/spider-config support was added.
for (const col of ['cron_expression TEXT', 'next_run_at TEXT', 'diff_summary TEXT', 'spider_config_id INTEGER']) {
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN ${col}`);
  } catch {
    // Column already exists – safe to ignore.
  }
}

// Idempotent migration: is_local column for spider_configs (added later).
try {
  db.exec('ALTER TABLE spider_configs ADD COLUMN is_local INTEGER NOT NULL DEFAULT 0');
} catch {
  // Column already exists – safe to ignore.
}

db.exec(`
  CREATE TABLE IF NOT EXISTS api_credentials (
    service     TEXT    PRIMARY KEY,
    enabled     INTEGER NOT NULL DEFAULT 0,
    credentials TEXT    NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS webhooks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    url        TEXT    NOT NULL,
    event_type TEXT    NOT NULL,
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// Seed a row for every known integration so GET always returns the full list.
const API_SERVICES = [
  'google_search_console',
  'pagespeed',
  'majestic',
  'mozscape',
  'ahrefs',
  'google_analytics',
  'google_analytics_4',
  'google_drive',
];
const seedStmt = db.prepare(
  "INSERT OR IGNORE INTO api_credentials (service, enabled, credentials) VALUES (?, 0, '{}')"
);
for (const svc of API_SERVICES) {
  seedStmt.run(svc);
}

module.exports = { db, DATA_DIR };
