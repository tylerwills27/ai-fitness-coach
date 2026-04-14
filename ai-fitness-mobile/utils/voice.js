// utils/voice.js
// Handles both: audio transcription -> backend, and improved TTS (voice selection + punctuation cleanup)

import * as FileSystem from "expo-file-system/legacy";
import * as Speech from "expo-speech";
import { API_BASE_URL } from "./api";

/* --------------------- TRANSCRIPTION --------------------- */

function guessContentTypeFromUri(uri) {
  const u = (uri || "").toLowerCase();
  if (u.endsWith(".m4a")) return "audio/m4a";
  if (u.endsWith(".mp4")) return "audio/mp4";
  if (u.endsWith(".caf")) return "audio/x-caf";
  if (u.endsWith(".aac")) return "audio/aac";
  if (u.endsWith(".wav")) return "audio/wav";
  return "application/octet-stream";
}

export async function transcribeAudioAsync(uri) {
  if (!uri) throw new Error("No recording URI");

  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    throw new Error(`Recording not found at ${uri}`);
  }

  const type = guessContentTypeFromUri(uri);
  const name = uri.split("/").pop() || "audio.m4a";

  const form = new FormData();
  form.append("file", {
    uri,
    name,
    type,
  });

  try {
    const res = await fetch(`${API_BASE_URL}/transcribe`, {
      method: "POST",
      body: form, // do NOT manually set Content-Type; fetch will add boundary
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn("[voice] /transcribe bad status:", res.status, txt);
      throw new Error(`Transcribe failed: ${res.status}`);
    }

    const data = await res.json();
    const text = String(data?.text || "").trim();
    if (!text) {
      throw new Error("Empty transcript from server");
    }
    return text;
  } catch (err) {
    console.warn("[voice] transcribe error:", err?.message || err);
    throw err;
  }
}

/* --------------------- TTS HELPERS --------------------- */

const QUALITY_HINTS = /(neural|enhanced|premium|siri|studio|high\s*quality|hq)/i;

async function listVoices() {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    return (voices || []).map((v) => ({
      id: v.identifier || v.name,
      name: v.name,
      lang: v.language,
      quality: v.quality || "default",
      raw: v,
    }));
  } catch {
    return [];
  }
}

function scoreVoice(v) {
  let s = 0;
  const label = `${v.name} ${v.id} ${v.quality}`.toLowerCase();
  if (v.quality === "enhanced") s += 5;
  if (QUALITY_HINTS.test(label)) s += 4;
  if (/en[-_](us|gb|ca|au)/i.test(v.lang || "")) s += 2;
  if (/compact|default/.test(label)) s -= 1;
  return s;
}

async function getBestVoice(preferLangs = ["en-US", "en-GB", "en-CA", "en-AU"]) {
  const voices = await listVoices();
  if (!voices.length) return null;

  const preferred = voices.filter((v) => preferLangs.includes(v.lang));
  const pool = preferred.length ? preferred : voices;

  pool.sort((a, b) => scoreVoice(b) - scoreVoice(a));
  return pool[0] || null;
}

export function prepareForTTS(text) {
  if (!text) return "";
  return String(text)
    .replace(/([,;:])(?!\s)/g, "$1 ")
    .replace(/([.?!])(?!\s)/g, "$1 ")
    .replace(/`{1,3}[^`]*`{1,3}/g, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/[•·…]{2,}/g, " ")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * speak(text, opts?)
 * opts: { voiceId?, language?, rate?, pitch?, onDone?, onStopped?, onError? }
 */
export async function speak(text, opts = {}) {
  const msg = prepareForTTS(text);
  const best = await getBestVoice();
  const voiceId = opts.voiceId ?? best?.id;

  return Speech.speak(msg, {
    voice: voiceId,
    language: opts.language ?? best?.lang ?? "en-US",
    rate: opts.rate ?? 0.95,
    pitch: opts.pitch ?? 1.0,
    onDone: opts.onDone,
    onStopped: opts.onStopped,
    onError: opts.onError,
  });
}

/**
 * Optional: if you ever want to show a list of voices in UI
 */
export async function getVoiceOptions(preferLangs = ["en-US", "en-GB", "en-CA", "en-AU"]) {
  const voices = await listVoices();
  const best = await getBestVoice(preferLangs);
  return {
    best,
    voices: voices.sort((a, b) => scoreVoice(b) - scoreVoice(a)),
  };
}
