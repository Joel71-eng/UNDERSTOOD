# Understood — bundled build (backend + web + mobile)

This zip mirrors the Streamlit app (`mm_app.py`) onto a web app (React/Vite) and a mobile app
(Expo/React Native), talking to the same engine through a new FastAPI wrapper (`mm_api.py`). Nothing
in `mm_engine.py` or any other `mm_*.py` module changed in a breaking way — `mm_app.py` still runs
exactly as before, side by side with the new HTTP front doors.

## What's in here

```
backend/        mm_api.py, mm_engine.py, mm_app.py and all other mm_*.py modules, requirements.txt
web/             React/Vite web app (src/, package.json, vite.config.js, index.html, a pre-built dist/)
mobile/          Expo/React Native app (App.js, src/, app.json, package.json)
```

## Running it

**Backend** (same machine as before, needs `UNDERSTOOD_SERVER` pointed at your Colab GPU server):
```
cd backend
pip install -r requirements.txt
pip install fastapi uvicorn   # the two new deps mm_api.py needs on top of the Streamlit stack
uvicorn mm_api:app --reload --port 8800
```
`mm_app.py` (Streamlit) keeps working unchanged if you still want it: `streamlit run mm_app.py`.

**Web**:
```
cd web
npm install
npm run dev      # or: serve the pre-built dist/ with any static file server
```

**Mobile** (phone and PC must be on the same wifi; set the server address via the ⚙ gear icon the
first time you open the app — see "What changed" below, this is what fixed the crash):
```
cd mobile
npm install
npx expo start
```

## What changed this round (against your itemized feedback)

### Web
- **Study levels removed** — matches `mm_app.py` itself: levels are retired there too (hardcoded to
  "university" server-side), replaced by the same `Auto/Diagram/Process/Picture/Explain/Edit` output-kind
  selector Streamlit uses.
- **Sidebar added** (`src/Sidebar.jsx`) — title/tagline, New chat, up to 12 recent threads (active one
  marked, kept ones starred), retention caption, Keep/Delete for the current chat, and the "🧰 More
  tools" panel — all mirroring `mm_app.py`'s `st.sidebar` block exactly.
- **Icons** — New chat, Keep (★), Delete (🗑), attach (+ with a hover tooltip), export buttons
  (📄🖥🔊📝), expand/download on images.
- **Images/outputs click to expand + download** — full-screen lightbox with a download link.
- **Composer** — rounded, centered, reactive to width changes; the `+` file icon replaces the raw
  browser file input (which is hidden and triggered via a ref) and has a hover tooltip; right-margin bug
  fixed (`padding: 0 16px` on the app column instead of being flush to the edge).
- **Header** — no more fixed "Understood" bar; the title now shows the active chat's name (the
  app name lives once, in the sidebar, same as Streamlit only shows it once in the sidebar too).
- **New chat / thread history** — New chat button + thread list live in the sidebar; switching threads
  resets all per-thread UI state through one shared `openThread()` path so it can't drift from first load.
- **Per-prompt framing to reduce hallucination** — this was already handled server-side by the engine's
  dialogue-act/topic classification (each request is read for what *that* message needs before deciding
  how much prior context to pull in); no front-end change needed, confirmed by re-reading `mm_engine.py`.
- **Live steps while running** — the tail of the engine's activity log (`status.log`, last 5 entries)
  now renders under the "Working on it…" bubble, same data Streamlit's status expander shows.
- **Caching / robustness** — the parked/resume flow (`"The connection was lost... press Resume below"`)
  was already present and is unchanged; threads reload from the server on every switch so a reload never
  loses anything that was actually saved server-side.
- **Export bar** (`src/ExportBar.jsx`) — scope (this answer vs. the whole discussion), whole-chat
  toggle, how-many-exchanges field, Brief/Standard/Deep depth, and PDF/Slides/Video/Notes buttons —
  field-for-field the same as `mm_app.py`'s export bar, sending the same `action`/`scope`/`history`/`depth`
  shape the engine already reads.

### Mobile
- **Learning levels** — same fix as web: dropped in favor of the output-kind selector.
- **Expandable sidebar** (`src/Sidebar.js`) — a slide-over drawer (phones don't have the width for a
  persistent column) with the same New chat/thread-list/Keep/Delete/retention content as web, opened via
  a ☰ button in the header, plus the same "More tools" panel mounted inside it.
  (`src/ToolsPanel.js` — Picture/Edit/Learn tabs, same request shapes as web's version.)
- **Prompt bar covered by the keyboard** — the composer already sits inside a `KeyboardAvoidingView`
  (`behavior="padding"` on iOS, `"height"` on Android, with an iOS vertical offset for the header); if
  this is still happening on your device after this build, it's most likely the offset value needing a
  tweak for your specific phone's header height rather than a missing fix — flag it with a screenshot and
  we'll dial it in.
- **Export bar** (`src/ExportBar.js`) — same fields and buttons as web's, shown above the composer once
  an answer finishes.
- **Font size** — bumped a notch across chat bubbles, input, and markdown output (`App.js`, `Output.js`).
- **`MalformedURLException: no protocol` crash** — fixed via the ⚙ Settings screen: the server address
  you type is normalized (an `http://` prefix is added automatically if you leave it off) before it's
  ever used in a request. Open Settings once and (re)enter your PC's address.
- **Camera capture** — confirmed already working, no changes needed.

### Backend
- `mm_api.py`'s `MessageIn` schema was silently dropping `kind`/`scope`/`history`/`depth`/`mode_notes`/`n`
  — fields `mm_app.py` sends at the top level of its request dict and `mm_engine.py` reads directly. This
  meant the "show it as a diagram/process" quick-choice buttons (and the new Export bar) would have sent
  requests the engine couldn't actually act on. All six fields are now declared explicitly on the model.
- Added `POST /threads/{tid}/keep`, `DELETE /threads/{tid}`, and `GET /meta` (exposes `retention_hours`)
  — the HTTP front doors onto `Engine.pin()` / `Engine.delete_thread()` / the retention setting that
  `mm_app.py` already uses directly, now reachable from web and mobile too. `GET /threads` also now
  returns a `kept` flag per thread.

## What changed — prompt box centering + click animation (latest round)

- **Centered + responsive** (web) — the composer is now its own centered element (`width: min(100%,
  720px); margin: 0 auto`) instead of relying only on the parent column's centering, so it stays centered
  and reactive to the available width even if the sidebar width or page layout changes later.
- **Centered + responsive** (mobile) — the composer changed from a full-width bar docked under a top
  border into a floating rounded pill inset from both edges by the same margin on any screen size
  (`marginHorizontal: 12`), matching the web version's look and Streamlit's own floating `st.chat_input`.
- **Colored light animation on click** (both) — clicking into the prompt box (textarea/TextInput focus)
  now animates a ring of color (blue → purple → pink → orange → blue) chasing itself around the box's
  border, and stops when you click away (blur). Web uses a spinning CSS `conic-gradient` clipped to the
  pill's rounded shape; mobile has no `conic-gradient` or gradient library installed, so it uses a single
  glowing dot (built on React Native's own `Animated` API, no new dependency) that travels the same
  border path and cycles through the same colors — visually a little simpler than web's full ring, but
  the same idea with zero new native modules to install.

## Known simplification

The study-guide/notes document currently opens as a download link rather than a rich inline viewer on
either client — functionally complete (you get the file), just not as polished as it could be. Flagging
it rather than silently leaving it; happy to build an inline viewer next if it's worth the time versus
other priorities.
