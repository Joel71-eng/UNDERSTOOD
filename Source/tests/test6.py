"""Bank builder v3: English-only screening, wider discovery (mocked Commons), PNG/JPG route, alternates."""
import io, json, os, re, sys, tempfile, subprocess
from pathlib import Path
from unittest import mock
import cairosvg
from PIL import Image
import run_tests as T
from run_tests import check
import bank_build as B

# --- English screening of file names
bad = ["File:Heart-fr.svg", "File:Diagram of the heart (de).svg", "File:Herz Anatomie.svg", "File:Cœur humain.svg", "File:Gehirn.png", "File:Brain_es.svg",
       "File:Heart ar.png", "File:Coeur humain.svg", "File:Heart diagram zh-cn.svg", "File:Eye_(pt-br).svg", "File:Human_heart-ja.svg"]
good = ["File:Diagram of the human heart (cropped).svg", "File:Heart diagram-en.svg", "File:Human eye anatomy.png", "File:Brain it is.svg", "File:Kidney_labelled.svg",
        "File:Anatomy of the ear-no.svg" if False else "File:Neuron.svg", "File:Plant cell structure.svg"]
check("[english] foreign file names rejected", not any(B.english_title(t) for t in bad), str([t for t in bad if B.english_title(t)]))
check("[english] English file names kept", all(B.english_title(t) for t in good), str([t for t in good if not B.english_title(t)]))
ok, why = B.english_labels(["Aorta", "Left atrium", "Pulmonary vein"])
check("[english] plain English labels pass", ok)
ok, why = B.english_labels(["Aorte", "Oreillette gauche", "Veine pulmonaire", "Ventricule droit é"])
check("[english] accented labels rejected", not ok, why)
ok, why = B.english_labels(["Aorta", "Atrium sinistrum", "Vena cava"] * 0 + [])
check("[english] empty label list rejected", not ok)

# --- discovery with a mocked Commons: SVG search, bitmap search, category crawl; foreign / licence / size filters
def pg(title, mime, lic, w=1200, h=1200):
    return {"title": title, "imageinfo": [{"url": "https://upload.wikimedia.org/x/" + title.split(":")[1], "mime": mime, "width": w, "height": h,
            "descriptionurl": "https://commons.wikimedia.org/wiki/" + title, "extmetadata": {"LicenseShortName": {"value": lic}, "Artist": {"value": "<b>Ann</b>"}}}]}
def fake_api(params):
    if params.get("list") == "search":
        return {"query": {"search": [{"title": "Category:Diagrams of the human heart"}, {"title": "Category:Heart surgery photos"}]}}
    if params.get("list") == "categorymembers":
        return {"query": {"categorymembers": [{"title": "Category:Heart diagram sources"}]}}
    if params.get("generator") == "categorymembers":
        return {"query": {"pages": [pg("File:Heart cat.svg", "image/svg+xml", "CC BY-SA 4.0"), pg("File:Coeur cat.svg", "image/svg+xml", "CC BY-SA 4.0")]}}
    kind = params["gsrsearch"].split("filetype:")[1]
    if kind == "drawing":
        return {"query": {"pages": [pg("File:Heart a.svg", "image/svg+xml", "CC BY 3.0"), pg("File:Heart-fr.svg", "image/svg+xml", "CC BY 3.0"),
                                    pg("File:Heart nc.svg", "image/svg+xml", "CC BY-NC 4.0")]}}
    return {"continue": None, "query": {"pages": [pg("File:Heart b.png", "image/png", "Public domain"), pg("File:Tiny.png", "image/png", "CC0", 200, 200),
                                                  pg("File:Heart photo.jpg", "image/jpeg", "All rights reserved")]}}
with mock.patch.object(B, "_api", side_effect=fake_api):
    cands = B.gather_candidates("human_heart", ["human heart", "heart"], "human heart labelled diagram")
titles = [c["title"] for c in cands]
check("[discovery] SVG, PNG and category files all found", {"File:Heart a.svg", "File:Heart b.png", "File:Heart cat.svg"} <= set(titles), str(titles))
check("[discovery] foreign name, NC licence, tiny and all-rights files dropped",
      not ({"File:Heart-fr.svg", "File:Coeur cat.svg", "File:Heart nc.svg", "File:Tiny.png", "File:Heart photo.jpg"} & set(titles)))
