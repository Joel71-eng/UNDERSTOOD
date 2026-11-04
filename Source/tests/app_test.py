import os, sys, subprocess, tempfile, time, requests
from pathlib import Path
data = tempfile.mkdtemp()
os.environ.update(UNDERSTOOD_DATA=data, UNDERSTOOD_SERVER="http://localhost:8767")
env = {**os.environ, "UNDERSTOOD_MOCK": "1", "PORT": "8767", "PYTHONPATH": "."}
p = subprocess.Popen([sys.executable, "mm_server.py"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(60):
    try: requests.get("http://localhost:8767/health", timeout=1); break
    except Exception: time.sleep(.3)
ok = True
try:
    from streamlit.testing.v1 import AppTest
    at = AppTest.from_file("mm_app.py", default_timeout=90).run()
    print("exceptions on first load:", [e.value for e in at.exception])
    print("sidebar buttons:", [b.label for b in at.sidebar.button][:6], "| main buttons:", [b.label for b in at.button][:5])
    assert not at.exception
    # click a suggestion
    sug = [b for b in at.button if b.label.startswith("Show step by step")][0]
    sug.click().run()
    print("exceptions after click:", [e.value for e in at.exception])
    import mm_engine as E
    tid = at.session_state["tid"]
    # wait for the background run through a second engine view of the same data
    eng = E.Engine(Path(data), "http://localhost:8767")
    for _ in range(150):
        c_ = eng.chat_get(tid)
        if c_ and c_[-1]["role"] == "assistant" and c_[-1].get("status") in ("done", "failed", "parked"): break
        time.sleep(1)
    at.run()
    print("exceptions after finish:", [e.value for e in at.exception])
    print("chat messages:", len(eng.chat_get(tid)), "| expanders:", [x.label for x in at.expander][:6])
    print("tabs in sidebar tools:", [t.label for t in at.sidebar.tabs])
    last = eng.chat_get(tid)[-1]
    print("output types:", [o["type"] for o in last["outputs"]])
    assert not at.exception and last["outputs"]
    labels = [b.label for b in at.button]
    print("export bar:", [l for l in labels if l[:1] in "📄🖥🔊📝"])
    assert any("Slides" in l for l in labels) and any("PDF" in l for l in labels) and any("Notes" in l for l in labels) and any("Video" in l for l in labels)
    rd = [r for r in at.radio if r.label == "How much detail"]
    print("detail radio:", [(r.options, r.value) for r in rd])
    assert rd and rd[0].value == "Standard" and rd[0].options == ["Brief", "Standard", "Deep"]
    print("selectboxes:", [(s.label, s.value) for s in at.selectbox])
    assert any(s.label == "Output" for s in at.selectbox) and not any(s.label == "Level" for s in at.selectbox)
    print("number input:", [(n.label[:30], n.value) for n in at.number_input])
    # slides from the bar
    [b for b in at.button if "Slides" in b.label][0].click().run()
    for _ in range(120):
        c_ = eng.chat_get(tid)
        if c_ and c_[-1]["role"] == "assistant" and c_[-1].get("status") in ("done", "failed", "parked"): break
        time.sleep(1)
    at.run()
    names = [o.get("name") for o in eng.chat_get(tid)[-1]["outputs"] if o["type"] == "file"]
    print("slides files:", names); assert any(n.endswith(".pptx") for n in names) and not at.exception
    # Output chooser: Diagram
    [s for s in at.selectbox if s.label == "Output"][0].select("Diagram").run()
    at.chat_input[0].set_value("the human heart").run()
    for _ in range(150):
        c_ = eng.chat_get(tid)
        if c_ and c_[-1]["role"] == "assistant" and c_[-1].get("status") in ("done", "failed", "parked"): break
        time.sleep(1)
    at.run()
    lastm = eng.chat_get(tid)[-1]
    print("chooser Diagram ->", [o["type"] for o in lastm["outputs"]], "| exceptions:", [e.value for e in at.exception])
    assert any(o["type"] == "image" for o in lastm["outputs"]) and not any(o["type"] == "understood" for o in lastm["outputs"])
    print("APP OK")
finally:
    p.terminate()
