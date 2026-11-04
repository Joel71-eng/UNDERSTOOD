import os, sys, json, subprocess, time, tempfile, requests
from pathlib import Path
sys.path.insert(0,'.')
import mm_engine as E
env={**os.environ,"UNDERSTOOD_MOCK":"1","PORT":"8766","PYTHONPATH":"."}
p=subprocess.Popen([sys.executable,"mm_server.py"],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
for _ in range(60):
    try: requests.get("http://localhost:8766/health",timeout=1); break
    except Exception: time.sleep(.3)
try:
    d=Path(tempfile.mkdtemp()); eng=E.Engine(d,"http://localhost:8766"); eng.online_sources=False
    for q in ["step by step how the brain handles a stimulus","show how blood flows through the heart","explain digestion step by step"]:
        t=eng.store.new_thread()
        r=eng.run(t,{"text":q,"mode":"assistant","level":"ordinary"})
        fig=eng.state(t).get("figure")
        print(q,"->",r["status"],[o["type"] for o in r["outputs"]])
        if fig and fig.get("system"):
            for s in fig["steps"]: print("  ",s["n"],s["title"],s["parts"],[(f["from"],f["to"],f["what"]) for f in s["flows"]])
            print("   base visible:",[p["name"] for p in fig["system"]["parts"] if p["visible"]])
            print("   ", fig["steps"][0]["image_path"], fig["overview_path"])
            out=Path("/tmp/claude-0/-home-claude/ef05fefe-fd32-52b8-b748-3f3a42ff7a2d/scratchpad")/f"step_{q.split()[-1]}.png"
            from PIL import Image; Image.open(d/fig["steps"][1]["image_path"]).save(out); print("   saved",out)
        else: print("   (panel/other) notes:",[o.get("text") for o in r["outputs"] if o["type"]=="note"])
finally:
    p.terminate()
