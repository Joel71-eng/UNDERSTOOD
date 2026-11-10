import React, { useEffect, useState } from "react";
import { View, Text, Image, Pressable, Linking, StyleSheet } from "react-native";
import { getCachedFile, cacheFile, fetchJsonCached } from "./offline.js";

// Shows a diagram/photo from local cache first (instant, and works offline), falling back to the
// live network URL while a background download populates the cache for next time. See offline.js for
// why this is "cache on view" rather than an explicit download step.
function CachedImage({ relPath, fileUrl, style, resizeMode, onExpand }) {
  const [uri, setUri] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setUri(null);
    (async () => {
      const cached = await getCachedFile(relPath);
      if (cancelled) return;
      setUri(cached || fileUrl(relPath));
      cacheFile(fileUrl(relPath), relPath); // warm the cache regardless, for the next offline visit
    })();
    return () => {
      cancelled = true;
    };
  }, [relPath]);

  if (!uri) return <View style={[style, s.imgPlaceholder]} />;
  // Mirrors st.image's built-in click-to-zoom in the Streamlit app - tapping opens the full-screen
  // viewer in App.js rather than this component owning its own modal, so every image (chat bubble,
  // process step) shares one viewer instance instead of each spawning its own.
  const img = <Image source={{ uri }} style={style} resizeMode={resizeMode} />;
  return onExpand ? <Pressable onPress={() => onExpand(uri)}>{img}</Pressable> : img;
}

