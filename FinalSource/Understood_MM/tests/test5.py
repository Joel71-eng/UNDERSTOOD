"""Depth: notes follow the chat's own answers; slides and video say the same; narration is longer and cached."""
import os, tempfile, time, json, zipfile
from pathlib import Path
import run_tests as T
from run_tests import check, Server
import mm_doc

os.environ["UNDERSTOOD_BANK_DIR"] = str(Path(tempfile.mkdtemp()) / "nobank")
srv = Server("right")

def wait(eng, tid, secs=180):
    t0 = time.time()
    while eng.status(tid) == "running" and time.time() - t0 < secs:
        time.sleep(0.2)
    return eng.status(tid)

try:
    eng, d = T.new_engine()
    tid = eng.store.new_thread()
    for q in ("what is osmosis", "why do we sweat when it is hot", "explain how enzymes work"):
        eng.start(tid, {"text": q, "shown_text": q, "mode": "assistant", "level": "advanced"}); wait(eng, tid)
    chat = eng.chat_get(tid)
    check("[depth] three exchanges in the chat", len(chat) == 6)
    sizes = {}
    for dep in ("brief", "standard", "deep"):
        eng.start(tid, {"action": "notes", "text": "", "shown_text": "notes", "scope": "chat", "history": None, "depth": dep})
        check(f"[depth] notes {dep} done", wait(eng, tid) == "done")
        o = [x for x in eng.chat_get(tid)[-1]["outputs"] if x["type"] == "doc"]
        rec = json.loads(eng.abs(o[0]["path"]).read_text(encoding="utf-8"))
        md = mm_doc.blocks_to_markdown(rec["blocks"])
        sizes[dep] = len(md.split())
        if dep == "deep":
            check("[depth] deep notes carry the answer's own sections and one heading per question",
                  "### " in md and sum(1 for b in rec["blocks"] if b["t"] == "h2" and "osmosis" in b["text"].lower()) == 1, md[:200].replace("\n", " "))
            check("[depth] key points section present", "Key points to remember" in md)
        eng.chat_put(tid, eng.chat_get(tid)[:6])      # drop the export reply so the next export sees the same discussion
    check("[depth] brief < standard <= deep (words)", sizes["brief"] < sizes["standard"] <= sizes["deep"], str(sizes))

    # slides from the discussion at two depths
    n_slides = {}
    for dep in ("brief", "deep"):
        eng.start(tid, {"action": "slides", "text": "", "shown_text": "slides", "scope": "chat", "history": None, "depth": dep}); wait(eng, tid)
        files = [x for x in eng.chat_get(tid)[-1]["outputs"] if x["type"] == "file" and x["path"].endswith(".pptx")]
        from pptx import Presentation
        prs = Presentation(str(eng.abs(files[0]["path"])))
        n_slides[dep] = len(prs.slides)
        notes_words = sum(len(s.notes_slide.notes_text_frame.text.split()) for s in prs.slides if s.has_notes_slide)
        n_slides[dep + "_notes"] = notes_words
        eng.chat_put(tid, eng.chat_get(tid)[:6])
    check("[depth] deep deck is longer than brief", n_slides["deep"] >= n_slides["brief"] and n_slides["deep_notes"] > n_slides["brief_notes"], str(n_slides))

    # diagram: narration deeper, intro and recap spoken, cached
    t2 = eng.store.new_thread()
    eng.start(t2, {"text": "draw a labelled diagram of the digestive system", "shown_text": "d", "mode": "assistant", "level": "advanced"}); wait(eng, t2)
    fig = eng.state(t2)["figure"]
    w = {"request": {"depth": "deep"}}
    import copy
    f1 = copy.deepcopy(fig)
    eng.deepen_narration(t2, f1, "deep")
    npart = [p for p in f1["parts"] if p.get("visible") and p.get("narration")]
    check("[video] parts get their own longer narration", len(npart) >= 3 and all(len(p["narration"].split()) > len(p["text"].split()) for p in npart), f"{len(npart)} parts")
    check("[video] intro and recap written", bool(f1.get("lesson_intro")) and bool(f1.get("lesson_outro")))
    import mm_media
    sc = mm_media.scenes_for_figure(f1, eng.data_dir)
    check("[video] scenes speak the narration", sc[0]["text"] == f1["lesson_intro"] and sc[-1]["text"] == f1["lesson_outro"] and any(len(s["text"].split()) > 12 for s in sc[1:-1]))
    cached = list(eng.tdir(t2).glob("narration_deep_*.json"))
    check("[video] narration cached on disk", len(cached) == 1)
    calls = []
    real = eng.client.tutor
    eng.client.tutor = lambda *a, **k: (calls.append(1), real(*a, **k))[1]
    eng.deepen_narration(t2, copy.deepcopy(fig), "deep")
    check("[video] second export makes no tutor calls", not calls)
    # long caption scrolls
    from PIL import Image
    fr = mm_media.compose_frame(Image.new("RGB", (400, 300), "white"), "t", " ".join(f"word{i}" for i in range(120)), 100, (200, 50, 50))
    check("[video] long narration caption renders", fr.size == (mm_media.FW, mm_media.FH))
finally:
    srv.stop()
