import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, FlatList, Modal, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Speech from "expo-speech";
import * as FileSystem from "expo-file-system/legacy";
import {
  useAudioRecorder, RecordingPresets, AudioModule,
  setAudioModeAsync, useAudioRecorderState,
} from "expo-audio";
import { openDatabaseAsync } from "expo-sqlite";

import { API_BASE_URL, sendMessage, pingServer } from "../utils/api";
import { transcribeAudioAsync, speak as speakNatural } from "../utils/voice";
import { addMessage, getMessages, clearMessages } from "../utils/chatStore";
import { getTTSRate, setTTSRate, getTTSVoice, setTTSVoice } from "../utils/settings";

// Tone options
const TONES = [
  { key: "motivational", label: "Motivational" },
  { key: "friendly",     label: "Friendly" },
  { key: "drill",        label: "Drill" },
  { key: "educator",     label: "Educator" },
];

// ---- simple settings helpers ----
async function getSettingsDB() {
  const db = await openDatabaseAsync("profiles.db");
  await db.execAsync(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT);`);
  return db;
}
async function getSetting(key, fallback = "") {
  try {
    const db = await getSettingsDB();
    const row = await db.getFirstAsync(`SELECT value FROM app_settings WHERE key=?;`, [key]);
    return (row?.value ?? fallback);
  } catch { return fallback; }
}
async function setSetting(key, value) {
  const db = await getSettingsDB();
  await db.runAsync(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value;`,
    [String(key), String(value)]
  );
}

function toApiHistory(rows, maxTurns = 12) {
  const last = rows.slice(-maxTurns);
  return last.map((r) => ({
    role: r.role === "assistant" ? "assistant" : "user",
    content: String(r.text || ""),
  }));
}

function VUMeter({ level = 0, isActive = false }) {
  const bars = 12;
  const activeBars = Math.max(0, Math.min(bars, Math.round(level * bars)));
  return (
    <View style={styles.vuWrap}>
      {Array.from({ length: bars }).map((_, i) => {
        const filled = i < activeBars && isActive;
        return <View key={`bar-${i}`} style={[styles.vuBar, filled ? styles.vuBarOn : styles.vuBarOff]} />;
      })}
    </View>
  );
}

