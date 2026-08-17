let SQLite: any = null;
try {
  SQLite = require('expo-sqlite');
} catch (e) {
  console.warn('expo-sqlite unavailable — offline DB disabled', e);
}

let _db: any = null;
let _initPromise: Promise<void> | null = null;
let _available = true;

export function getDb(): any {
  if (!_available) return null;
  if (!SQLite) { _available = false; return null; }
  if (!_db) {
    try {
      _db = SQLite.openDatabaseSync('titan_offline.db');
    } catch (e) {
      console.warn('openDatabaseSync failed:', e);
      _available = false;
    }
  }
  return _db;
}

export function isDbAvailable(): boolean {
  return _available && !!SQLite;
}

export async function initDb(): Promise<void> {
  if (!isDbAvailable()) return;
  if (_initPromise) return _initPromise;
  _initPromise = _doInit().catch(e => {
    console.warn('DB init failed, offline features disabled:', e);
    _available = false;
    _initPromise = null;
  });
  return _initPromise;
}

async function _doInit(): Promise<void> {
  const db = getDb();
  if (!db) return;

  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync(`CREATE TABLE IF NOT EXISTS offline_queue (
    id           TEXT PRIMARY KEY,
    match_id     TEXT NOT NULL,
    hole_number  INTEGER NOT NULL,
    insert_rows  TEXT NOT NULL,
    stat_rows    TEXT NOT NULL,
    match_update TEXT NOT NULL,
    timestamp    INTEGER NOT NULL,
    UNIQUE(match_id, hole_number)
  );`);
  await db.execAsync(`CREATE TABLE IF NOT EXISTS match_pack (
    match_id      TEXT PRIMARY KEY,
    downloaded_at INTEGER NOT NULL,
    match_json    TEXT NOT NULL,
    holes_json    TEXT NOT NULL,
    players_json  TEXT NOT NULL,
    comp_json     TEXT NOT NULL
  );`);
  await db.execAsync(`CREATE TABLE IF NOT EXISTS sync_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );`);
  await db.execAsync(`CREATE TABLE IF NOT EXISTS sync_conflicts (
    id           TEXT PRIMARY KEY,
    match_id     TEXT NOT NULL,
    hole_number  INTEGER NOT NULL,
    server_rows  TEXT NOT NULL,
    local_rows   TEXT NOT NULL,
    local_update TEXT NOT NULL,
    detected_at  INTEGER NOT NULL,
    UNIQUE(match_id, hole_number)
  );`);
  await db.execAsync(`CREATE TABLE IF NOT EXISTS gi_course_cache (
    public_id    TEXT PRIMARY KEY,
    course_name  TEXT NOT NULL,
    holes_json   TEXT NOT NULL,
    cached_at    INTEGER NOT NULL
  );`);
  // Swindle's own offline queue — a lighter shape than offline_queue since
  // a swindle hole save is just one upsert (no hole_stats, no matches-table
  // update), but same overall pattern (queue on network error, drain on
  // reconnect) as the casual round queue above.
  await db.execAsync(`CREATE TABLE IF NOT EXISTS swindle_offline_queue (
    id             TEXT PRIMARY KEY,
    game_id        TEXT NOT NULL,
    player_id      TEXT NOT NULL,
    hole_number    INTEGER NOT NULL,
    gross_score    INTEGER,
    stableford_pts INTEGER,
    timestamp      INTEGER NOT NULL,
    UNIQUE(game_id, player_id, hole_number)
  );`);
}

export async function ensureDb(): Promise<any> {
  if (!isDbAvailable()) return null;
  await initDb();
  return getDb();
}
