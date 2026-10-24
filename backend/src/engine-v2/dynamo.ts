/**
 * DynamoDB persistence for the v2 engine — the cloud counterpart of the SQLite
 * EngineDb (db.ts). It implements the same load/save/clear surface the store
 * uses, but stores the whole session as one JSON snapshot item, so cloud state
 * survives Lambda cold starts and is shared across containers.
 *
 * Enabled when TABLE_NAME is set (the CDK stack sets it on the Lambda).
 * The SQLite path (LIFELINE_DB) stays for local dev; they are mutually exclusive.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { EngineState } from "@lifeline/engine";
import type { HistoryEntry, Snapshot, VolunteerRow } from "./db";

const WORLD_KEY = "world-v2";

/** Same persistence contract as the SQLite EngineDb, backed by DynamoDB. */
export class DynamoEngineDb {
  private doc: DynamoDBDocumentClient;
  private table: string;

  constructor(table: string) {
    const client = new DynamoDBClient({});
    this.doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
    this.table = table;
  }

  /**
   * Note: the AWS SDK calls are async, but the store's db interface is sync
   * (mirrors node:sqlite's DatabaseSync). We keep a synchronous in-process
   * cache and write-through to DynamoDB in the background, so the store API is
   * unchanged. load() is the one place that must read before the cache exists.
   */
  private cache: Snapshot | null | undefined; // undefined = not loaded yet

  /** Synchronous load from the in-process cache. Call loadAsync() once at startup. */
  load(): Snapshot | null {
    return this.cache ?? null;
  }

  /** Read the snapshot from DynamoDB once and populate the cache (await at startup). */
  async loadAsync(): Promise<Snapshot | null> {
    try {
      const res = await this.doc.send(new GetCommand({ TableName: this.table, Key: { pk: WORLD_KEY } }));
      this.cache = (res.Item?.payload as Snapshot | undefined) ?? null;
    } catch (err) {
      console.warn("DynamoEngineDb load failed; starting fresh", err);
      this.cache = null;
    }
    return this.cache;
  }

  save(
    scenario: string,
    state: EngineState,
    history: HistoryEntry[],
    _volunteers: VolunteerRow[],
    stamps: Record<string, string>,
  ): void {
    const snapshot: Snapshot = { scenario, state, history, stamps };
    this.cache = snapshot;
    // Fire-and-forget write-through; errors are logged, never thrown into the request path.
    this.doc
      .send(
        new PutCommand({
          TableName: this.table,
          Item: { pk: WORLD_KEY, payload: snapshot, updatedAt: new Date().toISOString() },
        }),
      )
      .catch((err) => console.warn("DynamoEngineDb save failed", err));
  }

  clear(): void {
    this.cache = null;
    this.doc
      .send(new DeleteCommand({ TableName: this.table, Key: { pk: WORLD_KEY } }))
      .catch((err) => console.warn("DynamoEngineDb clear failed", err));
  }
}
