import os, sys, subprocess, tempfile, time, requests
from pathlib import Path
sys.path.insert(0,'.')
import mm_engine as E
env={**os.environ,"UNDERSTOOD_MOCK":"1","PORT":"8768","PYTHONPATH":"."}
p=subprocess.Popen([sys.executable,"mm_server.py"],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
for _ in range(60):
    try: requests.get("http://localhost:8768/health",timeout=1); break
    except Exception: time.sleep(.3)
try:
    eng=E.Engine(Path(tempfile.mkdtemp()),"http://localhost:8768"); eng.online_sources=False
    t=eng.store.new_thread()
    for q in ["draw the structure of ethanol","balance the combustion of methane","explain this reaction","why does it need oxygen?","draw a labelled diagram of simple distillation","step by step the haber process"]:
        r=eng.run(t,{"text":q,"mode":"assistant","level":"advanced"})
        print(f"{q!r:55} {r['status']:7}", [o['type'] for o in r['outputs']], (eng.state(t).get('figure') or {}).get('kind'))
finally: p.terminate()
