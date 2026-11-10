// Thin fetch wrapper over mm_api.py. One function per route - nothing clever, so it stays obvious
// which backend call each UI action makes.
export const API_BASE = "http://localhost:8800";

async function req(path, opts) {
  const r = await fetch(API_BASE + path, opts);
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`${r.status} ${path}: ${body}`);
  }
  return r.json();
}

export const createThread = () => req("/threads", { method: "POST" });
export const listThreads = () => req("/threads");
export const getChat = (tid) => req(`/threads/${tid}/chat`);
export const getState = (tid) => req(`/threads/${tid}/state`);
export const getStatus = (tid) => req(`/threads/${tid}/status`);
export const cancelThread = (tid) => req(`/threads/${tid}/cancel`, { method: "POST" });
export const resumeThread = (tid) => req(`/threads/${tid}/resume`, { method: "POST" });
export const keepThread = (tid, on) =>
  req(`/threads/${tid}/keep`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }) });
export const deleteThread = (tid) => req(`/threads/${tid}`, { method: "DELETE" });
export const getMeta = () => req("/meta");

export const sendMessage = (tid, message) =>
  req(`/threads/${tid}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });

// File -> {name, data_b64}, the exact attachment shape mm_api.py (and mm_app.py before it) expects.
export function fileToAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result.split(",")[1]; // strip the "data:<mime>;base64," prefix
      resolve({ name: file.name, data_b64: b64 });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export const fileUrl = (relPath) => `${API_BASE}/files/${relPath}`;
