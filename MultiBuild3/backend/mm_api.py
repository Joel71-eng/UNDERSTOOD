"""
mm_api.py - thin HTTP wrapper around the existing Engine (mm_engine.py), for the web and mobile clients.

No new app logic lives here: every route is a direct call into Engine methods mm_app.py (the Streamlit app)
already uses. Streamlit keeps working unchanged; this just gives a second, HTTP-based front door onto the
same engine, same data directory, same Colab GPU server.

Run:   uvicorn mm_api:app --reload --port 8800
Needs the same environment as mm_app.py: UNDERSTOOD_SERVER (the Colab GPU server URL), optionally
UNDERSTOOD_DATA / UNDERSTOOD_BANK_DIR / UNDERSTOOD_RETENTION_HOURS.

Request/response shapes mirror exactly what mm_app.py already sends/reads from the Engine (see its `go()`
helper and `attach()`), so the web and mobile clients are just reimplementing that same calling pattern over
HTTP instead of a direct Python call.

CORS is wide open below - fine for solo local testing (web dev server + Expo on a phone, different origins),
NOT fine to ship as-is: lock allow_origins down before this is ever reachable from outside your own machine.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

import mm_engine as E

DATA_DIR = Path(os.environ.get("UNDERSTOOD_DATA", Path.home() / "understood_data"))
SERVER_URL = os.environ.get("UNDERSTOOD_SERVER", "https://outdoors-graph-tremor.ngrok-free.dev")

app = FastAPI(title="Understood API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

engine = E.Engine(DATA_DIR, SERVER_URL)


# =====================================================================================================
# Request/response shapes
# =====================================================================================================
class Attachment(BaseModel):
    name: str
    data_b64: str


class MessageIn(BaseModel):
    text: str = ""
    shown_text: Optional[str] = None
    mode: str = "assistant"                      # assistant | tutor | studio | edit
    level: Optional[str] = None                  # ordinary | advanced | university
    action: Optional[str] = None                 # show_as | pdf | slides | lesson | notes | guide | retry_step | ...
    attachments: list[Attachment] = Field(default_factory=list)
    options: dict = Field(default_factory=dict)
    # Everything below mirrors fields mm_app.py puts at the TOP LEVEL of the dict it hands straight to
    # engine.start() (see its go() helper) - mm_engine.py reads these as req.get("kind")/req.get("scope")/
    # etc, not nested under "options", so they have to be declared here too or Pydantic's model_dump()
    # silently drops them before the request ever reaches the engine.
    kind: Optional[str] = None                   # show_as: diagram | process | picture
    scope: Optional[str] = None                  # export: "figure" (this answer) | "chat" (the discussion)
    history: Optional[int] = None                # export: how many of the last exchanges to include (None = whole chat)
    depth: Optional[str] = None                  # export: brief | standard | deep
    mode_notes: Optional[str] = None              # notes action: condensed | full
    n: Optional[int] = None                       # retry_step: which step to redo


class KeepIn(BaseModel):
    on: bool = True


# =====================================================================================================
# Threads
# =====================================================================================================
@app.post("/threads")
def create_thread():
    return {"thread_id": engine.store.new_thread()}


@app.get("/threads")
def list_threads():
    # "kept" mirrors mm_app.py's sidebar check `(engine.tdir(tid) / ".keep").exists()` - exposed here so
    # the web/mobile sidebar can show the right toggle state without a second round-trip per thread.
    return [{"id": tid, "title": title, "ts": ts, "kept": (engine.tdir(tid) / ".keep").exists()}
            for tid, title, ts in engine.store.threads()]


@app.post("/threads/{tid}/keep")
def keep_thread(tid: str, body: KeepIn):
    engine.pin(tid, body.on)
    return {"kept": body.on}


@app.delete("/threads/{tid}")
def delete_thread(tid: str):
    engine.delete_thread(tid)
    return {"deleted": True}


@app.get("/threads/{tid}/chat")
def thread_chat(tid: str):
    return engine.chat_get(tid)


@app.get("/threads/{tid}/state")
def thread_state(tid: str):
    """What's currently on screen for this thread: the figure (diagram/process), current image, docs, level."""
    return engine.state(tid)


# ---- sending a message / resuming / cancelling - all run in a background thread, same as the Streamlit app --------
@app.post("/threads/{tid}/message")
def send_message(tid: str, msg: MessageIn):
    req = msg.model_dump(exclude_none=True)
    if not engine.start(tid, req):
        raise HTTPException(409, "a run is already in progress for this thread")
    return {"started": True}


@app.post("/threads/{tid}/resume")
def resume_thread(tid: str):
    if not engine.start(tid, None):
        raise HTTPException(409, "a run is already in progress for this thread")
    return {"started": True}


@app.post("/threads/{tid}/cancel")
def cancel_thread(tid: str):
    return {"cancelled": engine.cancel(tid)}


@app.get("/threads/{tid}/status")
def thread_status(tid: str):
    """Poll this while status == 'running': it carries the same live outputs/steps/log the Streamlit app
    shows while a request is still being worked on."""
    return {"status": engine.status(tid), **engine.live(tid)}


# =====================================================================================================
# Files (generated images, PDFs, videos - anything an output's "path" field points at)
# =====================================================================================================
@app.get("/files/{rel_path:path}")
def get_file(rel_path: str):
    p = engine.abs(rel_path).resolve()
    root = engine.data_dir.resolve()
    if root not in p.parents and p != root:
        raise HTTPException(403, "forbidden")
    if not p.exists() or not p.is_file():
        raise HTTPException(404, "not found")
    return FileResponse(p)


# =====================================================================================================
# Misc
# =====================================================================================================
@app.get("/bank/status")
def bank_status():
    return engine.bank_status()


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/meta")
def meta():
    """Small, rarely-changing facts the sidebar wants once at load (mirrors mm_app.py's retention
    caption: "Chats are kept for X hours..." / "...until you delete them" when retention_hours == 0)."""
    return {"retention_hours": engine.retention_hours}