export default function ChatbotScreen() {
  const [text, setText] = useState("");
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [serverOK, setServerOK] = useState(null);

  // Tone + response length
  const [tone, setTone] = useState("friendly");
  const [respLen, setRespLen] = useState("normal"); // "short" | "normal" | "long"

  // TTS controls
  const [voices, setVoices] = useState([]);
  const [voiceId, setVoiceId] = useState("");
  const [rate, setRate] = useState(1.0);
  const [voiceModal, setVoiceModal] = useState(false);

  // TTS state
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Recorder
  const [micGranted, setMicGranted] = useState(false);
  const [recBusy, setRecBusy] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder);

  // VU
  const [vu, setVu] = useState(0);
  const vuTimerRef = useRef(null);
  const listRef = useRef(null);

  const loadHistory = useCallback(async () => {
    const rows = await getMessages(1000);
    setHistory(rows);
    setTimeout(() => listRef.current?.scrollToEnd?.({ animated: false }), 40);
  }, []);

  const loadToneAndLength = useCallback(async () => {
    const [t, l] = await Promise.all([
      getSetting("coach_tone", "friendly"),
      getSetting("coach_resp_len", "normal"),
    ]);
    setTone(String(t || "friendly"));
    setRespLen(String(l || "normal"));
  }, []);

  const loadVoices = useCallback(async () => {
    try {
      const v = await Speech.getAvailableVoicesAsync();
      setVoices(Array.isArray(v) ? v : []);
    } catch { setVoices([]); }
  }, []);

  const loadTTSSettings = useCallback(async () => {
    const [r, v] = await Promise.all([getTTSRate(), getTTSVoice()]);
    setRate(Number(r || 1.0));
    setVoiceId(String(v || ""));
  }, []);

  useEffect(() => {
    loadHistory();
    loadToneAndLength();
    loadVoices();
    loadTTSSettings();
    (async () => {
      const res = await pingServer();
      setServerOK(res.ok);
    })();
  }, [loadHistory, loadToneAndLength, loadVoices, loadTTSSettings]);

  const appendLocal = (role, txt) => {
    const row = { id: `tmp-${Date.now()}`, role, text: String(txt ?? ""), created_at: Date.now() };
    setHistory((h) => [...h, row]);
    addMessage(role, txt).then(loadHistory).catch(() => {});
  };

  // Improved natural TTS
  const speak = async (s) => {
    try {
      setIsSpeaking(true);
      await speakNatural(s, {
        voiceId: voiceId || undefined,
        language: "en-US",
        rate: Math.max(0.5, Math.min(2.0, rate)),
        onDone: () => setIsSpeaking(false),
        onStopped: () => setIsSpeaking(false),
        onError: () => setIsSpeaking(false),
      });
    } catch {
      setIsSpeaking(false);
    }
  };

  const stopSpeaking = async () => {
    try {
      await Speech.stop();
    } finally {
      setIsSpeaking(false);
    }
  };

  const confirmClear = () => {
    Alert.alert("Clear Conversation", "Delete all messages?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: async () => {
          await clearMessages();
          setHistory([]);
        },
      },
    ]);
  };

  const onSelectTone = async (value) => {
    setTone(value);
    await setSetting("coach_tone", value);
  };
  const onSelectRespLen = async (value) => {
    setRespLen(value);
    await setSetting("coach_resp_len", value);
  };

  const sendText = async (msg) => {
    const clean = (msg || "").trim();
    if (!clean) return;
    setText("");
    setLoading(true);
    try {
      appendLocal("user", clean);
      const reply = await sendMessage(clean, tone, toApiHistory(history), respLen);
      appendLocal("assistant", reply);
      await speak(reply);
    } catch {
      appendLocal("system", "Error talking to server.");
    } finally {
      setLoading(false);
    }
  };

  // Mic helpers
  const requestMic = async () => {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setMicGranted(false);
      Alert.alert("Microphone Needed", "Grant microphone access in Settings → Privacy → Microphone.");
      return;
    }
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    setMicGranted(true);
  };

  const prepareRecorderAsync = async () => {
    try {
      await recorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY, { isMeteringEnabled: true });
    } catch {
      await recorder.prepareToRecordAsync();
    }
  };

  const startVUPolling = () => {
    stopVUPolling();
    vuTimerRef.current = setInterval(async () => {
      try {
        const status = (await recorder.getStatusAsync?.()) || (await recorder.getStatus?.()) || null;
        const raw = status && (status.metering ?? status.meteringLevel ?? status.peakPower);
        let level = 0;
        if (typeof raw === "number") {
          if (raw <= 0 && raw >= -120) {
            const min = -60, max = 0;
            const clamped = Math.max(min, Math.min(max, raw));
            level = (clamped - min) / (max - min);
          } else {
            level = Math.max(0, Math.min(1, raw));
          }
        } else {
          level = 0.35 + 0.25 * Math.abs(Math.sin(Date.now() / 250));
        }
        setVu(level);
      } catch {
        setVu(0.35 + 0.25 * Math.abs(Math.sin(Date.now() / 250)));
      }
    }, 80);
  };

  const stopVUPolling = () => {
    if (vuTimerRef.current) {
      clearInterval(vuTimerRef.current);
      vuTimerRef.current = null;
    }
    setVu(0);
  };

  const startVoice = async () => {
    try {
      if (!micGranted) {
        await requestMic();
        if (!micGranted) return;
      }
      setRecBusy(true);
      await prepareRecorderAsync();
      recorder.record();
      startVUPolling();
    } catch {
      setRecBusy(false);
      stopVUPolling();
    }
  };

  const stopVoice = async () => {
    try {
      if (!recState.isRecording) return;

      await recorder.stop();
      stopVUPolling();

      let uri = recorder.uri;
      if (!uri && typeof recorder.getURI === "function") {
        try {
          uri = await recorder.getURI();
        } catch {
          // ignore
        }
      }

      if (uri) {
        try {
          const info = await FileSystem.getInfoAsync(uri);
          if (!info?.exists) {
            console.warn("[voice] Recorded file not found at URI:", uri);
            uri = "";
          }
        } catch (e) {
          console.warn("[voice] getInfoAsync error:", e?.message || e);
        }
      }

      if (!uri) {
        setRecBusy(false);
        console.warn("[voice] No recording URI after stop()");
        return;
      }

      setLoading(true);
      const transcript = await transcribeAudioAsync(uri);
      appendLocal("user", transcript);

      const reply = await sendMessage(transcript, tone, toApiHistory(history), respLen);
      appendLocal("assistant", reply);
      await speak(reply);
    } catch (e) {
      console.warn("[voice] stopVoice error:", e?.message || e);
      appendLocal("system", "Voice transcription failed.");
    } finally {
      setLoading(false);
      setRecBusy(false);
    }
  };

  useEffect(() => {
    return () => stopVUPolling();
  }, []);

  const renderItem = ({ item }) => (
    <View
      style={[
        styles.bubble,
        item.role === "user"
          ? styles.bubbleUser
          : item.role === "assistant"
          ? styles.bubbleAI
          : styles.bubbleSys,
      ]}
    >
      <Text style={styles.bubbleText}>{item.text}</Text>
    </View>
  );

  const changeRate = async (delta) => {
    const next = Math.max(0.5, Math.min(2.0, Number(rate) + delta));
    setRate(next);
    await setTTSRate(next);
  };

  const selectVoice = async (id) => {
    setVoiceId(id);
    await setTTSVoice(id);
    setVoiceModal(false);
  };

  const testVoice = () => {
    stopSpeaking();
    setTimeout(() => {
      speak("This is your selected coach voice.");
    }, 50);
  };

  const sendDisabled = loading || !text.trim();

  const Chip = ({ active, label, onPress }) => (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header row */}
      <View style={styles.headerRow}>
        <Text style={styles.header}>AI Chatbot 🎙️</Text>
        <TouchableOpacity style={styles.clearBtn} onPress={confirmClear}>
          <Ionicons name="trash" size={16} color="#991B1B" />
          <Text style={styles.clearBtnText}>Clear</Text>
        </TouchableOpacity>
      </View>

      {/* Tone chips */}
      <View style={styles.toneRow}>
        {TONES.map((t) => (
          <Chip key={t.key} label={t.label} active={tone === t.key} onPress={() => onSelectTone(t.key)} />
        ))}
      </View>

      {/* Response length chips */}
      <View style={styles.toneRow}>
        <Text style={{ color: "#374151", marginRight: 6, fontSize: 12 }}>Response length:</Text>
        <Chip label="Short"  active={respLen === "short"}  onPress={() => onSelectRespLen("short")} />
        <Chip label="Normal" active={respLen === "normal"} onPress={() => onSelectRespLen("normal")} />
        <Chip label="Long"   active={respLen === "long"}   onPress={() => onSelectRespLen("long")} />
      </View>

      {/* Backend status */}
      <Text style={styles.apiLine}>API: {API_BASE_URL}</Text>
      {serverOK === false ? (
        <View style={styles.bannerBad}>
          <Ionicons name="cloud-offline" size={16} color="#991B1B" />
          <Text style={styles.bannerText}>Backend unreachable.</Text>
        </View>
      ) : serverOK === true ? (
        <View style={styles.bannerGood}>
          <Ionicons name="cloud-done" size={16} color="#065F46" />
          <Text style={styles.bannerText}>Backend OK</Text>
        </View>
      ) : null}

      {/* TTS controls */}
      <View style={styles.ttsRow}>
        <Text style={styles.ttsLabel}>Voice</Text>
        <TouchableOpacity style={styles.smallBtn} onPress={() => setVoiceModal(true)}>
          <Ionicons name="musical-notes" size={14} color="#fff" />
          <Text style={styles.smallBtnText}>{voiceId ? "Change" : "Choose"}</Text>
        </TouchableOpacity>

        <Text style={[styles.ttsLabel, { marginLeft: 10 }]}>Rate</Text>
        <TouchableOpacity style={styles.rateBtn} onPress={() => changeRate(-0.1)}>
          <Text style={styles.rateText}>–</Text>
        </TouchableOpacity>
        <Text style={styles.rateValue}>{rate.toFixed(1)}</Text>
        <TouchableOpacity style={styles.rateBtn} onPress={() => changeRate(+0.1)}>
          <Text style={styles.rateText}>+</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.smallBtn, { marginLeft: 8, backgroundColor: "#10b981" }]}
          onPress={testVoice}
        >
          <Ionicons name="play" size={14} color="#fff" />
          <Text style={styles.smallBtnText}>Test</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.smallBtn,
            { backgroundColor: "#ef4444", marginLeft: 6, opacity: isSpeaking ? 1 : 0.7 },
          ]}
          onPress={stopSpeaking}
          disabled={!isSpeaking}
        >
          <Ionicons name="stop-circle" size={14} color="#fff" />
          <Text style={styles.smallBtnText}>Stop Voice</Text>
        </TouchableOpacity>
      </View>

      {/* Voice picker modal */}
      <Modal
        visible={voiceModal}
        animationType="slide"
        transparent
        onRequestClose={() => setVoiceModal(false)}
      >
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ fontSize: 16, fontWeight: "800", flex: 1 }}>Choose a Voice</Text>
              <TouchableOpacity onPress={() => setVoiceModal(false)}>
                <Ionicons name="close" size={22} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ marginTop: 10 }}>
              {voices.map((v) => (
                <TouchableOpacity
                  key={v.identifier}
                  onPress={() => selectVoice(v.identifier)}
                  style={styles.voiceRow}
                >
                  <Text style={styles.voiceName}>{v.name || v.identifier}</Text>
                  <Text style={styles.voiceMeta}>
                    {[v.language, v.quality].filter(Boolean).join(" · ")}
                  </Text>
                </TouchableOpacity>
              ))}
              {!voices.length && (
                <Text style={{ color: "#6B7280" }}>No voices reported by device.</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Chat list */}
      <FlatList
        ref={listRef}
        data={history}
        renderItem={renderItem}
        keyExtractor={(item, idx) => String(item.id ?? idx)}
        contentContainerStyle={{ paddingVertical: 8 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd?.({ animated: true })}
      />
      {loading ? <ActivityIndicator style={{ marginBottom: 8 }} /> : null}

      {/* VU + controls */}
      <View style={styles.vuRow}>
        <VUMeter level={vu} isActive={recState.isRecording} />
        <Text style={styles.vuLabel}>{recState.isRecording ? "Listening…" : "Mic idle"}</Text>
      </View>

      {/* Input row */}
      <View style={styles.inputRow}>
        <TouchableOpacity
          onPressIn={startVoice}
          onPressOut={stopVoice}
          disabled={recBusy}
          style={[
            styles.micBtn,
            recState.isRecording && { backgroundColor: "#ef4444" },
            recBusy && { opacity: 0.6 },
          ]}
        >
          <Ionicons
            name={recState.isRecording ? "mic" : "mic-outline"}
            size={22}
            color="#fff"
          />
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          placeholder="Type a message… or hold the mic"
          value={text}
          onChangeText={setText}
          editable={!loading}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, sendDisabled && { opacity: 0.5 }]}
          onPress={() => sendText(text)}
          disabled={sendDisabled}
        >
          <Ionicons name="send" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      <Text style={styles.hint}>
        Pick a coach style and response length. Hold mic to talk.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#fff" },

  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  header: { fontSize: 20, fontWeight: "800", color: "#0B6E4F", flex: 1 },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#FECACA",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  clearBtnText: { color: "#991B1B", fontWeight: "700", fontSize: 12 },

  toneRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  chip: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#FFFFFF",
  },
  chipActive: { backgroundColor: "#DCFCE7", borderColor: "#A7F3D0" },
  chipText: { color: "#111827", fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: "#065F46" },

  apiLine: { fontSize: 12, color: "#6B7280", marginBottom: 6 },
  bannerBad: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#FECACA",
    marginBottom: 6,
  },
  bannerGood: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    marginBottom: 6,
  },
  bannerText: { fontSize: 12, color: "#111827" },

  ttsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    flexWrap: "wrap",
    gap: 6,
  },
  ttsLabel: { fontSize: 12, color: "#374151" },
  smallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#0ea5e9",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  smallBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  rateBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
  },
  rateText: { fontSize: 16, fontWeight: "800", color: "#111827" },
  rateValue: { width: 34, textAlign: "center", fontWeight: "700", color: "#111827" },

  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: { backgroundColor: "#fff", borderRadius: 12, padding: 14, maxHeight: "70%" },
  voiceRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  voiceName: { fontWeight: "700", color: "#111827" },
  voiceMeta: { color: "#6B7280", fontSize: 12, marginTop: 2 },

  bubble: { padding: 10, borderRadius: 12, marginVertical: 6, maxWidth: "90%" },
  bubbleUser: { alignSelf: "flex-end", backgroundColor: "#DCFCE7" },
  bubbleAI: { alignSelf: "flex-start", backgroundColor: "#E5E7EB" },
  bubbleSys: { alignSelf: "center", backgroundColor: "#FEF3C7" },
  bubbleText: { color: "#111827", fontSize: 15 },

  vuRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8, marginTop: 6 },
  vuWrap: {
    flexDirection: "row",
    gap: 3,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  vuBar: { width: 6, height: 18, borderRadius: 4 },
  vuBarOn: { backgroundColor: "#10b981" },
  vuBarOff: { backgroundColor: "#D1D5DB" },
  vuLabel: { color: "#6B7280", fontSize: 13 },

  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  micBtn: { backgroundColor: "#0ea5e9", padding: 12, borderRadius: 999, opacity: 1.0 },
  sendBtn: { backgroundColor: "#0B6E4F", padding: 12, borderRadius: 999, opacity: 1.0 },
  hint: { textAlign: "center", color: "#6B7280", marginTop: 6 },
});
