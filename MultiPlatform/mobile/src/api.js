// Same thin wrapper as the web app's src/api.js, one function per mm_api.py route. The one real
// difference from web: a phone on Expo Go is a SEPARATE device on the wifi, not the same machine as
// the PC running mm_api.py/mm_server.py, so "localhost" would point at the phone itself and fail.
// Set API_BASE to the PC's LAN IP (e.g. http://192.168.1.42:8800) - find it with `ipconfig`/`ifconfig`
// on the PC. Kept as a single constant here, not an env var, since this is a solo dev's own phone
// pointed at their own PC, not a deployed config that needs to vary per build.
export const API_BASE = "192.168.137.237:8800";

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

export const sendMessage = (tid, message) =>
  req(`/threads/${tid}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });

export const fileUrl = (relPath) => `${API_BASE}/files/${relPath}`;

// expo-document-picker gives us { uri, name }, not a browser File, so reading it to base64 is a
// filesystem read instead of api.js's web FileReader version - same {name, data_b64} shape either way,
// which is the exact attachment schema mm_api.py expects.
export async function pickedFileToAttachment(file, FileSystem) {
  const data_b64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
  return { name: file.name, data_b64 };
}
