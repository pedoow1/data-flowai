import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../shared/schema";

const { Pool } = pg;

let _pool: InstanceType<typeof Pool> | undefined;
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

function getInstance() {
  if (!_db) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
    }
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
    _db = drizzle(_pool, { schema });
  }
  return { db: _db, pool: _pool! };
}

export const pool = new Proxy({} as InstanceType<typeof Pool>, {
  get(_, prop) {
    return getInstance().pool[prop as keyof InstanceType<typeof Pool>];
  },
});

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_, prop) {
    return (getInstance().db as any)[prop];
  },
});
