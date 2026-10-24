import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { createSeedState } from "./data/seed";
import { WorldState } from "./types";

const WORLD_KEY = "world";

export interface StateStore {
  load(): Promise<WorldState>;
  save(state: WorldState): Promise<void>;
}

class MemoryStore implements StateStore {
  private state: WorldState = createSeedState();

  async load(): Promise<WorldState> {
    return structuredClone(this.state);
  }

  async save(state: WorldState): Promise<void> {
    this.state = structuredClone(state);
  }
}

class DynamoStore implements StateStore {
  private doc: DynamoDBDocumentClient;
  private table: string;

  constructor(table: string) {
    const client = new DynamoDBClient({});
    this.doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
    this.table = table;
  }

  async load(): Promise<WorldState> {
    const res = await this.doc.send(new GetCommand({ TableName: this.table, Key: { pk: WORLD_KEY } }));
    if (!res.Item?.payload) {
      const seed = createSeedState();
      await this.save(seed);
      return seed;
    }
    return res.Item.payload as WorldState;
  }

  async save(state: WorldState): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk: WORLD_KEY, payload: state, updatedAt: new Date().toISOString() },
      }),
    );
  }
}

let singleton: StateStore | undefined;

export function getStore(): StateStore {
  if (!singleton) {
    singleton = process.env.TABLE_NAME ? new DynamoStore(process.env.TABLE_NAME) : new MemoryStore();
  }
  return singleton;
}

export function resetStoreForTests(): void {
  singleton = new MemoryStore();
}
