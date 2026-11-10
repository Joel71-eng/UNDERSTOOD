import React, { useState } from "react";
import { Modal, View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { setApiBase, getApiBase } from "./api.js";

export const SERVER_URL_KEY = "understood_server_url";

// Loads the saved server URL at startup, if any - called once from App.js before the first API call,
// mirroring mm_app.py's settings.server_url check (it refuses to proceed with no address saved).
export async function loadSavedServerUrl() {
  try {
    const saved = await AsyncStorage.getItem(SERVER_URL_KEY);
    if (saved) setApiBase(saved);
  } catch (e) {
    /* best-effort - falls back to the placeholder in api.js */
  }
}

// A visible stand-in for mm_app.py's hidden ?admin=1 "Service address" field - a phone has no query
// param to hide it behind, and a wrong/missing address here is exactly what crashed with a
// MalformedURLException last test round, so this needs to be easy to find and fix, not buried.
export default function Settings({ visible, onClose }) {
  const [url, setUrl] = useState(getApiBase());
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null); // {ok, msg}

  async function save() {
    const normalized = setApiBase(url);
    setUrl(normalized);
    try {
      await AsyncStorage.setItem(SERVER_URL_KEY, normalized);
    } catch (e) {
      /* best-effort */
    }
    setResult(null);
  }

  async function check() {
    await save();
    setChecking(true);
    setResult(null);
    try {
      const r = await fetch(getApiBase() + "/health");
      if (r.ok) {
        setResult({ ok: true, msg: "Connected." });
      } else {
        setResult({ ok: false, msg: `Server responded with ${r.status}.` });
      }
    } catch (e) {
      setResult({ ok: false, msg: "Could not reach that address. Check the IP, port, and that you're on the same wifi as your PC." });
    }
    setChecking(false);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <Text style={s.title}>Settings</Text>
          <Text style={s.label}>Server address</Text>
          <Text style={s.hint}>
            Your PC's LAN IP running mm_api.py, e.g. http://192.168.1.42:8800 - find it with ipconfig/ifconfig on the PC.
            A missing "http://" is the single most common cause of a connection crash here.
          </Text>
          <TextInput
            style={s.input}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.1.42:8800"
          />
          {result && <Text style={result.ok ? s.ok : s.err}>{result.msg}</Text>}
          <View style={s.row}>
            <Pressable style={s.btnOutline} onPress={check} disabled={checking}>
              <Text style={s.btnOutlineText}>{checking ? "Checking…" : "Test connection"}</Text>
            </Pressable>
            <Pressable
              style={s.btn}
              onPress={async () => {
                await save();
                onClose();
              }}
            >
              <Text style={s.btnText}>Save</Text>
            </Pressable>
          </View>
          <Pressable style={s.close} onPress={onClose}>
            <Text style={s.closeText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "white", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 32 },
  title: { fontSize: 18, fontWeight: "700", marginBottom: 16 },
  label: { fontSize: 13, fontWeight: "600", marginBottom: 4 },
  hint: { fontSize: 12, color: "#777", marginBottom: 8, lineHeight: 17 },
  input: { borderWidth: 1, borderColor: "#d0d0d0", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, fontSize: 14, marginBottom: 8 },
  ok: { color: "#1a7a3a", fontSize: 12, marginBottom: 8 },
  err: { color: "#a30000", fontSize: 12, marginBottom: 8 },
  row: { flexDirection: "row", gap: 10, marginTop: 4 },
  btnOutline: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: "#2d6cdf", alignItems: "center" },
  btnOutlineText: { color: "#2d6cdf", fontWeight: "600" },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: "#2d6cdf", alignItems: "center" },
  btnText: { color: "white", fontWeight: "600" },
  close: { marginTop: 14, alignItems: "center" },
  closeText: { color: "#888" },
});
