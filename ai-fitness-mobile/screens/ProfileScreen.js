import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  FlatList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { openDatabaseAsync } from "expo-sqlite";

export default function ProfileScreen({ navigation }) {
  const [db, setDb] = useState(null);

  // ---- New/Edit profile form ----
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [height, setHeight] = useState(""); // inches (current UI unit)
  const [weight, setWeight] = useState(""); // lbs
  const [goal, setGoal] = useState("");

  // ---- Existing profiles + active ----
  const [profiles, setProfiles] = useState([]);
  const [activeName, setActiveName] = useState("");

  const loadProfiles = useCallback(async () => {
    if (!db) return;
    const rows = await db.getAllAsync(
      `SELECT name, age, height, weight, goal FROM profiles ORDER BY name COLLATE NOCASE ASC;`
    );
    setProfiles(rows || []);
  }, [db]);

  const loadActive = useCallback(async () => {
    if (!db) return;
    const setRows = await db.getAllAsync(`SELECT value FROM settings WHERE key='active_profile' LIMIT 1;`);
    setActiveName(setRows?.[0]?.value || "");
  }, [db]);

  useEffect(() => {
    (async () => {
      const database = await openDatabaseAsync("profiles.db");
      setDb(database);

      // Ensure tables exist
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

      await loadProfiles();
      await loadActive();
    })();
  }, [loadProfiles, loadActive]);

  const clearForm = () => {
    setName("");
    setAge("");
    setHeight("");
    setWeight("");
    setGoal("");
  };

  const handleSave = async () => {
    if (!db) return;
    if (!name || !age || !height || !weight) {
      Alert.alert("Missing info", "Please fill name, age, height, and weight.");
      return;
    }

    try {
      await db.runAsync(
        `INSERT OR REPLACE INTO profiles (name, age, weight, height, goal)
         VALUES (?, ?, ?, ?, ?);`,
        [name.trim(), Number(age), Number(weight), Number(height), goal.trim()]
      );

      // Set this as the active profile (stays consistent with previous behavior)
      await db.runAsync(
        `INSERT OR REPLACE INTO settings (key, value) VALUES ('active_profile', ?);`,
        [name.trim()]
      );

      await loadProfiles();
      await loadActive();
      Alert.alert("Saved", "Profile saved and set as active.", [
        { text: "OK", onPress: () => navigation.navigate("Home") },
      ]);
      // keep the form filled (so edits are obvious) — or call clearForm() if you prefer
    } catch (e) {
      console.error("Profile save error:", e);
      Alert.alert("Database Error", "Could not save your profile.");
    }
  };

  const handleUseProfile = async (profileName) => {
    try {
      if (!db) return;
      await db.runAsync(
        `INSERT OR REPLACE INTO settings (key, value) VALUES ('active_profile', ?);`,
        [profileName]
      );
      await loadActive();
      Alert.alert("Active Profile Set", `${profileName} is now active.`, [
        { text: "OK", onPress: () => navigation.navigate("Home") },
      ]);
    } catch (e) {
      console.error("Set active error:", e);
    }
  };

  const handleDeleteProfile = async (profileName) => {
    Alert.alert(
      "Delete Profile",
      `Are you sure you want to delete "${profileName}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              if (!db) return;
              const setRows = await db.getAllAsync(
                `SELECT value FROM settings WHERE key='active_profile' LIMIT 1;`
              );
              const active = setRows?.[0]?.value;
              if (active === profileName) {
                await db.runAsync(`DELETE FROM settings WHERE key='active_profile';`);
                setActiveName("");
              }
              await db.runAsync(`DELETE FROM profiles WHERE name=?;`, [profileName]);
              await loadProfiles();
              // if editing deleted one, clear the form
              if ((name || "").trim().toLowerCase() === profileName.toLowerCase()) {
                clearForm();
              }
            } catch (e) {
              console.error("Delete error:", e);
              Alert.alert("Error", "Could not delete the profile.");
            }
          },
        },
      ]
    );
  };

  const handleEditProfile = (p) => {
    // fill the form with profile data for quick edits
    setName(p.name);
    setAge(String(p.age ?? ""));
    setHeight(String(p.height ?? ""));
    setWeight(String(p.weight ?? ""));
    setGoal(String(p.goal ?? ""));
  };

  const renderProfileItem = ({ item }) => {
    const isActive = item.name === activeName;
    return (
      <View style={[styles.profileRow, isActive && styles.profileRowActive]}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={styles.profileName}>{item.name}</Text>
            {isActive ? (
              <View style={styles.activeBadge}>
                <Ionicons name="checkmark-circle" size={12} color="#065F46" />
                <Text style={styles.activeBadgeText}>Active</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.profileMeta}>
            Age {item.age} • {item.height}" • {item.weight} lb
          </Text>
          {item.goal ? <Text style={styles.profileGoal}>Goal: {item.goal}</Text> : null}
        </View>

        {/* actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.pillBtn, styles.editBtn]}
            onPress={() => handleEditProfile(item)}
          >
            <Ionicons name="create" size={16} color="#1f2937" />
            <Text style={[styles.pillText, { color: "#1f2937" }]}>Edit</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.pillBtn, styles.useBtn]}
            onPress={() => handleUseProfile(item.name)}
          >
            <Ionicons name="checkmark-circle" size={16} color="#065F46" />
            <Text style={[styles.pillText, { color: "#065F46" }]}>Use</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.pillBtn, styles.delBtn]}
            onPress={() => handleDeleteProfile(item.name)}
          >
            <Ionicons name="trash" size={16} color="#991B1B" />
            <Text style={[styles.pillText, { color: "#991B1B" }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Active summary card (top of list)
  const ActiveSummary = useMemo(() => {
    if (!activeName) return null;
    const p = profiles.find((x) => x.name === activeName);
    if (!p) return null;
    return (
      <View style={styles.activeCard}>
        <Text style={styles.activeTitle}>Active Profile</Text>
        <Text style={styles.activeLine}>{p.name} — Age {p.age}</Text>
        <Text style={styles.activeLine}>{p.height}" • {p.weight} lb</Text>
        {p.goal ? <Text style={styles.activeLine}>Goal: {p.goal}</Text> : null}
      </View>
    );
  }, [activeName, profiles]);

  // -------- List header = the form + active summary
  const ListHeader = useMemo(
    () => (
      <View style={styles.headerWrap}>
        <Text style={styles.title}>Create or Edit a Profile</Text>

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., Tyler"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />

        <Text style={styles.label}>Age</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., 25"
          value={age}
          onChangeText={setAge}
          inputMode="numeric"
        />

        <Text style={styles.label}>Height (inches)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., 70"
          value={height}
          onChangeText={setHeight}
          inputMode="numeric"
        />

        <Text style={styles.label}>Weight (lbs)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., 175"
          value={weight}
          onChangeText={setWeight}
          inputMode="numeric"
        />

        <Text style={styles.label}>Goal</Text>
        <TextInput
          style={styles.input}
          placeholder='e.g., "build muscle", "lose weight"'
          value={goal}
          onChangeText={setGoal}
        />

        <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
          <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
            <Text style={styles.saveText}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.clearBtn} onPress={clearForm}>
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        </View>

        {/* Active summary */}
        {ActiveSummary}

        <Text style={[styles.title, { marginTop: 24 }]}>Existing Profiles</Text>
      </View>
    ),
    [name, age, height, weight, goal, ActiveSummary]
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: "padding", android: undefined })}
      style={{ flex: 1, backgroundColor: "#fff" }}
      keyboardVerticalOffset={Platform.select({ ios: 80, android: 0 })}
    >
      <FlatList
        data={profiles}
        keyExtractor={(item) => item.name}
        renderItem={renderProfileItem}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
          <Text style={{ color: "#6B7280", marginTop: 6, paddingHorizontal: 20 }}>
            No profiles saved yet.
          </Text>
        }
        contentContainerStyle={{ padding: 20, paddingTop: 48, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  headerWrap: { backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "800", marginBottom: 10, color: "#0B6E4F" },
  label: { fontSize: 14, color: "#374151", marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16,
  },
  saveBtn: {
    backgroundColor: "#0B6E4F",
    paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12,
  },
  saveText: { color: "white", fontSize: 16, fontWeight: "600" },
  clearBtn: {
    backgroundColor: "#F3F4F6",
    paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12,
    borderWidth: 1, borderColor: "#E5E7EB",
  },
  clearText: { color: "#111827", fontSize: 16, fontWeight: "600" },

  activeCard: {
    marginTop: 16, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "#A7F3D0",
    backgroundColor: "#ECFDF5",
  },
  activeTitle: { fontWeight: "800", color: "#065F46" },
  activeLine: { color: "#065F46", marginTop: 2 },

  profileRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 12, paddingHorizontal: 12,
    backgroundColor: "#F9FAFB", borderRadius: 12,
    borderWidth: 1, borderColor: "#E5E7EB",
    marginBottom: 10,
  },
  profileRowActive: {
    borderColor: "#A7F3D0", backgroundColor: "#F0FDF4",
  },
  profileName: { fontSize: 16, fontWeight: "700", color: "#111827" },
  profileMeta: { fontSize: 13, color: "#6B7280", marginTop: 2 },
  profileGoal: { fontSize: 13, color: "#374151", marginTop: 2 },

  actions: { flexDirection: "row", gap: 8, marginLeft: 10 },
  pillBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1,
  },
  editBtn: { backgroundColor: "#F3F4F6", borderColor: "#E5E7EB" },
  useBtn: { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" },
  delBtn: { backgroundColor: "#FEE2E2", borderColor: "#FECACA" },
  pillText: { fontWeight: "700", fontSize: 12 },
});
