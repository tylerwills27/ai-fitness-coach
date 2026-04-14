// utils/api.js
export const API_BASE_URL = "https://render-golden-attitude-prefer.trycloudflare.com";

export async function pingServer() {
  try {
    const r = await fetch(`${API_BASE_URL}/`);
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// 👉 now accepts tone + history + responseLength ("short"|"normal"|"long")
export async function sendMessage(message, tone = "friendly", history = [], responseLength = "normal") {
  try {
    const res = await fetch(`${API_BASE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, tone, history, responseLength }),
    });
    if (!res.ok) return `Server error (${res.status}). Please try again.`;
    const data = await res.json();
    return data.response || "Sorry, I couldn't get a response.";
  } catch (err) {
    console.error("Error talking to backend:", err);
    return "Error connecting to the AI server.";
  }
}

export async function getPlan(profile) {
  const res = await fetch(`${API_BASE_URL}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
  if (!res.ok) throw new Error(`Plan error ${res.status}`);
  return res.json();
}
