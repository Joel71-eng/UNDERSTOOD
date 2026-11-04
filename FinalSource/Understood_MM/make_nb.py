import json, ast, re
nb = json.load(open('/mnt/user-data/uploads/Understood_MM_Server.ipynb'))
srv = open('/home/claude/build/mm_server.py').read()
def src(s): return s.splitlines(keepends=True)
def code(s):
    return {"cell_type":"code","metadata":{},"execution_count":None,"outputs":[],"source":src(s)}
def md(s): return {"cell_type":"markdown","metadata":{},"source":src(s)}
cells = nb['cells']
cells[0] = md("""# Understood - learning service (Colab)
Run the cells **top to bottom, once per session**. Runtime must be **GPU**. Cell 1 restarts the runtime the first time - that is expected; just run cell 1 again.

**One-time setup for the permanent address (ngrok):** in Colab press the key icon (Secrets), add a secret named `ngrok_token` with your ngrok authtoken, and switch *Notebook access* on. The address never changes: `https://outdoors-graph-tremor.ngrok-free.dev` - paste it into the app once.
""")
cells[3] = code("%%writefile mm_server.py\n" + srv)
cells[4] = code('''# 4. Start the service (its log goes to server.log - see cell 8)
import subprocess, time, requests, os, signal
PORT = 8000
if globals().get("server_proc") and server_proc.poll() is None:
    server_proc.terminate(); server_proc.wait(10)
env = {**os.environ, "PORT": str(PORT), "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True", "UMM_MODELS": "/content/models_local", "PYTHONUNBUFFERED": "1"}
server_proc = subprocess.Popen(["python", "mm_server.py"], env=env, stdout=open("server.log", "w"), stderr=subprocess.STDOUT)
for _ in range(90):
    try:
        print(requests.get(f"http://localhost:{PORT}/health", timeout=3).json()); break
    except Exception:
        if server_proc.poll() is not None: break
        time.sleep(1)
else:
    print("Server is still starting - look at cell 8.")
if server_proc.poll() is not None:
    print("The server stopped. Last lines of its log:\\n"); print("".join(open("server.log").readlines()[-30:]))
''')
cells[6] = code('''# 6. Permanent public address (ngrok static domain)
import os, re, time, subprocess, sys, requests
DOMAIN = "outdoors-graph-tremor.ngrok-free.dev"          # your static domain from the ngrok dashboard
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-U", "pyngrok"], capture_output=True)
from pyngrok import conf, installer
try:
    from google.colab import userdata
    TOKEN = userdata.get("ngrok_token")
except Exception:
    TOKEN = os.environ.get("NGROK_TOKEN")
assert TOKEN, "Add a Colab secret called ngrok_token (key icon on the left) and switch Notebook access on, then run this cell again."
NGROK = conf.get_default().ngrok_path
if not os.path.exists(NGROK):
    installer.install_ngrok(NGROK)
subprocess.run(["pkill", "-f", "ngrok"], capture_output=True); time.sleep(1)
subprocess.run([NGROK, "config", "add-authtoken", TOKEN], capture_output=True)
URL = f"https://{DOMAIN}"
open("ngrok.log", "w").close()
for flag in ("--url", "--domain"):                        # newer agents use --url, older ones --domain
    tunnel_proc = subprocess.Popen([NGROK, "http", str(PORT), f"{flag}={URL if flag == '--url' else DOMAIN}", "--log=stdout"],
                                   stdout=open("ngrok.log", "w"), stderr=subprocess.STDOUT)
    started = False
    for _ in range(25):
        log = open("ngrok.log").read()
        if "started tunnel" in log: started = True; break
        if tunnel_proc.poll() is not None: break           # this flag was refused - try the other one
        time.sleep(1)
    if started: break
if not started:
    print("The tunnel did not start. ngrok said:\\n"); print(open("ngrok.log").read()[-1500:])
else:
    ok = False
    for _ in range(20):
        try:
            h = requests.get(URL + "/health", headers={"ngrok-skip-browser-warning": "1"}, timeout=5).json(); ok = True; break
        except Exception:
            time.sleep(1)
    print("=" * 70); print("PASTE THIS ADDRESS INTO THE APP (it never changes):\\n\\n   ", URL, "\\n")
    print("Server answers through the tunnel:", ok and h.get("status"), "| features:", h.get("features") if ok else None); print("=" * 70)
''')
cells.insert(8, code('''# 8. Logs - run any time something looks wrong
print("---- server.log (last 60 lines) ----"); print("".join(open("server.log").readlines()[-60:]))
print("---- ngrok.log (last 15 lines) ----"); print("".join(open("ngrok.log").readlines()[-15:]))
'''))
nb['cells'] = cells
# validate
for i, c in enumerate(nb['cells']):
    if c['cell_type'] == 'code':
        s = ''.join(c['source'])
        s = re.sub(r'^%%writefile.*\n', '', s)
        ast.parse(s)
assert ''.join(nb['cells'][3]['source']) == "%%writefile mm_server.py\n" + srv
json.dump(nb, open('/home/claude/build/Understood_MM_Server.ipynb', 'w'), indent=1)
print("notebook ok,", len(nb['cells']), "cells")
