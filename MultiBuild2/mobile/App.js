import React, { useEffect, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Image,
  Modal,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
  KeyboardAvoidingView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
// expo-file-system's SDK 52+ rewrite moved to a new File/Directory class API; the old function-style
// calls this app uses (readAsStringAsync, downloadAsync, getInfoAsync, etc.) still work, just from this
// "/legacy" import instead of the bare package - see offline.js for where those calls actually happen.
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { createThread, getChat, getStatus, sendMessage, cancelThread, resumeThread, fileUrl, pickedFileToAttachment } from "./src/api.js";
import { saveChatCache, loadChatCache, prefetchChatAssets } from "./src/offline.js";
import Settings, { loadSavedServerUrl } from "./src/Settings.js";
import Sidebar from "./src/Sidebar.js";
import ExportBar from "./src/ExportBar.js";
import GlowBorder from "./src/GlowBorder.js";
import Output from "./src/Output.js";

// Mirrors mm_app.py's Output selector exactly (line ~91: OUTPUTS = ["Auto", "Diagram", "Process",
// "Picture", "Explain", "Edit"]) - learning levels were retired there in favor of this, so this app
// drops the level picker entirely rather than keeping a control the real tutor no longer reads.
const OUTPUT_KINDS = [
  { key: "Auto", desc: "I decide what you need from what you type, and tell you what I understood." },
  { key: "Diagram", desc: "I draw a labelled diagram of what you type." },
  { key: "Process", desc: "I show it step by step." },
  { key: "Picture", desc: "I make a picture from your description." },
  { key: "Explain", desc: "I explain the picture on screen, or answer your question." },
  { key: "Edit", desc: "I change the picture on screen as you describe (or attach a picture to change)." },
];

export default function App() {
  const [tid, setTid] = useState(null);
  const [chat, setChat] = useState([]);
  const [text, setText] = useState("");
  const [outKind, setOutKind] = useState("Auto");
  const [files, setFiles] = useState([]);
  const [cameraShots, setCameraShots] = useState([]); // [{name, data_b64, previewUri}] - already base64, unlike `files`
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState(null);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [parked, setParked] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [threadTitle, setThreadTitle] = useState("");
  const [composerActive, setComposerActive] = useState(false); // drives the glowing-border animation while typing
  const [ready, setReady] = useState(false); // becomes true once the saved server URL is loaded
  const [viewer, setViewer] = useState(null); // {uri} - full-screen image viewer
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

  // One place that loads a given thread and resets all the per-thread UI state - used for first load
  // AND for switching threads from the sidebar, so the two never drift into different behavior.
  async function openThread(id) {
    clearInterval(pollRef.current);
    await AsyncStorage.setItem("understood_tid", id);
    setTid(id);
    setRunning(false);
    setLive(null);
    setText("");
    setFiles([]);
    setCameraShots([]);
    setError("");
    await refreshChat(id);
  }

  // ---- bootstrap: load the saved server address first (loadSavedServerUrl), THEN reuse/create a -----
  // thread, mirroring mm_app.py's settings.server_url gate before anything else talks to the server.
  useEffect(() => {
    (async () => {
      await loadSavedServerUrl();
      setReady(true);
      try {
        const saved = await AsyncStorage.getItem("understood_tid");
        const id = saved || (await createThread()).thread_id;
        await openThread(id);
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
          setParked(st.status === "parked");
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
    setParked(false);
    try {
      await sendMessage(tid, message);
      watch(tid);
    } catch (e) {
      setError(String(e));
    }
  }

  // Mirrors mm_app.py's chat_input handling (lines 372-387): what fields go on the request depends on
  // the chosen Output kind, not a free-text mode guess - "Auto" is the only one that asks the engine to
  // decide AND tell the student what it understood (auto_note), the rest commit to a specific action.
  function buildRequest(t, attachments) {
    const base = { text: t, shown_text: t, attachments, options: {} };
    switch (outKind) {
      case "Diagram":
        return { ...base, action: "show_as", kind: "diagram", mode: "assistant" };
      case "Process":
        return { ...base, action: "process", mode: "assistant" };
      case "Picture":
        return { ...base, action: "picture", mode: "assistant" };
      case "Explain":
        return { ...base, action: "explain", mode: "assistant" };
      case "Edit":
        return { ...base, action: "edit", mode: "assistant" };
      default:
        return { ...base, mode: "assistant", auto_note: true };
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
    await send(buildRequest(t, attachments));
  }

  async function handlePickFile() {
    // copyToCacheDirectory: false - Expo Go's own auto-copy into its cache is the thing that was
    // throwing "isn't readable" (github.com/expo/expo/issues/21792); src/api.js's pickedFileToAttachment
    // does its own copy from whatever uri we get here instead, which is the documented workaround.
    const res = await DocumentPicker.getDocumentAsync({ type: ["image/*", "application/pdf"], multiple: true, copyToCacheDirectory: false });
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
    await send({ action: "show_as", kind, text: topic, shown_text: `Show it as a ${kind}` });
  }

  async function handleCancel() {
    if (!tid) return;
    await cancelThread(tid);
  }

  // mm_app.py: "The connection was lost. Your request is saved - press Resume below." - the engine
  // keeps a parked request server-side and /resume just re-attaches to it, so this is the one place a
  // dropped connection mid-generation is actually recoverable rather than losing the request.
  async function handleResume() {
    if (!tid) return;
    setParked(false);
    try {
      await resumeThread(tid);
      watch(tid);
    } catch (e) {
      setError(String(e));
    }
  }

  if (!ready) {
    return (
      <SafeAreaView style={[s.app, s.centerFill]}>
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.app}>
      <View style={s.header}>
        <View style={s.headerTop}>
          <Pressable onPress={() => setSidebarOpen(true)} style={s.menuBtn}>
            <Text style={s.menuBtnText}>☰</Text>
          </Pressable>
          <Text style={s.headerTitle} numberOfLines={1}>
            {threadTitle || "Understood"}
          </Text>
          <View style={s.headerRight}>
            {offline && (
              <View style={s.offlineBadge}>
                <Text style={s.offlineBadgeText}>Offline · cached</Text>
              </View>
            )}
            <Pressable onPress={() => setSettingsOpen(true)} style={s.gearBtn}>
              <Text style={s.gearBtnText}>⚙</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <Sidebar
        visible={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        tid={tid}
        onSwitchThread={openThread}
        onNewThread={openThread}
        running={running}
        onActiveTitle={setThreadTitle}
        onSend={send}
      />

      <KeyboardAvoidingView
        style={s.flexFill}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
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
                <>
                  {(m.outputs || []).map((o, j) => (
                    <Output key={j} o={o} fileUrl={fileUrl} onChoice={handleChoice} onExpandImage={(uri) => setViewer({ uri })} />
                  ))}
                  {m.status === "parked" && <Text style={s.parkedNote}>The connection was lost. Your request is saved - press Resume below.</Text>}
                  {m.status === "failed" && <Text style={s.errorInline}>Sorry, I could not finish that. Please try again or rephrase.</Text>}
                </>
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
                <Output key={j} o={o} fileUrl={fileUrl} onChoice={handleChoice} onExpandImage={(uri) => setViewer({ uri })} />
              ))}
              {live?.steps?.length > 0 && (
                <Text style={s.progress}>
                  Step {live.i + 1} of {live.steps.length}
                </Text>
              )}
              {/* Mirrors mm_app.py's status expander: tail of the activity log, so a slow Colab cold-start
                  shows what's actually happening instead of a bare spinner. */}
              {live?.log?.length > 0 && <Text style={s.liveLog}>{live.log.slice(-5).join(" · ")}</Text>}
              <Pressable style={s.cancelBtn} onPress={handleCancel}>
                <Text style={s.cancelBtnText}>Stop</Text>
              </Pressable>
            </View>
          )}

          {!running && parked && (
            <Pressable style={s.resumeBtn} onPress={handleResume}>
              <Text style={s.resumeBtnText}>▶ Resume where I stopped</Text>
            </Pressable>
          )}

          {error ? (
            <View style={[s.bubble, s.bubbleError]}>
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          {chat.length === 0 && !running && (
            <View style={s.suggestions}>
              <Text style={s.suggestionsTitle}>Try asking for:</Text>
              {["Draw a labelled diagram of the human heart", "Explain how photosynthesis works, step by step", "What's the difference between mitosis and meiosis?"].map(
                (sug) => (
                  <Pressable key={sug} style={s.suggestionChip} onPress={() => setText(sug)}>
                    <Text style={s.suggestionChipText}>{sug}</Text>
                  </Pressable>
                )
              )}
            </View>
          )}
        </ScrollView>

        {/* mm_app.py only shows this once the last turn is a completed assistant answer - mid-generation
            or right after an error there's nothing sensible to export yet. */}
        {!running && chat.length > 0 && chat[chat.length - 1]?.role === "assistant" && chat[chat.length - 1]?.status === "done" && (
          <ExportBar chat={chat} onSend={send} />
        )}

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

        <View style={s.outRow}>
          {OUTPUT_KINDS.map((o) => (
            <Pressable key={o.key} onPress={() => !running && setOutKind(o.key)} style={[s.outPill, outKind === o.key && s.outPillActive]}>
              <Text style={[s.outPillText, outKind === o.key && s.outPillTextActive]}>{o.key}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.outDesc}>{OUTPUT_KINDS.find((o) => o.key === outKind)?.desc}</Text>

        <GlowBorder active={composerActive} borderRadius={29} style={s.composerWrap}>
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
              onFocus={() => setComposerActive(true)}
              onBlur={() => setComposerActive(false)}
              placeholder="Ask a question, or say what to draw, explain, change or make…"
              multiline
              editable={!running}
            />
            <Pressable style={[s.sendBtn, running && s.sendBtnDisabled]} onPress={handleSend} disabled={running}>
              <Text style={s.sendBtnText}>Send</Text>
            </Pressable>
          </View>
        </GlowBorder>
      </KeyboardAvoidingView>

      <Settings visible={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={s.viewerBackdrop} onPress={() => setViewer(null)}>
          {viewer && <Image source={{ uri: viewer.uri }} style={s.viewerImg} resizeMode="contain" />}
          <Text style={s.viewerHint}>Tap anywhere to close</Text>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  app: { flex: 1, backgroundColor: "#f5f5f7" },
  flexFill: { flex: 1 },
  centerFill: { alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: 16, paddingTop: Platform.OS === "android" ? 12 : 4, paddingBottom: 10, backgroundColor: "white", borderBottomWidth: 1, borderBottomColor: "#e0e0e0" },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  menuBtn: { padding: 4 },
  menuBtnText: { fontSize: 20, color: "#555" },
  headerTitle: { fontSize: 19, fontWeight: "700", flex: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  offlineBadge: { backgroundColor: "#fff3cd", paddingVertical: 3, paddingHorizontal: 8, borderRadius: 10 },
  offlineBadgeText: { color: "#8a6d00", fontSize: 11, fontWeight: "600" },
  gearBtn: { padding: 4 },
  gearBtnText: { fontSize: 20, color: "#555" },
  thread: { flex: 1 },
  threadContent: { padding: 16, gap: 10 },
  bubble: { maxWidth: "88%", padding: 10, borderRadius: 14 },
  bubbleUser: { alignSelf: "flex-end", backgroundColor: "#2d6cdf" },
  bubbleAssistant: { alignSelf: "flex-start", backgroundColor: "white", borderWidth: 1, borderColor: "#e0e0e0" },
  bubbleLive: { opacity: 0.95 },
  bubbleError: { alignSelf: "center", backgroundColor: "#ffe5e5" },
  userText: { color: "white", fontSize: 17 },
  userFiles: { color: "#dbe6fc", fontSize: 12, marginTop: 2 },
  errorText: { color: "#a30000", fontSize: 14 },
  errorInline: { color: "#a30000", fontSize: 13, marginTop: 6 },
  parkedNote: { color: "#8a6d00", fontSize: 13, marginTop: 6, fontStyle: "italic" },
  resumeBtn: { alignSelf: "center", backgroundColor: "#2d6cdf", paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, marginTop: 4 },
  resumeBtnText: { color: "white", fontWeight: "600" },
  thinkingRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  thinking: { color: "#888", fontStyle: "italic", fontSize: 15 },
  liveLog: { fontSize: 12, color: "#aaa", marginTop: 4 },
  suggestions: { alignItems: "center", marginTop: 50, gap: 8, paddingHorizontal: 20 },
  suggestionsTitle: { fontSize: 13, color: "#999", marginBottom: 2 },
  suggestionChip: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: "#d8d8d8", backgroundColor: "white" },
  suggestionChipText: { fontSize: 14, color: "#444", textAlign: "center" },
  progress: { fontSize: 13, color: "#888", marginTop: 4 },
  cancelBtn: { marginTop: 6, alignSelf: "flex-start", paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: "#c00" },
  cancelBtnText: { color: "#c00", fontSize: 13 },
  filesPreview: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: "white" },
  filesPreviewText: { fontSize: 12, color: "#666" },
  shotThumbWrap: { position: "relative" },
  shotThumb: { width: 44, height: 44, borderRadius: 6, backgroundColor: "#eee" },
  shotRemove: { position: "absolute", top: -6, right: -6, backgroundColor: "#c00", borderRadius: 8, width: 16, height: 16, alignItems: "center", justifyContent: "center" },
  shotRemoveText: { color: "white", fontSize: 10, lineHeight: 10 },
  outRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 16, paddingTop: 8, backgroundColor: "white" },
  outPill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: "#d0d0d0" },
  outPillActive: { backgroundColor: "#2d6cdf", borderColor: "#2d6cdf" },
  outPillText: { fontSize: 12, color: "#555" },
  outPillTextActive: { color: "white" },
  outDesc: { fontSize: 11, color: "#888", paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6, backgroundColor: "white" },
  // Centered + responsive to the device width: marginHorizontal shrinks it in from both edges by the
  // same amount on any screen size (instead of a fixed width, which would either overflow a small phone
  // or leave odd gaps on a tablet), and composerWrap's own width is "whatever's left" after those margins
  // - i.e. it already reacts to the available space the way a percentage width would, without a
  // percentage-width bug on orientation change.
  composerWrap: { marginHorizontal: 12, marginTop: 4, marginBottom: 10 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 10,
    margin: 3, // the ring-gap - see GlowBorder.js's comment on the paint-order trick this relies on
    backgroundColor: "white",
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  attachBtn: { paddingVertical: 8, paddingHorizontal: 10 },
  attachBtnText: { fontSize: 19 },
  input: { flex: 1, minHeight: 42, maxHeight: 120, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: "#d0d0d0", fontSize: 16 },
  sendBtn: { backgroundColor: "#2d6cdf", paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  sendBtnDisabled: { backgroundColor: "#a7bde8" },
  sendBtnText: { color: "white", fontWeight: "600", fontSize: 15 },
  viewerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  viewerImg: { width: "100%", height: "80%" },
  viewerHint: { color: "#aaa", fontSize: 12, marginTop: 12 },
});
