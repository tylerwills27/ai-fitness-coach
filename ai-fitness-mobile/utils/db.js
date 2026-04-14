import * as SQLite from "expo-sqlite";

// ✅ Use the new synchronous API
const db = SQLite.openDatabaseSync("fitness_coach.db");

// Initialize the profile table
export const initDB = () => {
  db.execAsync(`
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      age INTEGER,
      weight REAL,
      height REAL,
      goal TEXT
    );
  `)
  .then(() => console.log("✅ Profile table ready"))
  .catch((err) => console.error("❌ DB init error:", err));
};

// Save or update profile (single profile version)
export const saveProfile = async (name, age, weight, height, goal) => {
  try {
    await db.execAsync("DELETE FROM profile;");
    await db.runAsync(
      "INSERT INTO profile (name, age, weight, height, goal) VALUES (?, ?, ?, ?, ?);",
      [name, age, weight, height, goal]
    );
    console.log("✅ Profile saved");
  } catch (err) {
    console.error("❌ Error saving profile:", err);
  }
};

// Load saved profile
export const loadProfile = async () => {
  try {
    const result = await db.getAllAsync("SELECT * FROM profile LIMIT 1;");
    return result.length ? result[0] : null;
  } catch (err) {
    console.error("❌ Error loading profile:", err);
    return null;
  }
};
