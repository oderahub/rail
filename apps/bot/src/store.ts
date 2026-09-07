import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";

// Railway (or any host with a mounted volume) sets DATA_DIR; locally it is ./data.
// A serverless host has no durable filesystem — this bot needs a real process.
const dir = process.env.DATA_DIR ?? "data";
mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(`${dir}/rail.db`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    tg_id     TEXT PRIMARY KEY,
    owner     TEXT NOT NULL,
    vault     TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS seen_settlements (
    key       TEXT PRIMARY KEY,
    seen_at   INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS seen_fills (
    fill_id   TEXT PRIMARY KEY,
    tg_id     TEXT NOT NULL,
    seen_at   INTEGER NOT NULL
  );
`);

export interface User { tgId: string; owner: `0x${string}`; vault: `0x${string}` }

const rowToUser = (r: any): User => ({ tgId: r.tg_id, owner: r.owner, vault: r.vault });

export const getUser = (tgId: string): User | null => {
  const r = db.prepare("SELECT * FROM users WHERE tg_id = ?").get(tgId);
  return r ? rowToUser(r) : null;
};

export const putUser = (tgId: string, owner: string, vault: string): void => {
  db.prepare("INSERT OR REPLACE INTO users (tg_id, owner, vault, created_at) VALUES (?,?,?,?)")
    .run(tgId, owner.toLowerCase(), vault.toLowerCase(), Date.now());
};

export const allUsers = (): User[] =>
  (db.prepare("SELECT * FROM users").all() as any[]).map(rowToUser);

/** Fill ids we have already told someone about — restart-safe, so a redeploy
 *  does not spam every user with their whole history. */
export const isNewFill = (fillId: string, tgId: string): boolean => {
  const key = `${fillId}:${tgId}`;
  const seen = db.prepare("SELECT 1 FROM seen_fills WHERE fill_id = ?").get(key);
  if (seen) return false;
  db.prepare("INSERT INTO seen_fills (fill_id, tg_id, seen_at) VALUES (?,?,?)").run(key, tgId, Date.now());
  return true;
};

/** Mark every existing fill as seen, so first boot is silent. */
export const primeSeen = (fillIds: string[], tgId: string): void => {
  const stmt = db.prepare("INSERT OR IGNORE INTO seen_fills (fill_id, tg_id, seen_at) VALUES (?,?,?)");
  for (const id of fillIds) stmt.run(`${id}:${tgId}`, tgId, Date.now());
};

/** One settlement notice per market per user, across restarts. */
export const isNewSettlement = (marketId: string, outcomeIdx: number, tgId: string): boolean => {
  const key = `${marketId}:${outcomeIdx}:${tgId}`;
  if (db.prepare("SELECT 1 FROM seen_settlements WHERE key = ?").get(key)) return false;
  db.prepare("INSERT INTO seen_settlements (key, seen_at) VALUES (?,?)").run(key, Date.now());
  return true;
};
