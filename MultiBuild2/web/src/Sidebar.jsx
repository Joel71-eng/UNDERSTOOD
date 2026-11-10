import React, { useEffect, useState } from "react";
import { createThread, listThreads, keepThread, deleteThread, getMeta } from "./api.js";
import ToolsPanel from "./ToolsPanel.jsx";

// Mirrors mm_app.py's `with st.sidebar:` block (lines ~106-126) almost line for line: title + tagline,
// "New chat", up to 12 recent threads (bold marker on the active one), a retention caption, and a
// "This chat" section with Keep/Delete. Streamlit's version re-reads the thread list on every rerun
// (the whole script re-executes); here that becomes an explicit refresh() the parent calls after
// anything that could change it (new chat, delete, or a message landing that might retitle the thread).
export default function Sidebar({ tid, onSwitchThread, onNewThread, running, refreshKey, onActiveTitle, onSend }) {
  const [threads, setThreads] = useState([]);
  const [retentionHours, setRetentionHours] = useState(null);
  const [open, setOpen] = useState(true); // collapsible, not just for mobile - Streamlit's sidebar is too

  async function refresh() {
    try {
      const list = await listThreads();
      setThreads(list.slice(0, 12));
    } catch (e) {
      /* sidebar is a convenience, not critical - a failed refresh just leaves the last known list up */
    }
  }

  useEffect(() => {
    refresh();
    getMeta()
      .then((m) => setRetentionHours(m.retention_hours))
      .catch(() => {});
  }, [refreshKey]);

  const current = threads.find((t) => t.id === tid);

  useEffect(() => {
    onActiveTitle?.(current?.title || "");
  }, [current?.title]);

  async function handleNewChat() {
    const { thread_id } = await createThread();
    onNewThread(thread_id);
    refresh();
  }

  async function handleToggleKeep() {
    if (!current) return;
    await keepThread(tid, !current.kept);
    refresh();
  }

  async function handleDelete() {
    if (!tid || running) return;
    if (!window.confirm("Delete this chat? This can't be undone.")) return;
    await deleteThread(tid);
    const list = await listThreads();
    const next = list[0]?.id || (await createThread()).thread_id;
    onSwitchThread(next);
    setThreads(list.slice(0, 12));
  }

  if (!open) {
    return (
      <button className="sidebar-collapsed" onClick={() => setOpen(true)} title="Show chats">
        ▸
      </button>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <h2 className="sidebar-title">Understood</h2>
        <button className="sidebar-collapse" onClick={() => setOpen(false)} title="Hide sidebar">
          ◂
        </button>
      </div>
      <p className="sidebar-tagline">Learn it. See it. Understand it.</p>

      <button className="sidebar-newchat" onClick={handleNewChat}>
        ＋ New chat
      </button>

      <nav className="sidebar-threads">
        {threads.map((t) => (
          <button
            key={t.id}
            className={`sidebar-thread ${t.id === tid ? "active" : ""}`}
            onClick={() => onSwitchThread(t.id)}
            title={t.title}
          >
            {t.id === tid ? "▸ " : ""}
            {t.kept && "★ "}
            {t.title || "New chat"}
          </button>
        ))}
      </nav>

      <p className="sidebar-retention">
        {retentionHours
          ? `Chats are kept for ${retentionHours}h after you last use them.`
          : retentionHours === 0
          ? "Chats are kept until you delete them."
          : ""}
      </p>

      <div className="sidebar-this-chat">
        <p className="sidebar-section-label">This chat</p>
        <label className="sidebar-keep">
          <input type="checkbox" checked={!!current?.kept} onChange={handleToggleKeep} />
          Keep this chat
        </label>
        <button className="sidebar-delete" onClick={handleDelete} disabled={running}>
          🗑 Delete this chat
        </button>
      </div>

      <ToolsPanel onSend={onSend} running={running} />
    </aside>
  );
}
