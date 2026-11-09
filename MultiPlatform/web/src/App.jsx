import React, { useEffect, useRef, useState } from "react";
import {
  createThread,
  getChat,
  getStatus,
  sendMessage,
  cancelThread,
  fileToAttachment,
  fileUrl,
} from "./api.js";
import Output from "./Output.jsx";
import "./index.css";

const LEVELS = [
  { key: "ordinary", label: "Ordinary (S1-S4)" },
  { key: "advanced", label: "Advanced (S5-S6)" },
  { key: "university", label: "University" },
];

export default function App() {
  const [tid, setTid] = useState(null);
  const [chat, setChat] = useState([]);
  const [text, setText] = useState("");
  const [level, setLevel] = useState("ordinary");
  const [files, setFiles] = useState([]);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState(null); // {outputs, steps, i, log} while a request is in progress
  const [error, setError] = useState("");
  const pollRef = useRef(null);
  const bottomRef = useRef(null);

  // ---- start a thread on first load, or reuse the one from last time -------------------------------------
  useEffect(() => {
    const saved = localStorage.getItem("understood_tid");
    (async () => {
      try {
        const id = saved || (await createThread()).thread_id;
        localStorage.setItem("understood_tid", id);
        setTid(id);
        setChat(await getChat(id));
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
          setChat(await getChat(id));
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
    const t = text.trim();
    if (!t && files.length === 0) return;
    const attachments = await Promise.all(files.map(fileToAttachment));
    setText("");
    setFiles([]);
    await send({ text: t, shown_text: t, mode: "assistant", level, attachments });
  }

  async function handleChoice(topic, kind) {
    await send({ action: "show_as", kind, text: topic, shown_text: `Show it as a ${kind}`, level });
  }

  async function handleCancel() {
    if (!tid) return;
    await cancelThread(tid);
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Understood</h1>
        <select value={level} onChange={(e) => setLevel(e.target.value)} disabled={running}>
          {LEVELS.map((l) => (
            <option key={l.key} value={l.key}>
              {l.label}
            </option>
          ))}
        </select>
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
              (m.outputs || []).map((o, j) => (
                <Output key={j} o={o} fileUrl={fileUrl} onChoice={handleChoice} />
              ))
            )}
          </div>
        ))}

        {running && (
          <div className="bubble assistant live">
            <p className="thinking">Working on it…</p>
            {(live?.outputs || []).map((o, j) => (
              <Output key={j} o={o} fileUrl={fileUrl} onChoice={handleChoice} />
            ))}
            {live?.steps?.length > 0 && (
              <p className="progress">
                Step {live.i + 1} of {live.steps.length}
              </p>
            )}
            <button className="cancel" onClick={handleCancel}>
              Stop
            </button>
          </div>
        )}

        {error && <div className="bubble error">{error}</div>}
        <div ref={bottomRef} />
      </main>

      <footer className="composer">
        <input
          type="file"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files))}
          disabled={running}
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask anything, or try: draw a labelled diagram of the human heart"
          disabled={running}
        />
        <button onClick={handleSend} disabled={running}>
          Send
        </button>
      </footer>
    </div>
  );
}
