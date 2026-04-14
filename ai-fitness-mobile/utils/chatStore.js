// utils/chatStore.js
import { openDatabaseAsync } from "expo-sqlite";

/** Open shared DB and ensure chat table exists */
export async function getDB() {
  const db = await openDatabaseAsync("profiles.db");
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,            -- 'user' | 'assistant' | 'system'
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL    -- epoch ms
    );
    CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at);
  `);
  return db;
}

/** Add a single message */
export async function addMessage(role, text) {
  const db = await getDB();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO chat_messages (role, text, created_at) VALUES (?, ?, ?);`,
    [role, String(text ?? ""), now]
  );
}

/** Get all messages (oldest → newest). Optional limit. */
export async function getMessages(limit = 500) {
  const db = await getDB();
  const rows = await db.getAllAsync(
    `SELECT id, role, text, created_at
     FROM chat_messages
     ORDER BY created_at ASC, id ASC
     LIMIT ?;`,
    [limit]
  );
  return rows || [];
}

/** Clear everything */
export async function clearMessages() {
  const db = await getDB();
  await db.execAsync(`DELETE FROM chat_messages; VACUUM;`);
}
