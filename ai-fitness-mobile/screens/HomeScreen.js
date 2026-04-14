// HomeScreen.js
import React, { useEffect, useState, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { openDatabaseAsync } from "expo-sqlite";
import { getPlan } from "../utils/api";

const UNITS = "imperial"; // 'imperial' (in/lb) or 'metric' (cm/kg)
const inchesToCm = (inches) => Math.round(inches * 2.54);
const poundsToKg = (lb) => Math.round((lb * 0.45359237) * 10) / 10;

function normalizeProfileForPlan(row) {
  const age = Number(row.age);
  const height_raw = Number(row.height);
  const weight_raw = Number(row.weight);
  const height_cm = UNITS === "imperial" ? inchesToCm(height_raw) : Math.round(height_raw);
  const weight_kg = UNITS === "imperial" ? poundsToKg(weight_raw) : Math.round(weight_raw * 10) / 10;

  let goal = "maintain";
  const g = String(row.goal || "").toLowerCase();
  if (g.includes("build") || g.includes("muscle") || g.includes("gain")) goal = "build_muscle";
  else if (g.includes("lose") || g.includes("cut") || g.includes("weight")) goal = "lose_weight";

  return {
    name: row.name || "User",
    age,
    height_cm,
    weight_kg,
    goal,
    activity: "moderate",
  };
}

export default function HomeScreen({ navigation }) {
  const [db, setDb] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [planning, setPlanning] = useState(false);

  // Ensure tables and load active profile
  const readActiveProfile = useCallback(async (database) => {
    // Get active profile name if set
    const setRows = await database.getAllAsync(
      `SELECT value FROM settings WHERE key='active_profile' LIMIT 1;`
    );
    const active = setRows?.[0]?.value;

    let rows;
    if (active) {
      rows = await database.getAllAsync(
        `SELECT name, age, height, weight, goal FROM profiles WHERE name=? LIMIT 1;`,
        [active]
      );
    } else {
      // Fall back to any profile (first by name)
      rows = await database.getAllAsync(
        `SELECT name, age, height, weight, goal FROM profiles ORDER BY name COLLATE NOCASE ASC LIMIT 1;`
      );
    }

    if (rows && rows.length > 0) setProfile(rows[0]);
    else setProfile(null);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const database = await openDatabaseAsync("profiles.db");
        setDb(database);

        await database.execAsync(`
          CREATE TABLE IF NOT EXISTS profiles (
            name TEXT PRIMARY KEY,
            age INTEGER,
            weight REAL,
            height REAL,
            goal TEXT
          );
        `);
        await database.execAsync(`
          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
          );
        `);

        await readActiveProfile(database);
      } catch (e) {
        console.error("SQLite init/load error:", e);
        Alert.alert("Database Error", "Unable to open or read the local database.");
      } finally {
        setLoading(false);
      }
    })();
  }, [readActiveProfile]);

  // Reload whenever Home gains focus (after setting active or making changes)
  useFocusEffect(
    useCallback(() => {
      (async () => {
        if (!db) return;
        await readActiveProfile(db);
      })();
    }, [db, readActiveProfile])
  );

const handleGeneratePlan = useCallback(async () => {
  if (!profile) {
    Alert.alert("No profile found", "Go to your Profile screen and create/select a profile.");
    return;
  }
  try {
    setPlanning(true);

    const payload = normalizeProfileForPlan(profile);

    // ✅ Pass the normalized profile to Plan screen
    navigation.navigate("Plan", { profile: payload });

  } catch (e) {
    console.error("getPlan failed:", e);
    Alert.alert("Network Error", "Could not reach the backend. Is your tunnel running?");
  } finally {
    setPlanning(false);
  }
}, [profile, navigation]);


  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading your profile…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome{profile?.name ? `, ${profile.name}` : ""} 👋</Text>
      {profile ? (
        <Text style={styles.subtitle}>
          Active Profile: {String(profile.name)}{"\n"}
          Goal: {String(profile.goal || "")}{"\n"}
          Units: {UNITS.toUpperCase()}
        </Text>
      ) : (
        <Text style={styles.subtitle}>
          No active profile. Create one or choose from existing profiles.
        </Text>
      )}

      <TouchableOpacity style={styles.button} onPress={handleGeneratePlan} disabled={planning}>
        <Text style={styles.buttonText}>{planning ? "Generating…" : "🧠 Generate My Plan"}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, styles.secondary]} onPress={() => navigation.navigate("Chatbot")}>
        <Text style={styles.buttonText}>💬 Open Chatbot</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, styles.secondary]} onPress={() => navigation.navigate("Progress")}>
        <Text style={styles.buttonText}>Update Progress</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.link]} onPress={() => navigation.navigate("Profile")}>
        <Text style={styles.linkText}>Manage Profiles</Text>
      </TouchableOpacity>

      
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { flex: 1, padding: 20, paddingTop: 64, backgroundColor: "#fff" },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 6 },
  subtitle: { fontSize: 16, color: "#555", marginBottom: 20 },
  button: {
    backgroundColor: "#4f46e5",
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  secondary: { backgroundColor: "#0ea5e9" },
  buttonText: { color: "white", fontSize: 16, fontWeight: "600" },
  link: { marginTop: 16, alignItems: "center" },
  linkText: { color: "#2563eb", fontSize: 14, fontWeight: "600" },
});
