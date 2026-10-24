/**
 * Local persistence for the v2 engine (SQLite via node:sqlite, built into Node 22.5+).
 *
 * The full EngineState is stored as one JSON snapshot, which is what gets reloaded on
 * restart. The requests / actions / volunteers tables are readable copies of that
 * snapshot, rewritten on every save, so the data can be inspected with any SQLite
 * client. action_history is append-only.
 *
 * Only enabled when LIFELINE_DB is set (local.ts sets it); Lambda keeps state in memory.
 */
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { EngineState } from "@lifeline/engine";

export interface HistoryEntry {
  id: string;
  at: string;
  actionId: string;
  name: string;
  decision: "Approved" | "Declined" | "Alternative requested" | "Completed";
  volunteer: string | null;
  detail: string;
}

export interface Snapshot {
  scenario: string;
  state: EngineState;
  history: HistoryEntry[];
  /** Wall-clock ISO time each request / action id was first seen. */
  stamps: Record<string, string>;
}

export interface VolunteerRow {
  id: string;
  name: string;
  status: "available" | "assigned" | "busy";
  currentActionId: string | null;
  task: string | null;
  lat: number;
  lng: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS snapshot (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  scenario TEXT NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  raw_text TEXT,
  need TEXT NOT NULL,
  quantity REAL NOT NULL,
  people INTEGER NOT NULL,
  urgency TEXT NOT NULL,
  location TEXT,
  status TEXT NOT NULL,
  waiting_reason TEXT,
  created_at_sim REAL NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  need_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  volunteer_id TEXT,
  from_id TEXT NOT NULL,
  to_id TEXT,
  item TEXT NOT NULL,
  quantity REAL NOT NULL,
  eta_minutes REAL,
  decline_reason TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS volunteers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('available', 'assigned', 'busy')),
  current_action_id TEXT,
  task TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS timestamps (
  id TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS action_history (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  action_id TEXT NOT NULL,
  name TEXT NOT NULL,
  decision TEXT NOT NULL,
  volunteer TEXT,
  detail TEXT NOT NULL
);
`;

export class EngineDb {
  private db: DatabaseSync;

  constructor(file: string) {
    // Lazy require so environments without node:sqlite (e.g. older Lambda runtimes) never load it.
    const { DatabaseSync: Database } = require("node:sqlite") as typeof import("node:sqlite");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.exec(SCHEMA);
    for (const [table, column] of [["requests", "submitted_at"], ["actions", "created_at"]]) {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
    }
  }

  load(): Snapshot | null {
    const row = this.db.prepare("SELECT scenario, state_json FROM snapshot WHERE id = 1").get() as
      | { scenario: string; state_json: string }
      | undefined;
    if (!row) return null;
    const history = this.db
      .prepare("SELECT id, at, action_id, name, decision, volunteer, detail FROM action_history ORDER BY at, id")
      .all() as unknown as Array<Record<string, string | null>>;
    const stamps = this.db.prepare("SELECT id, first_seen_at FROM timestamps").all() as unknown as Array<{
      id: string;
      first_seen_at: string;
    }>;
    return {
      scenario: row.scenario,
      state: JSON.parse(row.state_json) as EngineState,
      stamps: Object.fromEntries(stamps.map((s) => [s.id, s.first_seen_at])),
      history: history.map((h) => ({
        id: String(h.id),
        at: String(h.at),
        actionId: String(h.action_id),
        name: String(h.name),
        decision: h.decision as HistoryEntry["decision"],
        volunteer: h.volunteer,
        detail: String(h.detail),
      })),
    };
  }

  save(
    scenario: string,
    state: EngineState,
    history: HistoryEntry[],
    volunteers: VolunteerRow[],
    stamps: Record<string, string>,
  ): void {
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `INSERT INTO snapshot (id, scenario, state_json, updated_at) VALUES (1, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET scenario = excluded.scenario, state_json = excluded.state_json, updated_at = excluded.updated_at`,
        )
        .run(scenario, JSON.stringify(state), now);

      this.db.exec("DELETE FROM requests; DELETE FROM actions; DELETE FROM volunteers;");
      const insReq = this.db.prepare(
        `INSERT INTO requests (id, raw_text, need, quantity, people, urgency, location, status, waiting_reason,
           created_at_sim, updated_at, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of state.requests) {
        insReq.run(r.id, r.rawText ?? null, r.needKind, r.quantity, r.peopleAffected, r.urgency, r.locationLabel,
          r.status, r.waitingReason ?? null, r.createdAt, now, stamps[r.id] ?? null);
      }
      const insAct = this.db.prepare(
        `INSERT INTO actions (id, need_id, type, status, volunteer_id, from_id, to_id, item, quantity, eta_minutes,
           decline_reason, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const a of state.actions) {
        insAct.run(a.id, a.needId, a.type, a.status, a.volunteerId ?? null, a.fromFacilityId,
          a.toFacilityId ?? a.toRequestId ?? null, a.itemKind, a.quantity, a.etaMinutes, a.declineReason ?? null, now,
          stamps[a.id] ?? null);
      }
      const insStamp = this.db.prepare("INSERT OR IGNORE INTO timestamps VALUES (?, ?)");
      for (const [id, at] of Object.entries(stamps)) insStamp.run(id, at);
      const insVol = this.db.prepare("INSERT INTO volunteers VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      for (const v of volunteers) {
        insVol.run(v.id, v.name, v.status, v.currentActionId, v.task, v.lat, v.lng, now);
      }
      const insHist = this.db.prepare("INSERT OR IGNORE INTO action_history VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const h of history) insHist.run(h.id, h.at, h.actionId, h.name, h.decision, h.volunteer, h.detail);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /** Wipe everything (used by /simulate and /simulate/reset, which start a fresh session). */
  clear(): void {
    this.db.exec(
      "DELETE FROM snapshot; DELETE FROM requests; DELETE FROM actions; DELETE FROM volunteers; DELETE FROM action_history; DELETE FROM timestamps;",
    );
  }
}
