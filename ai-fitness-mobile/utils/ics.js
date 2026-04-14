// utils/ics.js
import * as FileSystem from "expo-file-system/legacy"; // ✅ use legacy API
import * as Sharing from "expo-sharing";

function dtstamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = date.getUTCFullYear();
  const m = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const h = pad(date.getUTCHours());
  const min = pad(date.getUTCMinutes());
  const s = pad(date.getUTCSeconds());
  return `${y}${m}${d}T${h}${min}${s}Z`;
}

function escapeICS(s) {
  return String(s)
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\n/g, "\\n");
}

export async function exportPlanToICS(plan, profileName = "Workout Plan") {
  if (!plan || !Array.isArray(plan.workout_plan) || plan.workout_plan.length === 0) {
    throw new Error("No workout blocks in plan.");
  }

  const now = new Date();
  const uidBase = now.getTime();
  const events = [];

  const blocks = plan.workout_plan;

  for (let i = 0; i < 7; i++) {
    const block = blocks[i % blocks.length];
    const start = new Date();
    start.setDate(now.getDate() + i);
    start.setHours(18, 0, 0, 0);
    const end = new Date(start.getTime() + 45 * 60 * 1000);

    const summary = `Workout: ${block.focus}`;
    const description = `Exercises:\\n- ${block.exercises.join("\\n- ")}`;

    events.push([
      "BEGIN:VEVENT",
      `UID:${uidBase}-${i}@ai-coach`,
      `DTSTAMP:${dtstamp(now)}`,
      `DTSTART:${dtstamp(start)}`,
      `DTEND:${dtstamp(end)}`,
      `SUMMARY:${escapeICS(summary)}`,
      `DESCRIPTION:${description}`,
      "END:VEVENT",
    ].join("\n"));
  }

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AI Fitness Coach//EN",
    ...events,
    "END:VCALENDAR",
  ].join("\n");

  // ✅ write using legacy API default UTF-8
  const fileUri = (FileSystem.cacheDirectory || FileSystem.documentDirectory) + "workouts.ics";
  await FileSystem.writeAsStringAsync(fileUri, ics);

  try {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUri, {
        mimeType: "text/calendar",
        dialogTitle: `${profileName} Workouts`,
        UTI: "public.ics",
      });
    }
  } catch (e) {
    console.warn("Sharing failed:", e);
  }

  return fileUri;
}
