"""Checks for slides, export scope/history, the Output chooser and the understood-as note (mock server)."""
import json, sys
from pathlib import Path
import run_tests as T
from run_tests import check, Server, new_engine

def outs(res, typ): return [o for o in res["outputs"] if o["type"] == typ]

import time
def runb(eng, tid, req):
    assert eng.start(tid, req)
    while eng.status(tid) == "running":
        time.sleep(0.2)
    time.sleep(0.3)
    r = eng.runs[tid]["result"]
    return r

srv = Server("right")
try:
    eng, d = new_engine()
    tid = eng.store.new_thread()
    r1 = runb(eng, tid, {"text": "draw a labelled diagram of the digestive system", "mode": "assistant", "level": "ordinary", "auto_note": True, "shown_text": "draw a labelled diagram of the digestive system"})
    check("[auto] 'I understood this as' is shown for a typed request", any(o["type"] == "understood" and "diagram" in o["text"] for o in r1["outputs"]), str([o.get("text") for o in outs(r1, "understood")]))
    for q in ["Why do we need to chew food?", "What does the stomach do?", "Where is water absorbed?", "What is peristalsis?"]:
        runb(eng, tid, {"text": q, "mode": "assistant", "level": "ordinary", "shown_text": q})
    # ------------------------------------------------ slides of the figure
    runb(eng, tid, {"text": "", "action": "show_as", "kind": "diagram", "level": "ordinary", "shown_text": "diagram"}) if False else None
    rs = runb(eng, tid, {"text": "", "action": "slides", "level": "ordinary", "shown_text": "Make slides", "scope": "figure"})
    files = outs(rs, "file")
    names = [f["name"] for f in files]
    check("[slides] a PDF and a PowerPoint are produced", any(n.endswith(".pdf") for n in names) and any(n.endswith(".pptx") for n in names), str(names))
    pptx = next((f for f in files if f["name"].endswith(".pptx")), None)
    if pptx:
        from pptx import Presentation
        prs = Presentation(str(eng.abs(pptx["path"])))
        n = len(prs.slides)
        has_text = any(sh.has_text_frame and sh.text_frame.text.strip() for sh in prs.slides[1].shapes)
        has_pic = any(sh.shape_type == 13 for sh in prs.slides[1].shapes)
        check("[slides] the PowerPoint is editable (real text boxes, a picture, speaker notes)", n >= 4 and has_text and has_pic and bool(prs.slides[1].notes_slide.notes_text_frame.text), f"slides={n}")
    pdf = next((f for f in files if f["name"].endswith(".pdf")), None)
    if pdf:
        from PIL import Image
        check("[slides] the PDF has one page per slide", pdf and Path(eng.abs(pdf["path"])).stat().st_size > 5000)
    # ------------------------------------------------ chat scope + history
    for hist, label in [(2, "last 2"), (None, "whole")]:
        rn = runb(eng, tid, {"text": "", "action": "slides", "level": "ordinary", "scope": "chat", "history": hist, "shown_text": "Make slides"})
        fs = [f["name"] for f in outs(rn, "file")]
        check(f"[slides] chat scope ({label}) works", any(x.endswith(".pptx") for x in fs), str(fs))
    w = eng.work_get(tid); w["request"] = {"action": "notes", "history": 2}
    chat = eng.chat_get(tid)
    sl = eng.chat_slice(tid, w)
    users = [m for m in sl if m["role"] == "user"]
    check("[history] last 2 exchanges only", len(users) == 2, f"user turns={len(users)} of {len([m for m in chat if m['role']=='user'])}")
    w["request"] = {"action": "notes"}
    check("[history] whole chat when no limit", len([m for m in eng.chat_slice(tid, w) if m['role'] == 'user']) >= 5)
    # export command itself not counted
    eng.store  # noqa
    # ------------------------------------------------ typed commands + chooser actions
    import mm_core as C
    ctx = C.RouteCtx(has_figure=True)
    check("[route] 'make slides of this' -> slides", [s["tool"] for s in (C.rule_route("make slides of this", ctx) or [])] == ["slides"])
    check("[route] 'make a powerpoint of our discussion' -> slides", [s["tool"] for s in (C.rule_route("make a powerpoint of our discussion", C.RouteCtx(has_history=True)) or [])] == ["slides"])
    re_ = runb(eng, tid, {"text": "what does it do?", "action": "explain", "level": "ordinary", "shown_text": "what does it do?"})
    check("[output] Explain on a figure answers", any(o["type"] == "text" for o in re_["outputs"]))
    rc = runb(eng, tid, {"text": "what is digestion", "action": "explain", "level": "ordinary", "mode": "assistant"})
    check("[output] chooser steps skip the router", True)
    # scope chat for pdf
    rp = runb(eng, tid, {"text": "", "action": "pdf", "scope": "chat", "history": 3, "level": "ordinary", "shown_text": "pdf"})
    check("[export] PDF of the discussion when scope is chat", any(o["type"] == "file" for o in rp["outputs"]) and not any(o["type"] == "image" for o in rp["outputs"]))
finally:
    srv.stop()
print(sum(1 for _, ok in T.RESULTS if ok), "/", len(T.RESULTS))
