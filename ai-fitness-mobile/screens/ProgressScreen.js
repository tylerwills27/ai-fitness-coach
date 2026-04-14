import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { openDatabaseAsync } from "expo-sqlite";

export default function ProgressScreen() {
  const [db, setDb] = useState(null);

  // form state
  const [dateStr, setDateStr] = useState(() => new Date().toISOString().slice(0, 10)); // YYYY-MM-DD
  const [weight, setWeight] = useState("");
  const [calories, setCalories] = useState("");
  const [steps, setSteps] = useState("");
  const [workoutDone, setWorkoutDone] = useState(false);
  const [notes, setNotes] = useState("");

  const [entries, setEntries] = useState([]);

  const loadEntries = useCallback(async () => {
    if (!db) return;
    const rows = await db.getAllAsync(
      `SELECT id, date, weight, calories, steps, workout_done, notes
       FROM progress_logs
       ORDER BY date DESC, id DESC
       LIMIT 200;`
    );
    setEntries(rows || []);
  }, [db]);

  useEffect(() => {
    (async () => {
      const database = await openDatabaseAsync("profiles.db");
      setDb(database);
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS progress_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,              -- YYYY-MM-DD
          weight REAL,                     -- lbs (to match your current UI units)
          calories INTEGER,
          steps INTEGER,
          workout_done INTEGER NOT NULL DEFAULT 0,
          notes TEXT
        );
      `);
      await loadEntries();
    })();
  }, [loadEntries]);

  const clearForm = () => {
    setDateStr(new Date().toISOString().slice(0, 10));
    setWeight("");
    setCalories("");
    setSteps("");
    setWorkoutDone(false);
    setNotes("");
  };

  const saveEntry = async () => {
    if (!db) return;
    if (!dateStr) {
      Alert.alert("Missing date", "Please select a date.");
      return;
    }
    try {
      await db.runAsync(
        `INSERT INTO progress_logs (date, weight, calories, steps, workout_done, notes)
         VALUES (?, ?, ?, ?, ?, ?);`,
        [
          dateStr.trim(),
          weight ? Number(weight) : null,
          calories ? Number(calories) : null,
          steps ? Number(steps) : null,
          workoutDone ? 1 : 0,
          notes.trim() || null,
        ]
      );
      clearForm();
      await loadEntries();
      Alert.alert("Saved", "Progress entry added.");
    } catch (e) {
      console.error("saveEntry error:", e);
      Alert.alert("Database Error", "Could not save the entry.");
    }
  };

  const deleteEntry = (id) => {
    Alert.alert("Delete Entry", "Are you sure you want to delete this log?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            if (!db) return;
            await db.runAsync(`DELETE FROM progress_logs WHERE id=?;`, [id]);
            await loadEntries();
          } catch (e) {
            console.error("deleteEntry error:", e);
            Alert.alert("Error", "Could not delete the entry.");
          }
        },
      },
    ]);
  };

  // quick weekly summary (last 7 days)
  const weekly = useMemo(() => {
    const today = new Date();
    const cutoff = new Date(today);
    cutoff.setDate(today.getDate() - 6); // include today + 6 days back

    const withinWeek = entries.filter((e) => {
      const d = new Date(e.date + "T00:00:00");
      return d >= cutoff && d <= today;
    });

    const avg = (arr) =>
      arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0;

    const weights = withinWeek.map((e) => Number(e.weight)).filter((n) => !Number.isNaN(n));
    const steps = withinWeek.map((e) => Number(e.steps)).filter((n) => !Number.isNaN(n));
    const cals = withinWeek.map((e) => Number(e.calories)).filter((n) => !Number.isNaN(n));
    const workouts = withinWeek.filter((e) => e.workout_done === 1).length;

    return {
      entries: withinWeek.length,
      avgWeight: avg(weights),
      avgSteps: avg(steps),
      avgCalories: avg(cals),
      workouts,
      weightsSeries: weights, // for mini chart
      datesSeries: withinWeek.map((e) => e.date),
    };
  }, [entries]);

  // normalize weights for mini bar chart
  const weightBars = useMemo(() => {
    const arr = weekly.weightsSeries || [];
    if (!arr.length) return [];
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const span = Math.max(1, max - min);
    return arr.map((w) => {
      const h = Math.round(((w - min) / span) * 60) + 10; // 10..70 px
      return { height: h, value: w };
    });
  }, [weekly.weightsSeries]);

  const renderItem = ({ item }) => (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>
          {item.date} {item.workout_done ? "• 🏋️‍♂️" : ""}
        </Text>
        <Text style={styles.rowMeta}>
          {item.weight != null ? `Wt ${item.weight} lb` : "Wt —"}  •  {item.calories != null ? `${item.calories} kcal` : "kcal —"}  •  {item.steps != null ? `${item.steps} steps` : "steps —"}
        </Text>
        {item.notes ? <Text style={styles.rowNotes}>{item.notes}</Text> : null}
      </View>
      <TouchableOpacity onPress={() => deleteEntry(item.id)} style={styles.deleteBtn}>
        <Ionicons name="trash" size={18} color="#991B1B" />
      </TouchableOpacity>
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: "padding", android: undefined })}
      style={{ flex: 1, backgroundColor: "#fff" }}
      keyboardVerticalOffset={Platform.select({ ios: 80, android: 0 })}
    >
      <FlatList
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Log Today’s Progress</Text>

            <Text style={styles.label}>Date</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD"
              value={dateStr}
              onChangeText={setDateStr}
              autoCapitalize="none"
            />

            <Text style={styles.label}>Weight (lb)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., 175"
              value={weight}
              onChangeText={setWeight}
              inputMode="numeric"
            />

            <Text style={styles.label}>Calories (kcal)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., 2400"
              value={calories}
              onChangeText={setCalories}
              inputMode="numeric"
            />

            <Text style={styles.label}>Steps</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., 8000"
              value={steps}
              onChangeText={setSteps}
              inputMode="numeric"
            />

            <TouchableOpacity
              style={[styles.checkbox, workoutDone && styles.checkboxOn]}
              onPress={() => setWorkoutDone((v) => !v)}
            >
              <Ionicons
                name={workoutDone ? "checkbox" : "square-outline"}
                size={22}
                color={workoutDone ? "#0B6E4F" : "#6B7280"}
              />
              <Text style={styles.checkboxText}>Workout completed</Text>
            </TouchableOpacity>

            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={[styles.input, { height: 80 }]}
              placeholder="Optional notes…"
              value={notes}
              onChangeText={setNotes}
              multiline
            />

            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <TouchableOpacity style={styles.saveBtn} onPress={saveEntry}>
                <Text style={styles.saveText}>Save Entry</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.clearBtn} onPress={clearForm}>
                <Text style={styles.clearText}>Clear</Text>
              </TouchableOpacity>
            </View>

            {/* Weekly summary */}
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Last 7 Days</Text>
              <Text style={styles.summaryLine}>
                Entries: {weekly.entries}   •   Workouts: {weekly.workouts}
              </Text>
              <Text style={styles.summaryLine}>
                Avg Weight: {weekly.avgWeight || "—"} lb
              </Text>
              <Text style={styles.summaryLine}>
                Avg Calories: {weekly.avgCalories || "—"} kcal
              </Text>
              <Text style={styles.summaryLine}>
                Avg Steps: {weekly.avgSteps || "—"}
              </Text>

              {/* Mini weight bar chart */}
              {weightBars.length > 0 ? (
                <View style={styles.chartWrap}>
                  {weightBars.map((b, i) => (
                    <View key={i} style={[styles.bar, { height: b.height }]} />
                  ))}
                </View>
              ) : (
                <Text style={{ color: "#6B7280", marginTop: 6 }}>Log weights to see a trend.</Text>
              )}
            </View>

            <Text style={[styles.title, { marginTop: 20 }]}>History</Text>
          </View>
        }
        data={entries}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 20, paddingBottom: 28 }}
        ListEmptyComponent={<Text style={{ color: "#6B7280" }}>No entries yet.</Text>}
        keyboardShouldPersistTaps="handled"
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "800", color: "#0B6E4F", marginBottom: 10 },
  label: { fontSize: 14, color: "#374151", marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16,
  },
  checkbox: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  checkboxOn: {},
  checkboxText: { color: "#111827", fontSize: 15 },
  saveBtn: { backgroundColor: "#0B6E4F", paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12 },
  saveText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  clearBtn: {
    backgroundColor: "#F3F4F6", paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12,
    borderWidth: 1, borderColor: "#E5E7EB",
  },
  clearText: { color: "#111827", fontSize: 16, fontWeight: "600" },

  summaryCard: {
    backgroundColor: "#F9FAFB",
    borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12,
    padding: 12, marginTop: 16,
  },
  summaryTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  summaryLine: { marginTop: 4, color: "#374151" },

  chartWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    marginTop: 10,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  bar: {
    width: 10,
    backgroundColor: "#0B6E4F",
    borderRadius: 3,
  },

  row: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    marginBottom: 10,
  },
  rowTitle: { fontSize: 16, fontWeight: "700", color: "#111827" },
  rowMeta: { fontSize: 13, color: "#6B7280", marginTop: 2 },
  rowNotes: { fontSize: 13, color: "#374151", marginTop: 4 },
  deleteBtn: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#FECACA",
  },
});
