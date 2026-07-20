import * as SQLite from 'expo-sqlite';

let _db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (!_db) _db = SQLite.openDatabaseSync('titan_offline.db');
  return _db;
}

export async function initDb(): Promise<void> {
  const db = getDb();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS offline_queue (
      id           TEXT PRIMARY KEY,
      match_id     TEXT NOT NULL,
      hole_number  INTEGER NOT NULL,
      insert_rows  TEXT NOT NULL,
      stat_rows    TEXT NOT NULL,
      match_update TEXT NOT NULL,
      timestamp    INTEGER NOT NULL,
      UNIQUE(match_id, hole_number)
    );

    CREATE TABLE IF NOT EXISTS match_pack (
      match_id      TEXT PRIMARY KEY,
      downloaded_at INTEGER NOT NULL,
      match_json    TEXT NOT NULL,
      holes_json    TEXT NOT NULL,
      players_json  TEXT NOT NULL,
      comp_json     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_conflicts (
      id           TEXT PRIMARY KEY,
      match_id     TEXT NOT NULL,
      hole_number  INTEGER NOT NULL,
      server_rows  TEXT NOT NULL,
      local_rows   TEXT NOT NULL,
      local_update TEXT NOT NULL,
      detected_at  INTEGER NOT NULL,
      UNIQUE(match_id, hole_number)
    );
  `);
}

export async function ensureDb(): Promise<SQLite.SQLiteDatabase> {
  const db = getDb();
  await initDb();
  return db;
}
