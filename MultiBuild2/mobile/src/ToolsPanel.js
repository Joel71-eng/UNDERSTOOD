import React, { useState } from "react";
import { View, Text, TextInput, Pressable, Switch, StyleSheet } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { pickedFileToAttachment } from "./api.js";

// Mobile port of web/src/ToolsPanel.jsx - same fields, same mm_app.py "More tools" mirror, same onSend
// contract. Lives inside the Sidebar drawer, same as it lives inside Streamlit's st.sidebar.
export default function ToolsPanel({ onSend, running }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("pic");

  const [picPrompt, setPicPrompt] = useState("");
  const [aspect, setAspect] = useState("square");
  const [quality, setQuality] = useState(false);

  const [editText, setEditText] = useState("");
  const [editFile, setEditFile] = useState(null);

  const [topic, setTopic] = useState("");
  const [withQuestions, setWithQuestions] = useState(true);

  async function createPicture() {
    const t = picPrompt.trim();
    if (!t) return;
    await onSend({ text: t, mode: "studio", options: { aspect, quality: quality ? "high" : "fast" }, shown_text: `Picture: ${t}` });
    setPicPrompt("");
  }

  async function pickEditFile() {
    const res = await DocumentPicker.getDocumentAsync({ type: ["image/png", "image/jpeg", "image/webp"], copyToCacheDirectory: false });
    if (res.canceled) return;
    setEditFile(res.assets[0]);
  }

  async function changePicture() {
    const t = editText.trim();
    if (!t) return;
    const attachments = editFile ? [await pickedFileToAttachment(editFile, FileSystem)] : [];
    await onSend({ text: t, mode: "edit", attachments, shown_text: t });
    setEditText("");
    setEditFile(null);
  }

  async function askDiagram() {
    const t = topic.trim();
    if (!t) return;
    await onSend({ action: "show_as", kind: "diagram", text: t, shown_text: `Labelled diagram: ${t}` });
  }
  async function askProcess() {
    const t = topic.trim();
    if (!t) return;
    await onSend({ action: "process", text: t, shown_text: `Step by step: ${t}` });
  }
  async function askGuide() {
    await onSend({ action: "guide", text: topic.trim(), options: { questions: withQuestions }, shown_text: `Study guide: ${topic.trim() || "my notes"}` });
  }

  return (
    <View style={s.panel}>
      <Pressable onPress={() => setOpen((v) => !v)}>
        <Text style={s.toggle}>🧰 More tools {open ? "▾" : "▸"}</Text>
      </Pressable>
      {open && (
        <View style={s.body}>
          <Text style={s.hint}>Everything here can also be asked for by typing in the chat. Exports are at the end of each answer.</Text>
          <View style={s.tabs}>
            {[
              ["pic", "Picture"],
              ["edit", "Edit"],
              ["learn", "Learn"],
            ].map(([key, label]) => (
              <Pressable key={key} style={[s.tab, tab === key && s.tabActive]} onPress={() => setTab(key)}>
                <Text style={[s.tabText, tab === key && s.tabTextActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {tab === "pic" && (
            <View style={s.form}>
              <TextInput style={s.textarea} placeholder="Describe the picture" value={picPrompt} onChangeText={setPicPrompt} multiline />
              <View style={s.row}>
                {["square", "wide", "tall"].map((a) => (
                  <Pressable key={a} style={[s.pill, aspect === a && s.pillActive]} onPress={() => setAspect(a)}>
                    <Text style={[s.pillText, aspect === a && s.pillTextActive]}>{a}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={s.toggleRow}>
                <Text style={s.toggleLabel}>Higher quality (slower)</Text>
                <Switch value={quality} onValueChange={setQuality} />
              </View>
              <Pressable style={[s.btn, (running || !picPrompt.trim()) && s.btnDisabled]} disabled={running || !picPrompt.trim()} onPress={createPicture}>
                <Text style={s.btnText}>Create picture</Text>
              </Pressable>
            </View>
          )}

          {tab === "edit" && (
            <View style={s.form}>
              <Pressable style={s.filePick} onPress={pickEditFile}>
                <Text style={s.filePickText}>{editFile ? `📎 ${editFile.name}` : "📎 Picture to change (empty = last picture in this chat)"}</Text>
              </Pressable>
              <TextInput style={s.input} placeholder="What should change?" value={editText} onChangeText={setEditText} />
              <Pressable style={[s.btn, (running || !editText.trim()) && s.btnDisabled]} disabled={running || !editText.trim()} onPress={changePicture}>
                <Text style={s.btnText}>Change it</Text>
              </Pressable>
            </View>
          )}

          {tab === "learn" && (
            <View style={s.form}>
              <TextInput style={s.input} placeholder="e.g. the human brain" value={topic} onChangeText={setTopic} />
              <View style={s.row}>
                <Pressable style={[s.btn, s.btnHalf, (running || !topic.trim()) && s.btnDisabled]} disabled={running || !topic.trim()} onPress={askDiagram}>
                  <Text style={s.btnText}>Diagram</Text>
                </Pressable>
                <Pressable style={[s.btn, s.btnHalf, (running || !topic.trim()) && s.btnDisabled]} disabled={running || !topic.trim()} onPress={askProcess}>
                  <Text style={s.btnText}>Process</Text>
                </Pressable>
              </View>
              <View style={s.toggleRow}>
                <Text style={s.toggleLabel}>Study guide with practice questions</Text>
                <Switch value={withQuestions} onValueChange={setWithQuestions} />
              </View>
              <Pressable style={[s.btn, running && s.btnDisabled]} disabled={running} onPress={askGuide}>
                <Text style={s.btnText}>Study guide</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  panel: { borderTopWidth: 1, borderTopColor: "#e0e0e0", marginTop: 14, paddingTop: 10 },
  toggle: { fontSize: 14, fontWeight: "600", color: "#444" },
  body: { marginTop: 8 },
  hint: { fontSize: 11, color: "#999", marginBottom: 8 },
  tabs: { flexDirection: "row", gap: 4, marginBottom: 8 },
  tab: { flex: 1, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: "#d8d8d8", alignItems: "center" },
  tabActive: { backgroundColor: "#2d6cdf", borderColor: "#2d6cdf" },
  tabText: { fontSize: 12, color: "#555" },
  tabTextActive: { color: "white" },
  form: { gap: 7 },
  textarea: { fontSize: 14, padding: 8, borderRadius: 6, borderWidth: 1, borderColor: "#d0d0d0", minHeight: 60, textAlignVertical: "top" },
  input: { fontSize: 14, padding: 8, borderRadius: 6, borderWidth: 1, borderColor: "#d0d0d0" },
  row: { flexDirection: "row", gap: 6 },
  pill: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: "#d8d8d8" },
  pillActive: { backgroundColor: "#2d6cdf", borderColor: "#2d6cdf" },
  pillText: { fontSize: 12, color: "#555" },
  pillTextActive: { color: "white" },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  toggleLabel: { fontSize: 12, color: "#555", flex: 1 },
  filePick: { padding: 8, borderRadius: 6, borderWidth: 1, borderColor: "#d0d0d0", borderStyle: "dashed" },
  filePickText: { fontSize: 11, color: "#777" },
  btn: { paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: "#2d6cdf", alignItems: "center" },
  btnHalf: { flex: 1 },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: "#2d6cdf", fontSize: 13, fontWeight: "600" },
});
