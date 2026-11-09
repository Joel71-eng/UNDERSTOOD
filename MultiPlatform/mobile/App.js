import React, { useEffect, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Image,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
// expo-file-system's SDK 52+ rewrite moved to a new File/Directory class API; the old function-style
// calls this app uses (readAsStringAsync, downloadAsync, getInfoAsync, etc.) still work, just from this
// "/legacy" import instead of the bare package - see offline.js for where those calls actually happen.
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { createThread, getChat, getStatus, sendMessage, cancelThread, fileUrl, pickedFileToAttachment } from "./src/api.js";
import { saveChatCache, loadChatCache, prefetchChatAssets } from "./src/offline.js";
import Output from "./src/Output.js";

const LEVELS = [
  { key: "ordinary", label: "Ordinary" },
  { key: "advanced", label: "Advanced" },
  { key: "university", label: "University" },
];

export default function App() {
  const [tid, setTid] = useState(null);
  const [chat, setChat] = useState([]);
  const [text, setText] = useState("");
  const [level, setLevel] = useState("ordinary");
  const [files, setFiles] = useState([]);
  const [cameraShots, setCameraShots] = useState([]); // [{name, data_b64, previewUri}] - already base64, unlike `files`
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState(null);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const pollRef = useRef(null);
  const scrollRef = useRef(null);

  // Loads the real chat when the network is up, caching it (text + referenced images/process records)
  // for next time; falls back to whatever was last cached when the network call fails. This one
  // function is reused for both the first load and every refresh after a message finishes, so "online"
  // and "offline" never desync into two different code paths.
  async function refreshChat(id) {
    try {
      const data = await getChat(id);
      setChat(data);
      setOffline(false);
      saveChatCache(id, data);
      prefetchChatAssets(data, fileUrl);
    } catch (e) {
      const cached = await loadChatCache(id);
      if (cached) {
        setChat(cached);
        setOffline(true);
      } else {
        setError(String(e));
      }
    }
  }

  // ---- same bootstrap pattern as the web app: reuse the saved thread id, or make a new one ---------
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem("understood_tid");
        const id = saved || (await createThread()).thread_id;
        await AsyncStorage.setItem("understood_tid", id);
        setTid(id);
        await refreshChat(id);
      } catch (e) {
        // createThread() itself needs the network - with nothing cached yet (no tid ever saved) there
        // is nothing to show offline, so this is a genuine "can't reach the server" error.
        setError(String(e));
      }
    })();
    return () => clearInterval(pollRef.current);
  }, []);

  function watch(id) {
    setRunning(true);
    pollRef.current = setInterval(async () => {
      try {
        const st = await getStatus(id);
        setLive(st);
        if (st.status !== "running") {
          clearInterval(pollRef.current);
          setRunning(false);
          setLive(null);
          await refreshChat(id);
        }
      } catch (e) {
        clearInterval(pollRef.current);
        setRunning(false);
        setError(String(e));
      }
    }, 800);
  }

  async function send(message) {
    if (!tid) return;
    setError("");
    try {
      await sendMessage(tid, message);
      watch(tid);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleSend() {
    let t = text.trim();
    if (!t && files.length === 0 && cameraShots.length === 0) return;
    const pickedAttachments = await Promise.all(files.map((f) => pickedFileToAttachment(f, FileSystem)));
    // Camera shots already carry base64 from ImagePicker (requested with base64: true below), so no
    // extra filesystem read is needed the way picked documents need - just drop the local preview uri.
    const cameraAttachments = cameraShots.map(({ name, data_b64 }) => ({ name, data_b64 }));
    const attachments = [...pickedAttachments, ...cameraAttachments];
    // A bare photo with no typed question is almost always "what is this?" - give the tutor something
    // to act on instead of sending empty text next to an attachment.
    if (!t && cameraAttachments.length > 0) t = "Explain what's in this photo.";
    setText("");
    setFiles([]);
    setCameraShots([]);
    await send({ text: t, shown_text: t, mode: "assistant", level, attachments });
  }

  async function handlePickFile() {
    const res = await DocumentPicker.getDocumentAsync({ type: ["image/*", "application/pdf"], multiple: true });
    if (res.canceled) return;
    setFiles((prev) => [...prev, ...res.assets]);
  }

  // Opens the device camera so a student can photograph a textbook page, a lab setup or their own
  // diagram and have the tutor look at it directly, rather than needing to go through a file picker.
  // expo-image-picker's launchCameraAsync (not the lower-level expo-camera module) is enough here since
  // we only need a single still shot with a system shutter UI, not a custom live preview.
  async function handleCameraCapture() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera permission needed", "Allow camera access in your phone's settings to photograph something for the tutor to explain.");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6, exif: false });
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    if (!asset.base64) return; // shouldn't happen with base64:true, but don't attach a photo we can't send
    setCameraShots((prev) => [...prev, { name: `photo_${Date.now()}.jpg`, data_b64: asset.base64, previewUri: asset.uri }]);
  }

  async function handleChoice(topic, kind) {
    await send({ action: "show_as", kind, text: topic, shown_text: `Show it as a ${kind}`, level });
  }

  async function handleCancel() {
    if (!tid) return;
    await cancelThread(tid);
  }

  return (
    <SafeAreaView style={s.app}>
      <View style={s.header}>
        <View style={s.headerTop}>
          <Text style={s.headerTitle}>Understood</Text>
          {offline && (
            <View style={s.offlineBadge}>
              <Text style={s.offlineBadgeText}>Offline · cached</Text>
            </View>
          )}
        </View>
        <View style={s.levelRow}>
          {LEVELS.map((l) => (
            <Pressable key={l.key} onPress={() => !running && setLevel(l.key)} style={[s.levelPill, level === l.key && s.levelPillActive]}>
              <Text style={[s.levelPillText, level === l.key && s.levelPillTextActive]}>{l.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={s.thread}
        contentContainerStyle={s.threadContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {chat.map((m, i) => (
          <View key={i} style={[s.bubble, m.role === "user" ? s.bubbleUser : s.bubbleAssistant]}>
            {m.role === "user" ? (
              <>
                {m.text ? <Text style={s.userText}>{m.text}</Text> : null}
                {m.files?.length > 0 ? <Text style={s.userFiles}>📎 {m.files.join(", ")}</Text> : null}
              </>
            ) : (
              (m.outputs || []).map((o, j) => <Output key={j} o={o} fileUrl={fileUrl} onChoice={handleChoice} />)
            )}
          </View>
        ))}

        {running && (
          <View style={[s.bubble, s.bubbleAssistant, s.bubbleLive]}>
            <View style={s.thinkingRow}>
              <ActivityIndicator size="small" />
              <Text style={s.thinking}>Working on it…</Text>
            </View>
            {(live?.outputs || []).map((o, j) => (
              <Output key={j} o={o} fileUrl={fileUrl} onChoice={handleChoice} />
            ))}
            {live?.steps?.length > 0 && (
              <Text style={s.progress}>
                Step {live.i + 1} of {live.steps.length}
              </Text>
            )}
            <Pressable style={s.cancelBtn} onPress={handleCancel}>
              <Text style={s.cancelBtnText}>Stop</Text>
            </Pressable>
          </View>
        )}

        {error ? (
          <View style={[s.bubble, s.bubbleError]}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>

      {(files.length > 0 || cameraShots.length > 0) && (
        <View style={s.filesPreview}>
          {cameraShots.map((shot, i) => (
            <View key={`cam${i}`} style={s.shotThumbWrap}>
              <Image source={{ uri: shot.previewUri }} style={s.shotThumb} />
              <Pressable style={s.shotRemove} onPress={() => setCameraShots((prev) => prev.filter((_, j) => j !== i))}>
                <Text style={s.shotRemoveText}>✕</Text>
              </Pressable>
            </View>
          ))}
          {files.length > 0 && <Text style={s.filesPreviewText}>📎 {files.map((f) => f.name).join(", ")}</Text>}
        </View>
      )}

      <View style={s.composer}>
        <Pressable style={s.attachBtn} onPress={handleCameraCapture} disabled={running}>
          <Text style={s.attachBtnText}>📷</Text>
        </Pressable>
        <Pressable style={s.attachBtn} onPress={handlePickFile} disabled={running}>
          <Text style={s.attachBtnText}>📎</Text>
        </Pressable>
        <TextInput
          style={s.input}
          value={text}
          onChangeText={setText}
          placeholder="Ask anything, or try: draw a labelled diagram of the human heart"
          multiline
          editable={!running}
        />
        <Pressable style={[s.sendBtn, running && s.sendBtnDisabled]} onPress={handleSend} disabled={running}>
          <Text style={s.sendBtnText}>Send</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  app: { flex: 1, backgroundColor: "#f5f5f7" },
  header: { paddingHorizontal: 16, paddingTop: Platform.OS === "android" ? 12 : 4, paddingBottom: 10, backgroundColor: "white", borderBottomWidth: 1, borderBottomColor: "#e0e0e0" },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  headerTitle: { fontSize: 20, fontWeight: "700" },
  offlineBadge: { backgroundColor: "#fff3cd", paddingVertical: 3, paddingHorizontal: 8, borderRadius: 10 },
  offlineBadgeText: { color: "#8a6d00", fontSize: 11, fontWeight: "600" },
  levelRow: { flexDirection: "row", gap: 6 },
  levelPill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: "#d0d0d0" },
  levelPillActive: { backgroundColor: "#2d6cdf", borderColor: "#2d6cdf" },
  levelPillText: { fontSize: 12, color: "#555" },
  levelPillTextActive: { color: "white" },
  thread: { flex: 1 },
  threadContent: { padding: 16, gap: 10 },
  bubble: { maxWidth: "88%", padding: 10, borderRadius: 14 },
  bubbleUser: { alignSelf: "flex-end", backgroundColor: "#2d6cdf" },
  bubbleAssistant: { alignSelf: "flex-start", backgroundColor: "white", borderWidth: 1, borderColor: "#e0e0e0" },
  bubbleLive: { opacity: 0.95 },
  bubbleError: { alignSelf: "center", backgroundColor: "#ffe5e5" },
  userText: { color: "white", fontSize: 15 },
  userFiles: { color: "#dbe6fc", fontSize: 11, marginTop: 2 },
  errorText: { color: "#a30000", fontSize: 13 },
  thinkingRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  thinking: { color: "#888", fontStyle: "italic" },
  progress: { fontSize: 12, color: "#888", marginTop: 4 },
  cancelBtn: { marginTop: 6, alignSelf: "flex-start", paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: "#c00" },
  cancelBtnText: { color: "#c00", fontSize: 12 },
  filesPreview: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: "white" },
  filesPreviewText: { fontSize: 11, color: "#666" },
  shotThumbWrap: { position: "relative" },
  shotThumb: { width: 44, height: 44, borderRadius: 6, backgroundColor: "#eee" },
  shotRemove: { position: "absolute", top: -6, right: -6, backgroundColor: "#c00", borderRadius: 8, width: 16, height: 16, alignItems: "center", justifyContent: "center" },
  shotRemoveText: { color: "white", fontSize: 10, lineHeight: 10 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12, backgroundColor: "white", borderTopWidth: 1, borderTopColor: "#e0e0e0" },
  attachBtn: { paddingVertical: 8, paddingHorizontal: 10 },
  attachBtnText: { fontSize: 18 },
  input: { flex: 1, minHeight: 40, maxHeight: 120, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: "#d0d0d0", fontSize: 14 },
  sendBtn: { backgroundColor: "#2d6cdf", paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  sendBtnDisabled: { backgroundColor: "#a7bde8" },
  sendBtnText: { color: "white", fontWeight: "600" },
});
