"""Stop button: cancel during a tutor call and during a picture job; everything is put back as it was."""
import os, tempfile, time, json
from pathlib import Path
from unittest import mock
import requests
import run_tests as T
from run_tests import check, Server

os.environ["UNDERSTOOD_BANK_DIR"] = str(Path(tempfile.mkdtemp()) / "nobank")
os.environ["UNDERSTOOD_MOCK_STEP"] = "0.4"
srv = Server("right")

def wait(eng, tid, secs=120):
    t0 = time.time()
    while eng.status(tid) == "running" and time.time() - t0 < secs:
        time.sleep(0.2)
    return eng.status(tid)

try:
    h = requests.get(T.URL + "/health").json()
    check("[stop] server reports build and cancel feature", "cancel" in h.get("features", []) and h.get("build"), str(h.get("build")))
    eng, d = T.new_engine()
    tid = eng.store.new_thread()
    eng.start(tid, {"text": "what is osmosis", "shown_text": "what is osmosis", "mode": "assistant", "level": "advanced"})
    check("[stop] baseline question answered", wait(eng, tid) == "done")
    chat0 = eng.chat_get(tid); st0 = eng.state(tid)

    # --- cancel during a picture job
    eng.start(tid, {"text": "draw a labelled diagram of the digestive system", "shown_text": "draw digestive", "mode": "assistant", "level": "advanced"})
    t0 = time.time(); job = None
    while time.time() - t0 < 60 and not job:
        job = (eng.work_get(tid).get("phase") or {}).get("job"); time.sleep(0.2)
    check("[stop] a picture job is running", bool(job))
    check("[stop] cancel() accepted while running", eng.cancel(tid) is True)
    st = wait(eng, tid, 30)
    check("[stop] run ends as cancelled", st == "cancelled", st)
    check("[stop] chat is exactly as before (question and answer both gone)", eng.chat_get(tid) == chat0, f"{len(eng.chat_get(tid))} vs {len(chat0)}")
    s1 = eng.state(tid)
    check("[stop] conversation state restored", s1.get("figure") == st0.get("figure") and s1.get("last_topic", "") == st0.get("last_topic", ""))
    check("[stop] nothing left to resume", not eng.parked(tid))
    time.sleep(1.0)
    js = requests.get(f"{T.URL}/jobs/{job}").json()
    check("[stop] the server job was cancelled (GPU freed)", js["status"] == "cancelled", js["status"])
    check("[stop] work file reset", eng.work_get(tid).get("steps") == [])

    # --- can run again afterwards
    os.environ["UNDERSTOOD_MOCK_STEP"] = "0.4"
    eng.start(tid, {"text": "what is diffusion", "shown_text": "what is diffusion", "mode": "assistant", "level": "advanced"})
    check("[stop] a new request works after a stop", wait(eng, tid) == "done" and len(eng.chat_get(tid)) == len(chat0) + 2)

    # --- cancel during a tutor call: the late answer is thrown away
    chat1 = eng.chat_get(tid)
    real = eng.client.tutor
    def slow(*a, **k):
        time.sleep(2.0); return real(*a, **k)
    with mock.patch.object(eng.client, "tutor", side_effect=slow):
        eng.start(tid, {"text": "explain photosynthesis", "shown_text": "explain photosynthesis", "mode": "assistant", "level": "advanced"})
        time.sleep(0.8); eng.cancel(tid)
        st = wait(eng, tid, 30)
    check("[stop] cancel during a tutor call ends as cancelled", st == "cancelled", st)
    check("[stop] chat restored after tutor-call stop", eng.chat_get(tid) == chat1)
    check("[stop] cancel with nothing running returns False", eng.cancel(tid) is False)
finally:
    srv.stop()
T.summary() if hasattr(T, "summary") else None
