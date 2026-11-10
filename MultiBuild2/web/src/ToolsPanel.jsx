import React, { useState } from "react";
import { fileToAttachment } from "./api.js";

// Mirrors mm_app.py's "🧰 More tools" sidebar expander (3 tabs: Picture/Edit/Learn) almost field for
// field - same options, same defaults, same disabled conditions - just built from form state instead of
// Streamlit's rerun-per-widget model. `onSend` is the same send({text, mode, action, options, ...})
// the composer uses, so a tool-panel request goes through the exact same path as typing it in chat.
export default function ToolsPanel({ onSend, running }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("pic"); // pic | edit | learn

  const [picPrompt, setPicPrompt] = useState("");
  const [aspect, setAspect] = useState("square");
  const [quality, setQuality] = useState(false); // false=fast, true=high

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

  async function changePicture() {
    const t = editText.trim();
    if (!t) return;
    const attachments = editFile ? [await fileToAttachment(editFile)] : [];
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
    <div className="tools-panel">
      <button className="tools-toggle" onClick={() => setOpen((v) => !v)}>
        🧰 More tools {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="tools-body">
          <p className="tools-hint">Everything here can also be asked for by typing in the chat. Exports are at the end of each answer.</p>
          <div className="tools-tabs">
            {[
              ["pic", "Picture"],
              ["edit", "Edit"],
              ["learn", "Learn"],
            ].map(([key, label]) => (
              <button key={key} className={`tools-tab ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </div>

          {tab === "pic" && (
            <div className="tools-form">
              <textarea className="tools-textarea" placeholder="Describe the picture" value={picPrompt} onChange={(e) => setPicPrompt(e.target.value)} rows={3} />
              <div className="tools-row">
                <select className="tools-select" value={aspect} onChange={(e) => setAspect(e.target.value)}>
                  <option value="square">Square</option>
                  <option value="wide">Wide</option>
                  <option value="tall">Tall</option>
                </select>
                <label className="tools-toggle-label">
                  <input type="checkbox" checked={quality} onChange={(e) => setQuality(e.target.checked)} />
                  Higher quality (slower)
                </label>
              </div>
              <button className="tools-btn" disabled={running || !picPrompt.trim()} onClick={createPicture}>
                Create picture
              </button>
            </div>
          )}

          {tab === "edit" && (
            <div className="tools-form">
              <label className="tools-filelabel">
                Picture to change (empty = the last picture in this chat)
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setEditFile(e.target.files?.[0] || null)} />
              </label>
              <input className="tools-input" placeholder="What should change?" value={editText} onChange={(e) => setEditText(e.target.value)} />
              <button className="tools-btn" disabled={running || !editText.trim()} onClick={changePicture}>
                Change it
              </button>
            </div>
          )}

          {tab === "learn" && (
            <div className="tools-form">
              <input className="tools-input" placeholder="e.g. the human brain" value={topic} onChange={(e) => setTopic(e.target.value)} />
              <div className="tools-row">
                <button className="tools-btn tools-btn-half" disabled={running || !topic.trim()} onClick={askDiagram}>
                  Diagram
                </button>
                <button className="tools-btn tools-btn-half" disabled={running || !topic.trim()} onClick={askProcess}>
                  Process
                </button>
              </div>
              <label className="tools-toggle-label">
                <input type="checkbox" checked={withQuestions} onChange={(e) => setWithQuestions(e.target.checked)} />
                Study guide with practice questions
              </label>
              <button className="tools-btn" disabled={running} onClick={askGuide}>
                Study guide
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
