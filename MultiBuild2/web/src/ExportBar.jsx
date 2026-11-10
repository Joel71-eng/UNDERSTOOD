import React, { useState } from "react";

// Mirrors mm_app.py's export bar (lines ~332-359) field for field: scope (this answer vs the whole
// discussion, defaulting to "this answer" only when the chat actually has a figure to export), how many
// of the last exchanges to include (disabled when exporting the whole chat or just one figure), and a
// depth radio that applies to notes/slides/video alike. Four buttons call the exact same `action`s
// mm_app.py's go() does (pdf/slides/lesson/notes), so mm_api.py/mm_engine.py need no changes at all.
export default function ExportBar({ chat, onSend }) {
  const nEx = chat.filter((m) => m.role === "user").length;
  const hasFig = chat.some((m) => m.role === "assistant" && (m.outputs || []).some((o) => o.type === "image" || o.type === "process"));

  const [scope, setScope] = useState(hasFig ? "figure" : "chat");
  const [whole, setWhole] = useState(false);
  const [nPick, setNPick] = useState(Math.min(4, Math.max(1, nEx)));
  const [depth, setDepth] = useState("standard");

  if (nEx === 0) return null;

  const history = whole ? null : nPick;
  const exOpts = { scope, history, depth };

  return (
    <div className="export-bar">
      <p className="export-title">Export</p>
      <div className="export-scope">
        <label className="export-radio">
          <input type="radio" checked={scope === "figure"} onChange={() => setScope("figure")} />
          This picture / answer
        </label>
        <label className="export-radio">
          <input type="radio" checked={scope === "chat"} onChange={() => setScope("chat")} />
          Our discussion
        </label>
      </div>
      <div className="export-row">
        <input
          className="export-n"
          type="number"
          min={1}
          max={Math.max(1, nEx)}
          value={nPick}
          disabled={whole || scope === "figure"}
          onChange={(e) => setNPick(Math.max(1, Math.min(nEx, Number(e.target.value) || 1)))}
          title="How many of the last exchanges to include"
        />
        <label className="export-whole">
          <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />
          Whole chat
        </label>
      </div>
      <div className="export-depth">
        {["brief", "standard", "deep"].map((d) => (
          <label key={d} className="export-radio">
            <input type="radio" checked={depth === d} onChange={() => setDepth(d)} />
            {d[0].toUpperCase() + d.slice(1)}
          </label>
        ))}
      </div>
      <div className="export-buttons">
        <button onClick={() => onSend({ action: "pdf", text: "", shown_text: "Make a PDF", ...exOpts })}>📄 PDF</button>
        <button onClick={() => onSend({ action: "slides", text: "", shown_text: "Make slides", ...exOpts })} title="PDF slides and an editable PowerPoint">
          🖥 Slides
        </button>
        <button onClick={() => onSend({ action: "lesson", text: "", shown_text: "Play the narrated lesson", ...exOpts })}>🔊 Video</button>
        <button
          onClick={() =>
            onSend({ action: "notes", text: "", mode_notes: "condensed", shown_text: "Make notes of our discussion", scope: "chat", history, depth })
          }
          title="Revision notes of the discussion"
        >
          📝 Notes
        </button>
      </div>
    </div>
  );
}
