"""Bank: served without the generator, labels placed from the source anchors, miss logged, process reuses the picture."""
import json, os, subprocess, sys, tempfile, time
from pathlib import Path
from unittest import mock
import numpy as np
from PIL import Image
import run_tests as T
from run_tests import check, Server

svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
<ellipse cx="200" cy="210" rx="130" ry="150" fill="#f6a5a5" stroke="black" stroke-width="2"/>
<circle cx="140" cy="140" r="34" fill="#9cc7f4" stroke="black"/><circle cx="260" cy="140" r="34" fill="#f4d39c" stroke="black"/>
<circle cx="140" cy="260" r="40" fill="#a7e3a7" stroke="black"/><circle cx="260" cy="260" r="40" fill="#d6a7e3" stroke="black"/>
<rect x="185" y="30" width="30" height="50" fill="#e66" stroke="black"/><rect x="100" y="30" width="30" height="60" fill="#66e" stroke="black"/>
<line x1="140" y1="140" x2="20" y2="120" stroke="black"/><text x="2" y="115" font-size="13">Right atrium</text>
<line x1="260" y1="140" x2="380" y2="120" stroke="black"/><text x="300" y="112" font-size="13">Left atrium</text>
<line x1="140" y1="260" x2="20" y2="340" stroke="black"/><text x="2" y="355" font-size="13">Right ventricle</text>
<line x1="260" y1="260" x2="380" y2="340" stroke="black"/><text x="300" y="357" font-size="13">Left ventricle</text>
<line x1="200" y1="50" x2="300" y2="30" stroke="black"/><text x="302" y="28" font-size="13">Aorta</text>
<line x1="115" y1="50" x2="40" y2="30" stroke="black"/><text x="2" y="26" font-size="13">Vena cava</text>
</svg>"""
bank = Path(tempfile.mkdtemp()) / "bank"
sv = bank.parent / "heart.svg"; sv.write_text(svg)
subprocess.run([sys.executable, "bank_build.py", "--out", str(bank), "--svg", str(sv), "--id", "human_heart"], check=True, cwd=T.HERE)
(bank / "approved.txt").write_text("human_heart\n")
os.environ["UNDERSTOOD_BANK_DIR"] = str(bank)

srv = Server("right")
try:
    eng, d = T.new_engine()
    tid = eng.store.new_thread()
    with mock.patch.object(eng.client, "submit_image", side_effect=AssertionError("generator must not be called")):
        res = eng.run(tid, {"text": "draw a labelled diagram of the human heart", "mode": "assistant", "level": "advanced"})
    fig = eng.state(tid).get("figure")
    vis = [p for p in fig["parts"] if p["visible"]]
    check("[bank] diagram served from the bank, generator never called", fig is not None and len(vis) >= 4, f"visible={[p['name'] for p in vis]}")
    lm = np.array(Image.open(eng.abs(fig["labelmap_path"])))
    ok = all(lm[int(p["anchor"][1]), int(p["anchor"][0])] == p["region_id"] for p in vis)
    check("[bank] every label anchor lies inside its own region", ok)
    check("[bank] credit line shown with licence", "Wikimedia Commons" in fig["source_note"] and "labels redrawn" in fig["source_note"], fig["source_note"][-110:])
    check("[bank] all labels marked as from the source drawing", all(p["confidence"] == 1.0 for p in vis))
    check("[bank] one distinct region per part", len({p["region_id"] for p in vis}) == len(vis))
    labelled = [o for o in res["outputs"] if o["type"] == "image"]
    check("[bank] a labelled picture is delivered", bool(labelled))
    sq = Image.open(eng.abs(fig["clean_path"]))
    arr = np.asarray(Image.open(eng.abs(fig["clean_path"])).convert("RGB")).astype(int)
    src_arr = np.asarray(Image.open(bank / "human_heart.png").convert("RGB")).astype(int)
    fills = lambda a: a[(a.max(-1) > 120) & (a.min(-1) < 235)].mean()
    check("[bank] colours are lighter than the source, outlines kept", fills(arr) > fills(src_arr) + 15 and (arr.max(-1) < 110).sum() > 200, f"fill mean {fills(src_arr):.0f} -> {fills(arr):.0f}")
    check("[bank] picture is standardised (square)", sq.size[0] == sq.size[1], str(sq.size))

    # process on the bank picture: still no generator
    tid2 = eng.store.new_thread()
    with mock.patch.object(eng.client, "submit_image", side_effect=AssertionError("generator must not be called for steps")):
        rp = eng.run(tid2, {"text": "show how blood flows through the heart", "mode": "assistant", "level": "advanced"})
    pr = [o for o in rp["outputs"] if o["type"] == "process"]
    rec = json.loads(eng.abs(pr[0]["path"]).read_text()) if pr else {}
    ready = [s for s in rec.get("steps", []) if s["status"] == "ready"]
    check("[bank] process steps drawn from the bank picture with zero generator calls", len(ready) >= 3, f"ready={len(ready)}")

    # a miss is logged and the generator is used
    tid3 = eng.store.new_thread()
    res3 = eng.run(tid3, {"text": "draw a labelled diagram of the digestive system", "mode": "assistant", "level": "ordinary"})
    ml = d / "miss_log.jsonl"
    check("[bank] a topic not in the bank is logged as a miss", ml.exists() and "digestive system" in ml.read_text(), ml.read_text()[:80] if ml.exists() else "")
    check("[bank] ... and still drawn by the generator", eng.state(tid3).get("figure") is not None)
    # the typed subject beats the previous topic (the neuron -> heart bug)
    tid4 = eng.store.new_thread()
    eng.run(tid4, {"text": "draw a labelled diagram of the human heart", "mode": "assistant", "level": "ordinary"})
    r4 = eng.run(tid4, {"text": "digestive system", "action": "show_as", "kind": "diagram", "mode": "assistant", "level": "ordinary"})
    f4 = eng.state(tid4).get("figure") or {}
    check("[topic] 'Diagram' of a NEW subject draws that subject, not the previous topic", "digest" in (f4.get("title") or "").lower(), f4.get("title"))
    logs = [t for _, t in eng.store.activity(tid, 60)]
    check("[log] activity says whether the bank was used", any(l.startswith("Bank: using") for l in logs), str([l for l in logs if l.startswith("Bank")][:2]))
    check("[log] activity says when it drew instead", any(l.startswith("Bank: nothing for") for l in [t for _, t in eng.store.activity(tid3, 60)]))
    check("[log] bank status reports the build and approved topics", eng.bank_status()["build"] and "human_heart" in eng.bank_status()["approved_topics"])
    # unapproved = not served
    (bank / "approved.txt").write_text("")
    eng.bank._mtime = None
    check("[bank] an unapproved topic is not served", eng.bank.lookup("human heart") is None)
    from mm_bank import topic_key
    check("[bank] 'heart attack' is not the heart", topic_key("heart attack") != topic_key("human heart") and topic_key("a labelled diagram of the human heart") == "heart")
finally:
    srv.stop()
print(sum(1 for _, ok in T.RESULTS if ok), "/", len(T.RESULTS))