check("[discovery] only matching categories are crawled and SVGs come first", cands[0]["kind"] == "svg" and "File:Heart cat.svg" in titles)

# --- PNG route end to end through the CLI, then build_topic with mocked downloads (SVG preferred, alternates kept)
src = open("test3.py").read()
svg = re.search(r'svg = """(.*?)"""', src, re.S).group(1)
png = cairosvg.svg2png(bytestring=svg.encode(), output_width=1400, background_color="white")
out = Path(tempfile.mkdtemp()) / "bank"
pngf = out.parent / "heart.png"; pngf.write_bytes(png)
r = subprocess.run([sys.executable, "bank_build.py", "--out", str(out), "--png", str(pngf), "--id", "human_heart"], capture_output=True, text=True, cwd=T.HERE)
rec = json.loads((out / "human_heart.json").read_text()) if (out / "human_heart.json").exists() else {}
named = {p["name"] for p in rec.get("parts", []) if p["anchor"]}
check("[raster] PNG with OCR labels becomes a bank record", len(named) >= 5 and rec.get("kind") == "raster", f"{sorted(named)} {r.stderr[-200:]}")
check("[raster] flagged for careful review", any("RASTER" in f for f in rec.get("flags", [])))
im = Image.open(out / "human_heart.png"); import numpy as np
check("[raster] label words erased from the picture", (np.asarray(im.convert("L")) < 100).sum() < 0.02 * im.width * im.height)

def fake_get(url, **k):
    class R: status_code = 200
    R.content = svg.encode() if url.endswith(".svg") else png
    return R
out2 = Path(tempfile.mkdtemp()) / "bank"; out2.mkdir()
with mock.patch.object(B, "_api", side_effect=fake_api), mock.patch.object(B.requests, "get", side_effect=fake_get):
    rec = B.build_topic("human_heart", ["human heart", "heart"], "human heart labelled diagram", out2, svg_keep=2)
check("[builder] best SVG saved as <id> and an alternate as <id>__alt2", rec is not None and (out2 / "human_heart.json").exists() and (out2 / "human_heart__alt2.json").exists(),
      str(sorted(p.name for p in out2.glob("*.json"))))
check("[builder] SVG chosen over raster when it is good enough", json.loads((out2 / "human_heart.json").read_text()).get("kind") == "svg")

# --- first approved id wins when two are approved for one topic
import mm_bank
b2 = Path(tempfile.mkdtemp())
for i in ("a1", "a2"):
    (b2 / f"{i}.png").write_bytes(png); (b2 / f"{i}.json").write_text(json.dumps({"id": i, "title": "human heart", "aliases": ["heart"], "parts": []}))
(b2 / "approved.txt").write_text("a2\na1\n")
check("[bank] first approved id wins for a topic", mm_bank.Bank(b2).lookup("heart")["id"] == "a2")
T.summary() if hasattr(T, "summary") else None

# ---- v3.1: broken marker reference, cache, resume, crash isolation, source kept
bad_marker = svg.replace('<line x1="140" y1="140" x2="20" y2="120" stroke="black"/>', '<line x1="140" y1="140" x2="20" y2="120" stroke="black" marker-end="url(#nope)"/>')
from lxml import etree
root = etree.fromstring(bad_marker.encode())
import cairosvg
crashed = False
try:
    cairosvg.svg2png(bytestring=etree.tostring(root))
except Exception:
    crashed = True
png2 = B.render_svg(etree.fromstring(bad_marker.encode()))
check("[fix] SVG with a missing arrowhead marker renders instead of crashing", png2[:4] == b"\x89PNG", f"plain cairosvg crashed: {crashed}")

calls = []
def counting_get(url, **k):
    calls.append(url)
    class R: status_code = 200; headers = {}
    R.content = b"x" * 50
    return R
B._LAST[0] = 0
cache_dir = Path(tempfile.mkdtemp())
B.CACHE[0] = str(cache_dir)
with mock.patch.object(B.requests, "get", side_effect=counting_get), mock.patch.object(B, "_polite", lambda gap=0: None):
    a1 = B.download("https://upload.wikimedia.org/x/Heart.svg"); a2 = B.download("https://upload.wikimedia.org/x/Heart.svg")
