// utils/settings.js
import { openDatabaseAsync } from "expo-sqlite";

async function db() {
  const d = await openDatabaseAsync("profiles.db");
  await d.execAsync(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  return d;
}

export async function getSetting(key, fallback = null) {
  const d = await db();
  const row = await d.getFirstAsync(`SELECT value FROM app_settings WHERE key=?;`, [key]);
  return row?.value ?? fallback;
}

export async function setSetting(key, value) {
  const d = await db();
  await d.runAsync(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value;`,
    [key, String(value)]
  );
}

// Convenience getters
export const getUnits = () => getSetting("units", "imperial");           // 'imperial' | 'metric'
export const setUnits = (u) => setSetting("units", u);

export const getTTSRate = () => getSetting("tts_rate", "1.0");
export const setTTSRate = (r) => setSetting("tts_rate", String(r));

export const getTTSVoice = () => getSetting("tts_voice", "");
export const setTTSVoice = (id) => setSetting("tts_voice", id);
