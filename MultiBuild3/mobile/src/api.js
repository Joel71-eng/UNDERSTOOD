// Same thin wrapper as the web app's src/api.js, one function per mm_api.py route. The one real
// difference from web: a phone on Expo Go is a SEPARATE device on the wifi, not the same machine as
// the PC running mm_api.py/mm_server.py, so "localhost" would point at the phone itself and fail.
//
// This used to be a hardcoded constant the student had to hand-edit in source before every run - that
// broke in practice: a URL typed without "http://" crashed deep inside React Native's networking layer
// with an opaque "MalformedURLException: no protocol" error that gives no hint what's wrong. Now it's
// a runtime setting (see Settings.js / App.js's gear icon), persisted in AsyncStorage, normalized here
// so a missing protocol can never reach fetch() in the first place - this mirrors mm_app.py's hidden
// admin "Service address" field, just made visible since a phone has no ?admin=1 query param to hide
// it behind.
let _apiBase = "http://192.168.137.1:8800"; // placeholder until setApiBase() runs at startup

export function normalizeServerUrl(raw) {
  let u = (raw || "").trim().replace(/\/+$/, "");
  if (u && !/^https?:\/\//i.test(u)) u = "http://" + u; // the exact mistake that caused the crash
  return u;
}

export function getApiBase() {
  return _apiBase;
}

export function setApiBase(raw) {
  _apiBase = normalizeServerUrl(raw);
  return _apiBase;
}

async function req(path, opts) {
  const r = await fetch(_apiBase + path, opts);
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

export const fileUrl = (relPath) => `${_apiBase}/files/${relPath}`;

// expo-document-picker gives us { uri, name }, not a browser File, so reading it to base64 is a
// filesystem read instead of api.js's web FileReader version - same {name, data_b64} shape either way,
// which is the exact attachment schema mm_api.py expects.
//
// IMPORTANT: this does NOT read file.uri directly, even though DocumentPicker is asked to copy the
// pick into the app's cache (copyToCacheDirectory - see App.js's handlePickFile). That copy is a known,
// long-standing Expo Go bug on Android: the picker's own copy frequently isn't flushed/readable yet
// when the promise resolves, throwing "Location ... isn't readable" (IOException) - see
// https://github.com/expo/expo/issues/21792. Reporters there confirm it's specific to Expo Go
// (not standalone/EAS builds) and the fix is to skip the picker's copy and do our own into a
// subdirectory we control, which is what this does.
export async function pickedFileToAttachment(file, FileSystem) {
  const dir = FileSystem.cacheDirectory + "understood_uploads/";
  if (!(await FileSystem.getInfoAsync(dir)).exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  const dest = dir + Date.now() + "_" + file.name;
  await FileSystem.copyAsync({ from: file.uri, to: dest });
  const data_b64 = await FileSystem.readAsStringAsync(dest, { encoding: FileSystem.EncodingType.Base64 });
  return { name: file.name, data_b64 };
}