check("[cache] a file is downloaded once and then read from disk", a1 == a2 and len(calls) == 1)

seq = iter([429, 429, 200])
def flaky(url, **k):
    class R: headers = {"Retry-After": "0"}; content = b"ok"
    R.status_code = next(seq); return R
with mock.patch.object(B.requests, "get", side_effect=flaky), mock.patch.object(B, "_polite", lambda gap=0: None), mock.patch.object(B.time, "sleep", lambda s: None):
    r = B._get("https://x")
check("[retry] 429 twice then success is retried and returned", r.status_code == 200)

# build_topic: first candidate fails to build -> the next is used; originals kept; resume skips built topics
out3 = Path(tempfile.mkdtemp()) / "bank"; out3.mkdir()
B.CACHE[0] = str(out3 / "_cache")
real_one = B.build_one
state = {"n": 0}
def flaky_build(*a, **k):
    state["n"] += 1
    if state["n"] == 1:
        raise AttributeError("boom")
    return real_one(*a, **k)
def fake_get2(url, **k):
    class R: status_code = 200; headers = {}
    R.content = svg.encode() if url.endswith(".svg") else png
    return R
with mock.patch.object(B, "_api", side_effect=fake_api), mock.patch.object(B.requests, "get", side_effect=fake_get2), mock.patch.object(B, "_polite", lambda gap=0: None), \
     mock.patch.object(B, "build_one", side_effect=flaky_build):
    rec = B.build_topic("human_heart", ["human heart", "heart"], "human heart labelled diagram", out3, svg_keep=1, raster_keep=0)
check("[robust] a candidate that crashes the renderer is skipped, the next one is built", rec is not None and (out3 / "human_heart.json").exists())
check("[source] the original SVG is kept next to the cleaned PNG", any((out3 / "source").glob("human_heart.*")))
r = subprocess.run([sys.executable, "bank_build.py", "--out", str(out3), "--topics", "human heart"], capture_output=True, text=True, cwd=T.HERE, timeout=20)
check("[resume] a finished topic is skipped on the next run", "already built" in r.stdout, r.stdout[-120:])
check("[resume] index.json written", (out3 / "index.json").exists())

# ---- v3.2: fetch on the PC, build offline on Colab
B.OFFLINE[0] = False
fetch_dir = Path(tempfile.mkdtemp()) / "fetch"
with mock.patch.object(B, "_api", side_effect=fake_api):
    pass
def fake_get3(url, **k):
    class R: status_code = 200; headers = {}
    if "api.php" in url:
        R.content = b""
        j = fake_api(k.get("params", {}))
        R.json = lambda self=None, j=j: j
        R.raise_for_status = lambda: None
    else:
        R.content = svg.encode() if url.endswith(".svg") else png
    return R
with mock.patch.object(B.requests, "get", side_effect=fake_get3), mock.patch.object(B, "_polite", lambda gap=0: None):
    r = subprocess.run([sys.executable, "-c", "pass"], capture_output=True)
    import runpy
    sys.argv = ["bank_fetch.py", "--out", str(fetch_dir), "--topics", "human_heart"]
    try:
        runpy.run_path("bank_fetch.py", run_name="__main__")
    except SystemExit:
        pass
cache_files = list((fetch_dir / "_cache").glob("*"))
check("[fetch] PC fetch fills the cache with API answers and files", any(f.name.startswith("api_") for f in cache_files) and any(f.suffix in (".svg", ".png") for f in cache_files), str(len(cache_files)))
# offline build: network patched to explode
out4 = Path(tempfile.mkdtemp()) / "bank"; out4.mkdir()
import shutil; shutil.copytree(fetch_dir / "_cache", out4 / "_cache")
def boom(*a, **k): raise AssertionError("network used in offline mode")
B.CACHE[0] = str(out4 / "_cache"); B.OFFLINE[0] = True
with mock.patch.object(B.requests, "get", side_effect=boom):
    rec = B.build_topic("human_heart", ["human heart", "heart"], "human heart labelled diagram", out4, svg_keep=1, raster_keep=0)
