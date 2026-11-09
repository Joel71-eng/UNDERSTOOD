// Offline support for the mobile app. Two things get cached locally so the student can keep reading
// after a lesson even with no signal (a real constraint for this project - see profile: intermittent
// connectivity, load shedding):
//   1. The chat transcript itself (AsyncStorage - small, text-only, fine as JSON).
//   2. Every image/process-JSON file the chat references (expo-file-system - these are the actual
//      diagrams/step pictures, which is most of what a student re-reads).
// Both are "cache on first view, read from cache on next launch" - there is no separate "download for
// offline" action, which would be more UI than a solo-use study app needs; just opening a lesson once
// while online is enough to make it available later.
import AsyncStorage from "@react-native-async-storage/async-storage";
// "/legacy" because this file uses the old function-style API (downloadAsync, getInfoAsync,
// makeDirectoryAsync, readAsStringAsync, writeAsStringAsync) - SDK 52+ moved the default export to a
// new File/Directory class API, but the old calls are still fully supported from this import path.
import * as FileSystem from "expo-file-system/legacy";

const CACHE_DIR = FileSystem.documentDirectory + "understood_cache/";

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
}

// A relPath like "images/diagram_ab12.png" becomes a flat, filesystem-safe name while keeping the
// extension, since some RN image handling still peeks at it.
function slugFor(relPath) {
  const clean = String(relPath).split("?")[0];
  const ext = (clean.split(".").pop() || "bin").slice(0, 8);
  const safe = clean.replace(/[^a-zA-Z0-9]/g, "_");
  return `${safe}.${ext}`;
}

export async function getCachedFile(relPath) {
  const localUri = CACHE_DIR + slugFor(relPath);
  const info = await FileSystem.getInfoAsync(localUri);
  return info.exists ? localUri : null;
}

// Downloads a remote file into local storage if it isn't already cached. Fire-and-forget safe: on any
// failure (offline, 404, disk full) it resolves to null rather than throwing, since this is always a
// "nice to have for next time" call, never on the critical path for showing something right now.
export async function cacheFile(remoteUrl, relPath) {
  await ensureDir();
  const localUri = CACHE_DIR + slugFor(relPath);
  const info = await FileSystem.getInfoAsync(localUri);
  if (info.exists) return localUri;
  try {
    const res = await FileSystem.downloadAsync(remoteUrl, localUri);
    return res.uri;
  } catch (e) {
    return null;
  }
}

// Fetches JSON (a process record) with a cache fallback: try the network first so a student always
// sees the freshest version while online, fall back to whatever was last cached when the fetch fails.
export async function fetchJsonCached(remoteUrl, relPath) {
  try {
    const r = await fetch(remoteUrl);
    if (!r.ok) throw new Error(`${r.status}`);
    const text = await r.text();
    ensureDir()
      .then(() => FileSystem.writeAsStringAsync(CACHE_DIR + slugFor(relPath), text))
      .catch(() => {});
    return JSON.parse(text);
  } catch (e) {
    const cached = await getCachedFile(relPath);
    if (cached) {
      const text = await FileSystem.readAsStringAsync(cached);
      return JSON.parse(text);
    }
    throw e;
  }
}

const CHAT_KEY = (tid) => `understood_chat_cache_${tid}`;

export async function saveChatCache(tid, chat) {
  try {
    await AsyncStorage.setItem(CHAT_KEY(tid), JSON.stringify(chat));
  } catch (e) {
    /* best-effort */
  }
}

export async function loadChatCache(tid) {
  try {
    const raw = await AsyncStorage.getItem(CHAT_KEY(tid));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// Walks a freshly-loaded chat and warms the file cache for every image/process output in the
// background, so a student who read a lesson once can reopen it with wifi off - not just the output
// they happened to scroll past, but the whole thread. Fire-and-forget: caching failures here are
// silently swallowed by cacheFile/fetchJsonCached, so this never blocks or errors the UI.
export function prefetchChatAssets(chat, fileUrl) {
  for (const m of chat || []) {
    for (const o of m.outputs || []) {
      if (o.type === "image" && o.path) {
        cacheFile(fileUrl(o.path), o.path);
      } else if (o.type === "process" && o.path) {
        fetchJsonCached(fileUrl(o.path), o.path)
          .then((fig) => {
            for (const st of fig.steps || []) {
              if (st.image_path) cacheFile(fileUrl(st.image_path), st.image_path);
            }
          })
          .catch(() => {});
      }
    }
  }
}
