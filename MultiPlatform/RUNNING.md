# Running the full Understood build (backend + web + mobile)

Three pieces, in a fixed start order, because each one depends on the one before it:

```
Colab (GPU)  →  your PC (mm_api.py)  →  web (browser) and/or mobile (phone, Expo Go)
mm_server.py     FastAPI wrapper         both just talk HTTP to mm_api.py
```

Nothing in `backend/`, `web/`, or `mobile/` changed how the engine itself works — this is the same
`Engine` class `mm_app.py` (the Streamlit app) has always used. `mm_api.py` is a second, HTTP-based front
door onto the same engine, same data directory, same Colab GPU server, so Streamlit keeps working
unchanged if you still want it for quick manual testing.

---

## 1. Start the Colab GPU server

1. Open `backend/Understood_MM_Server.ipynb` in Colab, GPU runtime.
2. Run cells 1–6 (cell 1 restarts the runtime once — just run it again after).
3. Cell 6 opens the **ngrok** tunnel on the permanent address:
   `https://outdoors-graph-tremor.ngrok-free.dev`
   One-time setup: Colab Secrets (key icon) → add `ngrok_token` → switch "Notebook access" on.
4. If anything looks wrong, run cell 8 to print the server + tunnel logs.

You now have a GPU server reachable from anywhere at that fixed URL — it doesn't change between runs,
so you only need to do this again when the Colab session itself ends.

**No GPU / testing offline-only:** `cd backend && UNDERSTOOD_MOCK=1 python mm_server.py` runs a fake
server on `localhost:8000` that returns placeholder images instantly — good for UI testing without
burning GPU time.

---

## 2. Start `mm_api.py` on your PC

This replaces `streamlit run mm_app.py` as the thing the web/mobile clients talk to (Streamlit still
works if you want it, just not used by web/mobile).

```bash
cd backend
pip install -r requirements.txt

export UNDERSTOOD_SERVER=https://outdoors-graph-tremor.ngrok-free.dev   # or http://localhost:8000 for the mock server
# optional: export UNDERSTOOD_DATA=/path/to/data   (defaults to ~/understood_data)

uvicorn mm_api:app --reload --host 0.0.0.0 --port 8800
```

`--host 0.0.0.0` (not the default `127.0.0.1`) matters for the mobile step below — it's what lets your
phone, on the same wifi, reach this process at your PC's LAN IP instead of only `localhost` working.

Check it's alive: `curl http://localhost:8800/health` → `{"ok": true}`.

**Windows PowerShell:** use `$env:UNDERSTOOD_SERVER = "https://..."` instead of `export`.

CORS is wide open in `mm_api.py` (`allow_origins=["*"]`) — fine for this solo local-testing setup, but
don't deploy it publicly as-is (there's a comment flagging this at the top of the file).

---

## 3. Run the web app

```bash
cd web
npm install
npm run dev
```

Opens on `http://localhost:5173`. It talks to `mm_api.py` at `http://localhost:8800` — that's hardcoded
as `API_BASE` in `web/src/api.js`; change it there if you run `mm_api.py` on a different port or host.

No further config needed since the web app and `mm_api.py` are both on your own machine — `localhost`
reaches both.

---

## 4. Run the mobile app (Expo)

Your phone is a **separate device** on the wifi from your PC, so `localhost` in the mobile app would
point at the phone itself, not your PC. You must tell it your PC's actual LAN IP.

**Find your PC's LAN IP:**
- Mac/Linux: `ifconfig | grep "inet "` (look for something like `192.168.1.42`, not `127.0.0.1`)
- Windows: `ipconfig` → "IPv4 Address" under your active adapter

**Set it in the app** — edit `mobile/src/api.js`:
```js
export const API_BASE = "http://192.168.1.42:8800";   // ← replace with YOUR PC's LAN IP from above
```

**Install Expo Go** on your phone (App Store / Play Store) — this is what runs the app without a full
native build.

**Start the dev server:**
```bash
cd mobile
npm install
npx expo start
```
A QR code prints in the terminal. Scan it with your phone's camera (iOS) or the Expo Go app itself
(Android) — the app loads over wifi.

**Phone and PC must be on the same wifi network.** If your network isolates devices from each other
(some public/office wifi, or a router's "AP/client isolation" setting), this won't connect — use a
personal hotspot or home wifi instead, or run `npx expo start --tunnel` (slower, routes through Expo's
relay instead of direct LAN, but works around isolation).

### Permissions you'll be asked for on first use
- **Camera** — when you tap 📷 to photograph something for the tutor to explain. If you deny it once,
  you'll need to re-enable it from your phone's system Settings → Expo Go → Camera.
- No other permissions are requested — the 📎 file-attach button uses the document picker, which
  doesn't need a separate permission grant.

### What to actually test
- **Chat round-trip:** type something, confirm a reply streams in (status polling → final chat refresh).
- **Diagram request:** "draw a labelled diagram of the human heart" → confirm an image renders.
- **Process request:** "explain blood flow through the heart step by step" → confirm the step viewer
  appears with Previous/Next and the step dots working, not just the first step.
- **Camera:** tap 📷, take a photo of anything (a textbook page is a good test), send it, confirm the
  tutor responds about what's in the photo.
- **Offline reading:** after the above has loaded at least once, turn on Airplane Mode and relaunch the
  app (or background/foreground it) — you should see an "Offline · cached" badge and still be able to
  scroll the same conversation with its images and step diagrams, not blank space.
- **Heading formatting:** any longer explanation should show real section headings (e.g. "Short answer",
  "Explanation"), not literal `##` characters.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Web/mobile shows a network error on every request | `mm_api.py` isn't running, or `API_BASE`/`localhost:8800` is wrong |
| Mobile works on `npm run dev` web preview but not on the phone | `API_BASE` still says `localhost` — must be the PC's LAN IP for a phone |
| Mobile can't reach the PC at all, even with correct IP | Phone and PC aren't on the same wifi, or the wifi isolates clients — try `--tunnel` or a hotspot |
| `mm_api.py` requests hang at "running" forever | Check the Colab tab is still alive and the ngrok tunnel didn't drop — rerun cell 6 |
| Image generation OOMs during an edit | Expected/known limit — see `UMM_EDIT_MAX_SIDE` env var (default 640px) in `mm_engine.py`; lower it further if needed on a smaller GPU |
| Camera button does nothing / permission dialog never appears | Re-check `app.json` has the `NSCameraUsageDescription` (iOS) / `CAMERA` permission (Android) entries — present in this build already, but if you eject from Expo Go to a custom dev build, confirm they carried over |
