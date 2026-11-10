import React, { useState } from "react";
import { View, Text, Pressable, TextInput, Switch, StyleSheet } from "react-native";

// Mobile port of web/src/ExportBar.jsx - same fields, same mm_app.py export-bar mirror, same onSend
// payload shapes (scope/history/depth, action pdf|slides|lesson|notes), so mm_api.py/mm_engine.py need
// no changes to serve this either. Rendered in the main chat area (not the sidebar), same as Streamlit.
export default function ExportBar({ chat, onSend }) {
  const nEx = chat.filter((m) => m.role === "user").length;
  const hasFig = chat.some((m) => m.role === "assistant" && (m.outputs || []).some((o) => o.type === "image" || o.type === "process"));

  const [scope, setScope] = useState(hasFig ? "figure" : "chat");
  const [whole, setWhole] = useState(false);
  const [nPick, setNPick] = useState(String(Math.min(4, Math.max(1, nEx))));
  const [depth, setDepth] = useState("standard");

  if (nEx === 0) return null;

  const nVal = Math.max(1, Math.min(nEx, Number(nPick) || 1));
  const history = whole ? null : nVal;
  const exOpts = { scope, history, depth };

  return (
    <View style={s.bar}>
      <Text style={s.title}>Export</Text>

      <View style={s.row}>
        {[
          ["figure", "This picture / answer"],
          ["chat", "Our discussion"],
        ].map(([key, label]) => (
          <Pressable key={key} style={s.radioRow} onPress={() => setScope(key)}>
            <View style={[s.radioOuter, scope === key && s.radioOuterActive]}>{scope === key && <View style={s.radioInner} />}</View>
            <Text style={s.radioLabel}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={s.rowBetween}>
        <View style={s.nField}>
          <Text style={s.nLabel}>Last exchanges</Text>
          <TextInput
            style={[s.nInput, (whole || scope === "figure") && s.nInputDisabled]}
            value={nPick}
            onChangeText={setNPick}
            editable={!whole && scope !== "figure"}
            keyboardType="number-pad"
          />
        </View>
        <Pressable style={s.checkRow} onPress={() => setWhole((v) => !v)}>
          <Switch value={whole} onValueChange={setWhole} />
          <Text style={s.checkLabel}>Whole chat</Text>
        </Pressable>
      </View>

      <View style={s.row}>
        {["brief", "standard", "deep"].map((d) => (
          <Pressable key={d} style={s.radioRow} onPress={() => setDepth(d)}>
            <View style={[s.radioOuter, depth === d && s.radioOuterActive]}>{depth === d && <View style={s.radioInner} />}</View>
            <Text style={s.radioLabel}>{d[0].toUpperCase() + d.slice(1)}</Text>
          </Pressable>
        ))}
      </View>

      <View style={s.buttons}>
        <Pressable style={s.btn} onPress={() => onSend({ action: "pdf", text: "", shown_text: "Make a PDF", ...exOpts })}>
          <Text style={s.btnText}>📄 PDF</Text>
        </Pressable>
        <Pressable style={s.btn} onPress={() => onSend({ action: "slides", text: "", shown_text: "Make slides", ...exOpts })}>
          <Text style={s.btnText}>🖥 Slides</Text>
        </Pressable>
        <Pressable style={s.btn} onPress={() => onSend({ action: "lesson", text: "", shown_text: "Play the narrated lesson", ...exOpts })}>
          <Text style={s.btnText}>🔊 Video</Text>
        </Pressable>
        <Pressable
          style={s.btn}
          onPress={() =>
            onSend({ action: "notes", text: "", mode_notes: "condensed", shown_text: "Make notes of our discussion", scope: "chat", history, depth })
          }
        >
          <Text style={s.btnText}>📝 Notes</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { backgroundColor: "white", borderTopWidth: 1, borderTopColor: "#e0e0e0", padding: 12, gap: 8 },
  title: { fontSize: 12, fontWeight: "700", color: "#888" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  radioRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  radioOuter: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: "#aaa", alignItems: "center", justifyContent: "center" },
  radioOuterActive: { borderColor: "#2d6cdf" },
  radioInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#2d6cdf" },
  radioLabel: { fontSize: 13, color: "#444" },
  nField: { flexDirection: "row", alignItems: "center", gap: 6 },
  nLabel: { fontSize: 12, color: "#777" },
  nInput: { width: 46, borderWidth: 1, borderColor: "#d0d0d0", borderRadius: 6, paddingVertical: 4, paddingHorizontal: 6, fontSize: 13, textAlign: "center" },
  nInputDisabled: { opacity: 0.4, backgroundColor: "#f2f2f2" },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  checkLabel: { fontSize: 13, color: "#444" },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  btn: { borderWidth: 1, borderColor: "#2d6cdf", borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12 },
  btnText: { color: "#2d6cdf", fontSize: 13, fontWeight: "600" },
});