// Same regex/logic as the web app's Output.jsx renderSections(), ported to RN primitives instead of
// DOM. Kept identical on purpose (including the comment about the lazy-quantifier bug it fixes) so the
// two frontends don't quietly drift apart on how they parse the engine's "## Heading\ntext" format.
function renderSections(text) {
  const blocks = (text || "").split(/\n(?=##\s)/);
  return blocks.map((block, i) => {
    const m = block.match(/^##\s+([^\n]+)\n?([\s\S]*)$/);
    if (m) {
      return (
        <View key={i} style={s.mdSection}>
          <Text style={s.mdHeading}>{m[1].trim()}</Text>
          {m[2].trim() ? <Text style={s.mdBody}>{m[2].trim()}</Text> : null}
        </View>
      );
    }
    return block.trim() ? (
      <Text key={i} style={s.mdBody}>
        {block.trim()}
      </Text>
    ) : null;
  });
}

// Mirrors the web app's ProcessViewer exactly - same fetch-once-then-navigate approach, same
// assumption (confirmed from mm_engine.py: render_system_steps()/draw_step() finish before the
// "process" output is emitted in the same turn) that every step's image is ready on first fetch.
function ProcessViewer({ path, fileUrl, onExpandImage }) {
  const [fig, setFig] = useState(null);
  const [err, setErr] = useState("");
  const [i, setI] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFig(null);
    setErr("");
    setI(0);
    fetchJsonCached(fileUrl(path), path)
      .then((data) => {
        if (!cancelled) setFig(data);
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (err) return <Text style={s.note}>Could not load the step-by-step process ({err}).</Text>;
  if (!fig) return <Text style={s.note}>Loading steps…</Text>;

  const steps = fig.steps || [];
  if (steps.length === 0) return <Text style={s.note}>This process has no steps.</Text>;
  const step = steps[i];

  return (
    <View style={s.process}>
      <Text style={s.processTitle}>
        {fig.title} <Text style={s.processShape}>({fig.shape})</Text>
      </Text>
      <View style={s.processStepHead}>
        <Text style={s.processStepN}>
          Step {step.n} of {steps.length}
        </Text>
        <Text style={[s.processStatus, step.status === "ready" ? s.statusReady : s.statusPending]}>
          {step.status}
        </Text>
      </View>
      <Text style={s.processStepTitle}>{step.title}</Text>
      {step.image_path ? (
        <CachedImage relPath={step.image_path} fileUrl={fileUrl} style={s.processImg} resizeMode="contain" onExpand={onExpandImage} />
      ) : (
        <Text style={s.note}>No image for this step yet.</Text>
      )}
      {step.text ? <Text style={s.mdBody}>{step.text}</Text> : null}
      <View style={s.processNav}>
        <Pressable disabled={i === 0} onPress={() => setI(Math.max(0, i - 1))} style={[s.navBtn, i === 0 && s.navBtnDisabled]}>
          <Text style={s.navBtnText}>← Previous</Text>
        </Pressable>
        <View style={s.dots}>
          {steps.map((st, j) => (
            <Pressable key={j} onPress={() => setI(j)} style={[s.dot, j === i && s.dotActive]} />
          ))}
        </View>
        <Pressable
          disabled={i === steps.length - 1}
          onPress={() => setI(Math.min(steps.length - 1, i + 1))}
          style={[s.navBtn, i === steps.length - 1 && s.navBtnDisabled]}
        >
          <Text style={s.navBtnText}>Next →</Text>
        </Pressable>
      </View>
      {fig.source_note ? <Text style={s.sourceNote}>{fig.source_note}</Text> : null}
    </View>
  );
}

// Same contract as the web app: one case per output "type" the engine emits (mm_engine.py's self.out()
// calls), with an unknown type rendered as a visible [type] label instead of silently dropped.
export default function Output({ o, fileUrl, onChoice, onExpandImage }) {
  switch (o.type) {
    case "text":
      return <View>{renderSections(o.text)}</View>;

    case "note":
      return <Text style={s.note}>{o.text}</Text>;

    case "understood":
      return <Text style={s.plan}>{o.text}</Text>;

    case "image":
      return (
        <View style={s.imageWrap}>
          <CachedImage relPath={o.path} fileUrl={fileUrl} style={s.image} resizeMode="contain" onExpand={onExpandImage} />
          {o.caption ? <Text style={s.caption}>{o.caption}</Text> : null}
          <Text style={s.tapHint}>Tap to expand</Text>
        </View>
      );

    case "video":
      // expo-av is the usual choice for in-app video, but it's a native module that needs its own
      // config pass (and this app has no video-generation feature exercised yet) - so for now a video
      // output opens in the system player via Linking rather than pulling in a dependency unused
      // elsewhere. Swap this for expo-av's <Video> if/when video output actually gets tested on-device.
      return (
        <Pressable onPress={() => Linking.openURL(fileUrl(o.path))}>
          <Text style={s.fileLink}>▶ Open video</Text>
        </Pressable>
      );

    case "sources":
      return (
        <View style={s.sources}>
          {(o.items || []).map((src, i) => (
            <Text key={i} style={s.sourceNote}>
              • {src}
            </Text>
          ))}
        </View>
      );

    case "file":
    case "doc":
      return (
        <Pressable onPress={() => Linking.openURL(fileUrl(o.path))}>
          <Text style={s.fileLink}>📄 {o.name || "Download"}</Text>
        </Pressable>
      );

    case "process":
      return <ProcessViewer path={o.path} fileUrl={fileUrl} onExpandImage={onExpandImage} />;

    case "choices":
      return (
        <View style={s.choices}>
          <Text style={s.mdBody}>{o.text}</Text>
          <View style={s.choiceRow}>
            {(o.options || []).map((opt) => (
              <Pressable key={opt} style={s.choiceBtn} onPress={() => onChoice(o.topic, opt)}>
                <Text style={s.choiceBtnText}>{opt}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      );

    default:
      return <Text style={s.unknown}>[{o.type}]</Text>;
  }
}

const s = StyleSheet.create({
  mdSection: { marginVertical: 4 },
  mdHeading: { fontSize: 16, fontWeight: "600", color: "#2d6cdf", marginBottom: 2 },
  mdBody: { fontSize: 16, color: "#1a1a1a", lineHeight: 22 },
  note: { fontStyle: "italic", color: "#555", fontSize: 14 },
  plan: { fontSize: 12, color: "#888" },
  imageWrap: { marginVertical: 4 },
  image: { width: "100%", height: 220, borderRadius: 8, backgroundColor: "#eee" },
  imgPlaceholder: { backgroundColor: "#eee" },
  caption: { fontSize: 12, color: "#666", marginTop: 4 },
  tapHint: { fontSize: 11, color: "#aaa", marginTop: 2 },
  fileLink: { color: "#2d6cdf", marginVertical: 4, fontSize: 15 },
  sources: { marginVertical: 4 },
  sourceNote: { fontSize: 12, color: "#777" },
  unknown: { color: "#a30000", fontSize: 12 },
  choices: { marginVertical: 4 },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  choiceBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: "#2d6cdf" },
  choiceBtnText: { color: "#2d6cdf", fontSize: 14 },
  process: { borderWidth: 1, borderColor: "#e0e0e0", borderRadius: 10, padding: 10, marginVertical: 4, backgroundColor: "#fafafa" },
  processTitle: { fontWeight: "600", marginBottom: 6 },
  processShape: { fontWeight: "400", color: "#888", fontSize: 12 },
  processStepHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  processStepN: { fontSize: 12, color: "#888" },
  processStatus: { fontSize: 11, textTransform: "capitalize", paddingHorizontal: 8, paddingVertical: 1, borderRadius: 10, overflow: "hidden" },
  statusReady: { backgroundColor: "#e3f6e8", color: "#1a7a3a" },
  statusPending: { backgroundColor: "#fff3cd", color: "#8a6d00" },
  processStepTitle: { fontSize: 15, fontWeight: "600", marginVertical: 4 },
  processImg: { width: "100%", height: 200, borderRadius: 8, backgroundColor: "#eee", marginVertical: 4 },
  processNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  navBtn: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: "#d0d0d0" },
  navBtnDisabled: { opacity: 0.4 },
  navBtnText: { fontSize: 13 },
  dots: { flexDirection: "row", gap: 5 },
  dot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1, borderColor: "#c0c0c0" },
  dotActive: { backgroundColor: "#2d6cdf", borderColor: "#2d6cdf" },
});