B.OFFLINE[0] = False
check("[offline] Colab build runs from the fetched cache with zero network calls", rec is not None and (out4 / "human_heart.json").exists())

# ---- v3.3: diagnostic reasons, independent SVG/raster pools (3+3 split)
import re as _re, io as _io
import cairosvg as _cairosvg
src2 = open("test3.py").read()
svg2 = _re.search(r'svg = """(.*?)"""', src2, _re.S).group(1)
png2 = _cairosvg.svg2png(bytestring=svg2.encode(), output_width=1400, background_color="white")

import bank_raster as R
ok, why = R.available()
check("[diag] available() reports a real reason when it works", ok and "tesseract" in why.lower(), why)

# simulate three SVG-like and three raster-like candidates, all strong, to check 3+3 split with distinct naming
def cand(i, kind):
    return {"title": f"File:Heart variant {i}.{'svg' if kind == 'svg' else 'png'}", "url": f"https://upload.wikimedia.org/x/h{i}.{'svg' if kind == 'svg' else 'png'}",
            "page_url": "", "author": "Ann", "license": "CC BY 4.0", "kind": kind}
svg_cands = [cand(i, "svg") for i in range(4)]      # 4 offered, only 3 should be kept
raster_cands = [cand(i, "raster") for i in range(4, 8)]
all_cands = svg_cands + raster_cands

def fake_gather(tid, aliases, query):
    return all_cands

def fake_dl(url):
    return svg2.encode() if url.endswith(".svg") else png2

out5 = Path(tempfile.mkdtemp()) / "bank"; out5.mkdir()
B.CACHE[0] = str(out5 / "_cache")
with mock.patch.object(B, "gather_candidates", side_effect=fake_gather), mock.patch.object(B, "download", side_effect=fake_dl):
    rec = B.build_topic("human_heart", ["human heart", "heart"], "human heart labelled diagram", out5, svg_keep=3, raster_keep=3)
made = sorted(f.stem for f in out5.glob("*.json") if f.name != "index.json")
check("[split] 3 SVGs and 3 rasters saved, not a mixed top-N", made == ["human_heart", "human_heart__alt2", "human_heart__alt3",
      "human_heart__raster1", "human_heart__raster2", "human_heart__raster3"], str(made))
kinds = {f.stem: json.loads(f.read_text())["kind"] for f in out5.glob("*.json") if f.name != "index.json"}
check("[split] svg-named ids are svg, raster-named ids are raster", all(kinds[k] == "svg" for k in made if "raster" not in k) and all(kinds[k] == "raster" for k in made if "raster" in k))
check("[split] returned record is the best SVG (svg beats raster when both exist)", rec["kind"] == "svg")

# fewer than target in one pool: no padding, no crash
out6 = Path(tempfile.mkdtemp()) / "bank"; out6.mkdir()
B.CACHE[0] = str(out6 / "_cache")
with mock.patch.object(B, "gather_candidates", side_effect=lambda *a: svg_cands[:1]), mock.patch.object(B, "download", side_effect=fake_dl):
    rec = B.build_topic("human_heart", ["human heart", "heart"], "human heart labelled diagram", out6, svg_keep=3, raster_keep=3)
made6 = sorted(f.stem for f in out6.glob("*.json") if f.name != "index.json")
check("[split] only 1 SVG offered -> only 1 saved, no error, no raster files", made6 == ["human_heart"], str(made6))

# svg_raster.py import failure is reported, not silently swallowed as the old generic hint
with mock.patch.dict("sys.modules", {"bank_raster": None}):
    import importlib
    out7 = Path(tempfile.mkdtemp()) / "bank"; out7.mkdir()
    B.CACHE[0] = str(out7 / "_cache")
    buf = __import__("io").StringIO()
    import contextlib
    with contextlib.redirect_stdout(buf), mock.patch.object(B, "gather_candidates", side_effect=lambda *a: svg_cands), mock.patch.object(B, "download", side_effect=fake_dl):
        B.build_topic("human_heart", ["human heart", "heart"], "human heart labelled diagram", out7, svg_keep=3, raster_keep=3)
    check("[diag] a missing bank_raster.py is reported by name, not a generic hint", "bank_raster.py import failed" in buf.getvalue(), buf.getvalue()[:200])
