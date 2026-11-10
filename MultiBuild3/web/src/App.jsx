import React, { useEffect, useRef, useState } from "react";
import {
  createThread,
  getChat,
  getStatus,
  sendMessage,
  cancelThread,
  resumeThread,
  fileToAttachment,
  fileUrl,
} from "./api.js";
import Output from "./Output.jsx";
import Sidebar from "./Sidebar.jsx";
import ExportBar from "./ExportBar.jsx";
import "./index.css";

// Mirrors mm_app.py's Output selector exactly (OUTPUTS = ["Auto", "Diagram", "Process", "Picture",
// "Explain", "Edit"]). Learning levels were retired there in favor of this ("learning levels are
// retired for now: one standard depth" - level_key is hardcoded to "university" server-side) so this
// app drops the level dropdown entirely instead of keeping a control the tutor no longer reads.
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
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState(null); // {outputs, steps, i, log} while a request is in progress
  const [error, setError] = useState("");
  const [parked, setParked] = useState(false);
  const [viewerUrl, setViewerUrl] = useState(null); // full-screen image lightbox
  const [sidebarRefresh, setSidebarRefresh] = useState(0); // bump to make Sidebar re-fetch its thread list
  const [threadTitle, setThreadTitle] = useState("");
  const [composerActive, setComposerActive] = useState(false); // drives the glowing-border animation while typing
  const pollRef = useRef(null);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  // One place that loads a given thread's chat and resets all the per-thread UI state - used for first
  // load AND for switching threads from the sidebar, so the two never drift into different behavior.
  async function openThread(id) {
    clearInterval(pollRef.current);
    localStorage.setItem("understood_tid", id);
    setTid(id);
    setRunning(false);
    setLive(null);
    setParked(false);
    setError("");
    setText("");
    setFiles([]);
    try {
      setChat(await getChat(id));
    } catch (e) {
      setError(String(e));
    }
  }

  // ---- start a thread on first load, or reuse the one from last time -------------------------------------
  useEffect(() => {
    const saved = localStorage.getItem("understood_tid");
    (async () => {
      try {
        const id = saved || (await createThread()).thread_id;
        await openThread(id);
      } catch (e) {
        setError(String(e));
      }
    })();
    return () => clearInterval(pollRef.current);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, live]);

  // ---- poll while a request is running, then refresh the real chat once it's done ------------------------
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
          setChat(await getChat(id));
          setSidebarRefresh((n) => n + 1); // the engine may have auto-titled the thread from this message
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

  // Mirrors mm_app.py's chat_input handling: which fields go on the request depends on the chosen
  // Output kind, not a free-text mode guess - "Auto" is the only one that asks the engine to decide AND
  // tell the student what it understood (auto_note), the rest commit to a specific action up front.
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
    const t = text.trim();
    if (!t && files.length === 0) return;
    const attachments = await Promise.all(files.map(fileToAttachment));
    setText("");
    setFiles([]);
    await send(buildRequest(t, attachments));
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
  // dropped connection mid-generation is actually recoverable instead of losing the request.
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

  return (
    <div className="layout">
      <Sidebar
        tid={tid}
        onSwitchThread={openThread}
        onNewThread={openThread}
        running={running}
        refreshKey={sidebarRefresh}
        onActiveTitle={setThreadTitle}
        onSend={send}
      />
      <div className="app">
      {/* "Understood" now lives once, in the sidebar - this bar shows the thing that actually changes as
          you work (which chat you're in, and whether it's offline), instead of repeating the app name. */}
      <header className="header">
        <h1>{threadTitle || "New chat"}</h1>
      </header>

      <main className="thread">
        {chat.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.role === "user" ? (
              <>
                {m.text && <p>{m.text}</p>}
                {m.files?.length > 0 && <p className="files">📎 {m.files.join(", ")}</p>}
              </>
            ) : (
              <>
                {(m.outputs || []).map((o, j) => (
                  <Output key={j} o={o} fileUrl={fileUrl} onChoice={handleChoice} onExpandImage={setViewerUrl} />
                ))}
                {m.status === "parked" && <p className="parked-note">The connection was lost. Your request is saved - press Resume below.</p>}
                {m.status === "failed" && <p className="error-inline">Sorry, I could not finish that. Please try again or rephrase.</p>}
              </>
            )}
          </div>
        ))}

        {running && (
          <div className="bubble assistant live">
            <p className="thinking">Working on it…</p>
            {(live?.outputs || []).map((o, j) => (
              <Output key={j} o={o} fileUrl={fileUrl} onChoice={handleChoice} onExpandImage={setViewerUrl} />
            ))}
            {live?.steps?.length > 0 && (
              <p className="progress">
                Step {live.i + 1} of {live.steps.length}
              </p>
            )}
            {/* Mirrors mm_app.py's status expander: the tail of engine.live()'s activity log, so you can
                see what the tutor is actually doing (e.g. "checking the diagram bank", "drawing step 3")
                instead of just a spinner - useful for a slow Colab GPU cold-start. */}
            {live?.log?.length > 0 && (
              <p className="live-log">{live.log.slice(-5).join(" · ")}</p>
            )}
            <button className="cancel" onClick={handleCancel}>
              Stop
            </button>
          </div>
        )}

        {!running && parked && (
          <button className="resume-btn" onClick={handleResume}>
            ▶ Resume where I stopped
          </button>
        )}

        {error && <div className="bubble error">{error}</div>}

        {chat.length === 0 && !running && (
          <div className="suggestions">
            <p className="suggestions-title">Try asking for:</p>
            {[
              "Draw a labelled diagram of the human heart",
              "Explain how photosynthesis works, step by step",
              "What's the difference between mitosis and meiosis?",
            ].map((s) => (
              <button key={s} className="suggestion-chip" onClick={() => setText(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      {/* mm_app.py only shows this once the last turn is a completed assistant answer - mid-generation
          or right after an error there's nothing sensible to export yet. */}
      {!running && chat.length > 0 && chat[chat.length - 1]?.role === "assistant" && chat[chat.length - 1]?.status === "done" && (
        <ExportBar chat={chat} onSend={send} />
      )}

      <div className="out-kind-row">
        {OUTPUT_KINDS.map((o) => (
          <button
            key={o.key}
            className={`out-pill ${outKind === o.key ? "active" : ""}`}
            onClick={() => !running && setOutKind(o.key)}
            disabled={running}
            title={o.desc}
          >
            {o.key}
          </button>
        ))}
      </div>
      <p className="out-kind-desc">{OUTPUT_KINDS.find((o) => o.key === outKind)?.desc}</p>

      <footer className={`composer ${composerActive ? "active" : ""}`}>
      <div className="composer-box">
        {/* A raw <input type=file> renders its own ugly native "Choose File" button in every browser and
            can't be restyled directly - the usual fix is to hide it entirely and trigger it from a button
            we DO control, via a ref. The title attribute gives the hover info-box the feedback asked for. */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden-file-input"
          onChange={(e) => setFiles(Array.from(e.target.files))}
          disabled={running}
        />
        <button
          type="button"
          className="attach-btn"
          title="Attach an image, PDF, or document for the tutor to look at"
          onClick={() => fileInputRef.current?.click()}
          disabled={running}
        >
          +
        </button>
        {files.length > 0 && <span className="files-preview">{files.map((f) => f.name).join(", ")}</span>}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setComposerActive(true)}
          onBlur={() => setComposerActive(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask a question, or say what to draw, explain, change or make…"
          disabled={running}
        />
        <button className="send-btn" onClick={handleSend} disabled={running}>
          Send
        </button>
      </div>
      </footer>

      {viewerUrl && (
        <div className="viewer-backdrop" onClick={() => setViewerUrl(null)}>
          <img className="viewer-img" src={viewerUrl} alt="expanded" />
          <a className="viewer-download" href={viewerUrl} download onClick={(e) => e.stopPropagation()}>
            ⬇ Download
          </a>
          <p className="viewer-hint">Click anywhere to close</p>
        </div>
      )}
      </div>
    </div>
  );
}
