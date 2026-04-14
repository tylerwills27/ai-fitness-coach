import React, { useCallback, useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  SafeAreaView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";

import { getPlan } from "../utils/api";
import { getUnits, setUnits } from "../utils/settings";
import { formatHeight, formatWeight } from "../utils/units";
import { requestNotifPermission, scheduleDailyReminder } from "../utils/notify";
import { exportPlanToICS } from "../utils/ics";
import { openDatabaseAsync } from "expo-sqlite";

export default function PlanScreen({ route }) {
  const profile = route?.params?.profile; // {name, age, height_cm, weight_kg, goal, activity}
  const [units, setUnitsState] = useState("imperial");
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);

  // Response-length setting for the Why modal: "short" | "normal" | "long"
  const [whyLen, setWhyLen] = useState("normal");

  // Reminder time picker
  const [reminderTime, setReminderTime] = useState(() => {
    const d = new Date();
    d.setHours(20, 0, 0, 0); // default 8:00 PM
    return d;
  });
  const [showTimePicker, setShowTimePicker] = useState(false);

  // ---- tiny settings helpers (reuse app_settings in profiles.db) ----
  async function getSettingsDB() {
    const db = await openDatabaseAsync("profiles.db");
    await db.execAsync(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT);`);
    return db;
  }

  const loadWhyLen = useCallback(async () => {
    try {
      const db = await getSettingsDB();
      const row = await db.getFirstAsync(`SELECT value FROM app_settings WHERE key='why_resp_len';`);
      if (row?.value) setWhyLen(String(row.value));
    } catch {}
  }, []);

  const saveWhyLen = useCallback(async (val) => {
    try {
      const db = await getSettingsDB();
      await db.runAsync(
        `INSERT INTO app_settings (key, value) VALUES ('why_resp_len', ?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value;`,
        [String(val)]
      );
    } catch {}
  }, []);

  const loadUnits = useCallback(async () => setUnitsState(await getUnits()), []);
  useEffect(() => {
    loadUnits();
    loadWhyLen();
  }, [loadUnits, loadWhyLen]);

  const fetchPlan = async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const normalized = {
        name: profile.name || "You",
        age: Number(profile.age),
        height_cm: Number(profile.height_cm),
        weight_kg: Number(profile.weight_kg),
        goal: profile.goal,
        activity: profile.activity || "moderate",
      };
      const p = await getPlan(normalized);
      setPlan(p);
    } catch (e) {
      Alert.alert("Plan Error", String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleUnits = async () => {
    const next = units === "imperial" ? "metric" : "imperial";
    setUnitsState(next);
    await setUnits(next);
  };

  const askReminder = async () => {
    const ok = await requestNotifPermission();
    if (!ok) {
      Alert.alert("Permission Needed", "Enable notifications in Settings.");
      return;
    }
    // Open the time picker; scheduling happens in onTimePicked
    setShowTimePicker(true);
  };

  const onTimePicked = async (event, selectedDate) => {
    setShowTimePicker(false);
    if (event.type !== "set" || !selectedDate) {
      // user canceled
      return;
    }
    setReminderTime(selectedDate);

    const hour = selectedDate.getHours();
    const minute = selectedDate.getMinutes();

    try {
      await scheduleDailyReminder(hour, minute);
      const pretty = selectedDate.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      });
      Alert.alert("Scheduled", `Daily reminder set for ${pretty}.`);
    } catch (e) {
      Alert.alert("Scheduling Failed", String(e?.message || e));
    }
  };

  const onExportICS = async () => {
    try {
      if (!plan) {
        Alert.alert("No Plan", "Generate a plan first.");
        return;
      }
      await exportPlanToICS(plan, profile?.name || "Your");
    } catch (e) {
      Alert.alert("Export Failed", String(e?.message || e));
    }
  };

  const MacroPill = ({ label, value }) => (
    <View style={styles.pill}>
      <Text style={styles.pillText}>
        {label}: {value}g
      </Text>
    </View>
  );

  // Friendly “Coach Note”
  const coachNote = useMemo(() => {
    if (!plan) return "";
    const kcal = plan.calories_target;
    return `Coach Note: We set your daily target to about ${kcal} kcal. Protein is scaled to your body weight for recovery and lean mass, with fats set for hormones and carbs filling the rest for training energy. Review weekly and adjust if progress stalls.`;
  }, [plan]);

  // ===== Why? modal content with response-length control =====
  const activityFactor = (lvl) =>
    ({ sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 }[lvl] ?? 1.55);

  const bmrMifflin = (age, height_cm, weight_kg, male = true) =>
    10 * weight_kg + 6.25 * height_cm - 5 * age + (male ? 5 : -161);

  const whyText = useMemo(() => {
    if (!plan || !profile) return { title: "", body: "" };

    const act = activityFactor(profile.activity || "moderate");
    const bmr = Math.round(bmrMifflin(profile.age, profile.height_cm, profile.weight_kg, true));
    const tdee = Math.round(bmr * act);
    const kcal = plan.calories_target;
    const { protein = 0, carbs = 0, fat = 0 } = plan.macros_g || {};
    const proteinPerKg = (protein / Math.max(1, profile.weight_kg)).toFixed(1);

    if (whyLen === "short") {
      return {
        title: "Why (Short)",
        body:
          `BMR ≈ ${bmr} → TDEE ≈ ${tdee}. ` +
          `Goal-adjusted target = ${kcal} kcal. ` +
          `Protein ≈ ${proteinPerKg} g/kg; fats ~25–30% kcal; carbs fill the rest.`,
      };
    }

    if (whyLen === "long") {
      return {
        title: "Why (Detailed)",
        body:
          `We used the Mifflin–St Jeor equation to estimate your basal metabolic rate (BMR ≈ ${bmr}). ` +
          `Multiplying by your activity factor (${act.toFixed(2)}) gives TDEE ≈ ${tdee}. ` +
          `From there we adjusted calories for your goal (“${String(profile.goal).replace("_", " ")}”), landing at ~${kcal} kcal/day.\n\n` +
          `Macros are set to support training and recovery:\n` +
          `• Protein: ${protein} g (~${proteinPerKg} g/kg) for muscle retention/gain.\n` +
          `• Fat: ${fat} g (≈25–30% of calories) for hormones and satiety.\n` +
          `• Carbs: ${carbs} g to fuel training; remainder of calories after protein/fat.\n\n` +
          `Weekly review: if weight or performance isn’t trending as expected after 1–2 weeks, adjust by ~150–200 kcal and re-evaluate.`,
      };
    }

    // normal
    return {
      title: "Why (Normal)",
      body:
        `We estimate your energy needs with Mifflin–St Jeor to get BMR (≈ ${bmr}), ` +
        `multiply by an activity factor (${act.toFixed(2)}) for TDEE (≈ ${tdee}), ` +
        `then adjust calories for your goal to ~${kcal} kcal/day. ` +
        `Protein is scaled to body weight (≈ ${proteinPerKg} g/kg). Remaining calories split across carbs and fats.`,
    };
  }, [plan, profile, whyLen]);

  const onPickWhyLen = async (len) => {
    setWhyLen(len);
    await saveWhyLen(len);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      {/* Scrollable content */}
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator>
        <View style={styles.headerRow}>
          <Text style={styles.header}>Your Plan</Text>

          <TouchableOpacity onPress={toggleUnits} style={styles.smallBtn}>
            <Ionicons name="swap-horizontal" size={14} color="#fff" />
            <Text style={styles.smallBtnText}>{units === "imperial" ? "Imperial" : "Metric"}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setWhyOpen(true)}
            style={[styles.smallBtn, { backgroundColor: "#0ea5e9" }]}
          >
            <Ionicons name="information-circle" size={14} color="#fff" />
            <Text style={styles.smallBtnText}>Why?</Text>
          </TouchableOpacity>
        </View>

        {/* Profile summary */}
        <View style={styles.card}>
          <Text style={styles.title}>{profile?.name || "You"}</Text>
          <Text style={styles.meta}>
            Age {profile?.age} · {formatHeight(profile?.height_cm, units)} ·{" "}
            {formatWeight(profile?.weight_kg, units)}
          </Text>
          <Text style={styles.meta}>Goal: {String(profile?.goal || "").replace("_", " ")}</Text>
        </View>

        {/* Plan */}
        {loading ? (
          <ActivityIndicator style={{ marginTop: 12 }} />
        ) : plan ? (
          <>
            {/* Targets */}
            <View style={styles.card}>
              <Text style={styles.title}>Targets</Text>
              <Text style={styles.value}>{plan.calories_target} kcal/day</Text>
              <View style={styles.pillsRow}>
                <MacroPill label="Protein" value={plan.macros_g.protein} />
                <MacroPill label="Carbs" value={plan.macros_g.carbs} />
                <MacroPill label="Fat" value={plan.macros_g.fat} />
              </View>

              {/* Friendly summary */}
              <Text style={styles.coachNote}>{coachNote}</Text>

              <Text style={styles.rationaleLabel}>Details</Text>
              <Text style={styles.rationale}>{plan.rationale}</Text>
            </View>

            {/* Meals */}
            {Array.isArray(plan.sample_meal_plan) && plan.sample_meal_plan.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.title}>Meals</Text>
                {plan.sample_meal_plan.map((meal, idx) => (
                  <View key={idx} style={styles.mealBlock}>
                    <View style={styles.mealHeaderRow}>
                      <Text style={styles.mealName}>{meal.name}</Text>
                      <Text style={styles.mealCalories}>{meal.calories} kcal</Text>
                    </View>
                    {Array.isArray(meal.items) &&
                      meal.items.map((item, j) => (
                        <Text key={j} style={styles.mealItem}>
                          • {item}
                        </Text>
                      ))}
                  </View>
                ))}
              </View>
            )}

            {/* Workouts */}
            <View style={styles.card}>
              <Text style={styles.title}>Workouts</Text>
              {plan.workout_plan.map((w, idx) => (
                <View key={idx} style={styles.block}>
                  <Text style={styles.blockTitle}>
                    {w.day} · {w.focus}
                  </Text>
                  <Text style={styles.blockList}>• {w.exercises.join("\n• ")}</Text>
                </View>
              ))}
            </View>

            {/* Actions */}
            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: "#0B6E4F" }]}
                onPress={onExportICS}
              >
                <Ionicons name="calendar" size={16} color="#fff" />
                <Text style={styles.actionText}>Add to Calendar (.ics)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: "#f59e0b" }]}
                onPress={askReminder}
              >
                <Ionicons name="notifications" size={16} color="#fff" />
                <Text style={styles.actionText}>Daily Reminder</Text>
              </TouchableOpacity>
            </View>

            {/* Spacer so last buttons aren’t clipped */}
            <View style={{ height: 24 }} />
          </>
        ) : (
          <Text style={{ color: "#6B7280", marginTop: 12 }}>No plan yet.</Text>
        )}
      </ScrollView>

      {/* Time picker for reminder */}
      {showTimePicker && (
        <DateTimePicker
          mode="time"
          value={reminderTime}
          is24Hour={false}
          display="default"
          onChange={onTimePicked}
        />
      )}

      {/* Why modal with response-length control */}
      <Modal
        visible={whyOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setWhyOpen(false)}
      >
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ fontSize: 16, fontWeight: "800", flex: 1 }}>{whyText.title}</Text>
              <TouchableOpacity onPress={() => setWhyOpen(false)}>
                <Ionicons name="close" size={22} />
              </TouchableOpacity>
            </View>

            {/* Length chips */}
            <View style={styles.lenRow}>
              <Text style={{ color: "#374151", marginRight: 6, fontSize: 12 }}>
                Response length:
              </Text>
              <LenChip onPress={() => onPickWhyLen("short")} active={whyLen === "short"} label="Short" />
              <LenChip onPress={() => onPickWhyLen("normal")} active={whyLen === "normal"} label="Normal" />
              <LenChip onPress={() => onPickWhyLen("long")} active={whyLen === "long"} label="Long" />
            </View>

            <ScrollView style={{ marginTop: 8 }}>
              <Text style={styles.whyText}>{whyText.body}</Text>
              {whyLen !== "short" && (
                <Text style={[styles.whyText, { marginTop: 10 }]}>
                  Macros/day — Protein: {plan?.macros_g?.protein} g · Carbs: {plan?.macros_g?.carbs} g · Fat:{" "}
                  {plan?.macros_g?.fat} g
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function LenChip({ label, active, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.lenChip, active && styles.lenChipActive]}>
      <Text style={[styles.lenChipText, active && styles.lenChipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  scrollContent: { padding: 16, paddingBottom: 28 },

  headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  header: { fontSize: 22, fontWeight: "800", color: "#0B6E4F", flex: 1 },
  smallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#10b981",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  smallBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },

  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 14,
    marginTop: 12,
  },
  title: { fontSize: 16, fontWeight: "800", color: "#111827" },
  meta: { color: "#6B7280", marginTop: 2 },
  value: { fontSize: 22, fontWeight: "800", color: "#0B6E4F", marginTop: 6 },

  pillsRow: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" },
  pill: {
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  pillText: { color: "#065F46", fontWeight: "700", fontSize: 12 },

  coachNote: {
    marginTop: 10,
    color: "#065F46",
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    lineHeight: 20,
  },

  rationaleLabel: { marginTop: 10, fontWeight: "800", color: "#111827" },
  rationale: { color: "#374151", marginTop: 4, lineHeight: 20 },

  // Meals
  mealBlock: {
    marginTop: 10,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  mealHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  mealName: {
    fontWeight: "800",
    color: "#111827",
    fontSize: 14,
  },
  mealCalories: {
    fontWeight: "700",
    color: "#6B7280",
    fontSize: 12,
  },
  mealItem: {
    color: "#374151",
    lineHeight: 20,
  },

  block: { marginTop: 10 },
  blockTitle: { fontWeight: "800", color: "#111827" },
  blockList: { color: "#374151", marginTop: 4, lineHeight: 20 },

  actionsRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  actionText: { color: "#fff", fontWeight: "700" },

  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: "#fff", borderRadius: 12, padding: 14, maxHeight: "70%" },

  lenRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  lenChip: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#FFFFFF",
  },
  lenChipActive: { backgroundColor: "#DCFCE7", borderColor: "#A7F3D0" },
  lenChipText: { color: "#111827", fontSize: 12, fontWeight: "700" },
  lenChipTextActive: { color: "#065F46" },

  whyText: { color: "#374151", lineHeight: 20 },
});
