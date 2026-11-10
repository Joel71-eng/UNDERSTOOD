import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, TextInput, Switch, Modal, StyleSheet, Alert } from "react-native";
import { createThread, listThreads, keepThread, deleteThread, getMeta } from "./api.js";
import ToolsPanel from "./ToolsPanel.js";

// Mobile equivalent of the web Sidebar.jsx (and, behind that, mm_app.py's `with st.sidebar:` block) -
// same feature set (New chat, recent threads, Keep/Delete, retention caption, and the "More tools"
// expander) but shown as a slide-over drawer rather than a persistent column, since a phone doesn't have
// the width to keep it open alongside the chat the way the web app and Streamlit's own sidebar can.
export default function Sidebar({ visible, onClose, tid, onSwitchThread, onNewThread, running, onActiveTitle, onSend }) {
  const [threads, setThreads] = useState([]);
  const [retentionHours, setRetentionHours] = useState(null);

  async function refresh() {
    try {
      const list = await listThreads();
      setThreads(list.slice(0, 12));
    } catch (e) {
      /* best-effort - the drawer just keeps showing the last list it had */
    }
  }

  useEffect(() => {
    if (visible) {
      refresh();
      getMeta()
        .then((m) => setRetentionHours(m.retention_hours))
        .catch(() => {});
    }
  }, [visible]);

  const current = threads.find((t) => t.id === tid);

  useEffect(() => {
    onActiveTitle?.(current?.title || "");
  }, [current?.title]);

  async function handleNewChat() {
    const { thread_id } = await createThread();
    onNewThread(thread_id);
    onClose();
  }

  async function handleSwitch(id) {
    onSwitchThread(id);
    onClose();
  }

  async function handleToggleKeep(val) {
    if (!current) return;
    await keepThread(tid, val);
    refresh();
  }

  function handleDelete() {
    if (!tid || running) return;
    Alert.alert("Delete this chat?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteThread(tid);
          const list = await listThreads();
          const next = list[0]?.id || (await createThread()).thread_id;
          onSwitchThread(next);
          onClose();
        },
      },
    ]);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={s.backdropTap} onPress={onClose} />
        <View style={s.drawer}>
          <ScrollView contentContainerStyle={s.scrollContent}>
            <Text style={s.title}>Understood</Text>
            <Text style={s.tagline}>Learn it. See it. Understand it.</Text>

            <Pressable style={s.newChatBtn} onPress={handleNewChat}>
              <Text style={s.newChatBtnText}>＋ New chat</Text>
            </Pressable>

            <View style={s.threadList}>
              {threads.map((t) => (
                <Pressable key={t.id} style={[s.threadRow, t.id === tid && s.threadRowActive]} onPress={() => handleSwitch(t.id)}>
                  <Text style={[s.threadRowText, t.id === tid && s.threadRowTextActive]} numberOfLines={1}>
                    {t.id === tid ? "▸ " : ""}
                    {t.kept && "★ "}
                    {t.title || "New chat"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {retentionHours !== null && (
              <Text style={s.retention}>
                {retentionHours ? `Chats are kept for ${retentionHours}h after you last use them.` : "Chats are kept until you delete them."}
              </Text>
            )}

            <View style={s.thisChat}>
              <Text style={s.sectionLabel}>THIS CHAT</Text>
              <View style={s.keepRow}>
                <Text style={s.keepLabel}>Keep this chat</Text>
                <Switch value={!!current?.kept} onValueChange={handleToggleKeep} />
              </View>
              <Pressable style={[s.deleteBtn, running && s.deleteBtnDisabled]} onPress={handleDelete} disabled={running}>
                <Text style={s.deleteBtnText}>🗑 Delete this chat</Text>
              </Pressable>
            </View>

            {/* Same "More tools" (Picture/Edit/Learn) block mm_app.py puts inside its own sidebar - a
                request made here closes the drawer so the student lands back on the chat to watch it run. */}
            {onSend && (
              <ToolsPanel
                running={running}
                onSend={async (msg) => {
                  await onSend(msg);
                  onClose();
                }}
              />
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, flexDirection: "row", backgroundColor: "rgba(0,0,0,0.4)" },
  backdropTap: { flex: 1 },
  drawer: { width: "80%", maxWidth: 320, backgroundColor: "white" },
  scrollContent: { padding: 18, paddingTop: 56 },
  title: { fontSize: 20, fontWeight: "700" },
  tagline: { fontSize: 12, color: "#888", marginTop: 2, marginBottom: 16 },
  newChatBtn: { borderWidth: 1, borderColor: "#2d6cdf", borderRadius: 8, paddingVertical: 10, alignItems: "center", marginBottom: 14 },
  newChatBtnText: { color: "#2d6cdf", fontWeight: "600" },
  threadList: { gap: 2 },
  threadRow: { paddingVertical: 9, paddingHorizontal: 8, borderRadius: 6 },
  threadRowActive: { backgroundColor: "#e3ecfc" },
  threadRowText: { fontSize: 14, color: "#333" },
  threadRowTextActive: { color: "#2d6cdf", fontWeight: "600" },
  retention: { fontSize: 11, color: "#999", marginTop: 14, marginBottom: 6 },
  thisChat: { borderTopWidth: 1, borderTopColor: "#e0e0e0", paddingTop: 12, marginTop: 10 },
  sectionLabel: { fontSize: 11, fontWeight: "700", color: "#888", marginBottom: 8 },
  keepRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  keepLabel: { fontSize: 14, color: "#444" },
  deleteBtn: { borderWidth: 1, borderColor: "#e0a0a0", borderRadius: 8, paddingVertical: 9, alignItems: "center" },
  deleteBtnDisabled: { opacity: 0.5 },
  deleteBtnText: { color: "#a30000", fontSize: 13 },
});
