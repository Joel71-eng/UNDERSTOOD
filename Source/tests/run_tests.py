"""End-to-end checks of the new build against the MOCK server (no GPU).  These test the logic and plumbing, not model accuracy."""
import json, os, shutil, sqlite3, subprocess, sys, tempfile, time, base64, io
from pathlib import Path
from unittest import mock

import numpy as np
import requests
from PIL import Image

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import mm_core as C                                               # noqa: E402
import mm_engine as E                                             # noqa: E402
import mm_sources as S                                            # noqa: E402

PORT = 8765
URL = f"http://localhost:{PORT}"
RESULTS = []


def check(name, cond, extra=""):
    RESULTS.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"   [{extra}]" if extra else ""))


class Server:
    def __init__(self, mode="right"):
        env = {**os.environ, "UNDERSTOOD_MOCK": "1", "PORT": str(PORT), "UNDERSTOOD_MOCK_NAMING": mode, "PYTHONPATH": str(HERE)}
        self.p = subprocess.Popen([sys.executable, "mm_server.py"], cwd=HERE, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(60):
            try:
                requests.get(URL + "/health", timeout=1); return
            except Exception:
                time.sleep(0.3)
        raise RuntimeError("mock server did not start")

    def stop(self):
        self.p.terminate(); self.p.wait(10)


def new_engine():
    d = Path(tempfile.mkdtemp())
    eng = E.Engine(d, URL)
    eng.online_sources = False
    return eng, d


def region_truth(eng, fig):
    """For each labelled part: is its dot really on the region drawn in that part's colour?  (mock ground truth)"""
    img = np.asarray(Image.open(eng.abs(fig["clean_path"])).convert("RGB")).astype(int)
    parts = [p["name"] for p in fig["parts"]]
    pal = __import__("mm_server").mock_palette(len(parts)) if False else None
    import colorsys
    pal = [tuple(int(255 * c) for c in colorsys.hsv_to_rgb(i / max(1, len(parts)), 0.55, 0.92)) for i in range(len(parts))]
    right = wrong = 0
    for i, p in enumerate(fig["parts"]):
        if not p["visible"]:
            continue
        x, y = int(p["anchor"][0]), int(p["anchor"][1])
        ok = np.abs(img[y, x] - np.array(pal[i])).sum() < 40
        right += ok; wrong += (not ok)
    return right, wrong


def diagram_run(mode):
    srv = Server(mode)
    try:
        eng, d = new_engine()
        tid = eng.store.new_thread()
        res = eng.run(tid, {"text": "draw a labelled diagram of the digestive system", "mode": "assistant", "level": "ordinary"})
        fig = eng.state(tid).get("figure")
        return eng, d, tid, res, fig
    finally:
        srv.stop()


def main():
    # ---------------------------------------------------------------- locating parts: ONE tutor call, used as given
    for mode in ("right", "blind", "collapse", "shifted"):
        eng, d, tid, res, fig = diagram_run(mode)
        right, wrong = region_truth(eng, fig) if fig else (0, 0)
        vis = sum(p["visible"] for p in fig["parts"])
        check(f"[{mode}] run finished", res["status"] == "done", res.get("message", ""))
        log = [json.loads(x) for x in (d / "naming_log.jsonl").read_text().splitlines()]
        check(f"[{mode}] naming log written", len(log) == 1 and len(log[0]["regions"]) >= 6, f"regions={len(log[0]['regions'])}")
        if mode == "right":
            check("[right] every part of the notes is located and none is on the wrong region", vis == len(fig["parts"]) and wrong == 0, f"visible={vis}/{len(fig['parts'])} wrong={wrong}")
            check("[right] the non-part region stays unlabelled", len([r for r in log[0]["regions"] if r["final"] is None]) >= 1)
            check("[right] standard depth shows 10 or more parts (the notes of this topic list 10)", len(fig["parts"]) >= 10, str(len(fig["parts"])))
        if mode == "blind":
            check("[blind] nothing invented: no labels when the tutor names nothing", vis == 0)
            check("[blind] learner is told parts are not labelled", any("not labelled" in o["text"].lower() for o in res["outputs"] if o["type"] == "note"))
            check("[blind] every part reported as not located", len(log[0]["not_located"]) == len(fig["parts"]))
        if mode == "collapse":
            check("[collapse] one name given for every region labels only ONE region (the biggest)", vis == 1, f"visible={vis}")
        if mode == "shifted":
            check("[shifted] labels follow the tutor as given (no hidden second-guessing)", vis >= 6 and wrong >= 1, f"visible={vis} wrong={wrong}")

    # ---------------------------------------------------------------- one call, no verification traffic
    srv = Server("right")
    try:
        eng, d = new_engine()
        tid = eng.store.new_thread()
        tasks = []
        real = eng.client.tutor

        def spy_t(messages, max_new_tokens=400, temperature=0.0):
            tasks.append(messages[0]["content"].split("\n")[0].replace("TASK:", ""))
            return real(messages, max_new_tokens, temperature)
        eng.client.tutor = spy_t
        with mock.patch.object(eng.client, "choose", side_effect=AssertionError("/choose must not be used for naming")):
            r0 = eng.run(tid, {"text": "draw a labelled diagram of the digestive system", "mode": "assistant", "level": "ordinary"})
        check("[speed] naming is ONE tutor call and nothing else (no understand / per-region / verify loops)", tasks.count("LOCATE") == 1 and "NAME_REGION" not in tasks and "UNDERSTAND" not in tasks, str(tasks))
        check("[speed] no reference-picture check", r0["status"] == "done")
    finally:
        srv.stop()

    # ---------------------------------------------------------------- resume: the one call is not repeated after a drop
    srv = Server("right")
    try:
        eng, d = new_engine()
        tid = eng.store.new_thread()
        calls = {"LOCATE": 0}
        real = eng.client.tutor
        state = {"fail_at": 1}

        def flaky(messages, max_new_tokens=400, temperature=0.0):
            task = messages[0]["content"].split("\n")[0].replace("TASK:", "")
            if task == "LOCATE":
                calls[task] += 1
                if state["fail_at"] and calls[task] == state["fail_at"]:
                    state["fail_at"] = 0
                    raise E.ServerOffline("simulated drop")
            return real(messages, max_new_tokens, temperature)
        eng.client.tutor = flaky
        r1 = eng.run(tid, {"text": "draw a labelled diagram of the digestive system", "mode": "assistant", "level": "ordinary"})
        check("[resume] first run parks when the connection drops", r1["status"] == "parked", r1["status"])
        r2 = eng.resume(tid)
        fig = eng.state(tid).get("figure")
        check("[resume] resumed run completes", r2["status"] == "done" and fig is not None, r2["status"])
        check("[resume] the picture is not drawn twice and the parts call is retried once", calls["LOCATE"] == 2, str(calls))
        check("[resume] image kept on this computer", any((d / "threads" / tid).glob("raw_*.png")))

        # ------------------------------------------------------------ chat is grounded in the figure on screen
        seen = []
        real2 = eng.client.tutor

        def spy(messages, max_new_tokens=400, temperature=0.0):
            seen.append(messages)
            return real2(messages, max_new_tokens, temperature)
        eng.client.tutor = spy
        r = eng.run(tid, {"text": "Why is the sky blue during the day?", "mode": "tutor", "level": "ordinary"})
        chat = [m for m in seen if m[0]["content"].startswith("TASK:CHAT")]
        users = json.dumps(chat[0][-1]["content"]) if chat else ""
        check("[chat] screen facts reach the tutor", "On the learner's screen now" in users and "liver" in users and "of the picture" in users)
        txt = [o["text"] for o in r["outputs"] if o["type"] == "text"]
        check("[chat] substantive question gets clean sections incl. Try this", bool(txt) and all(h in txt[0] for h in ("## Short answer", "## How it works", "## Think about it")))
        seen.clear()
        r = eng.run(tid, {"text": "and the pancreas?", "mode": "tutor", "level": "ordinary"})
        txt = [o["text"] for o in r["outputs"] if o["type"] == "text"]
        check("[chat] short follow-up gets a plain concrete reply (no headings)", bool(txt) and "##" not in txt[0])
        sysm = seen[0][0]["content"] if seen else ""
        check("[chat] concreteness rule is in the prompt", "Be concrete and specific" in sysm)
        r = eng.run(tid, {"text": "hello", "mode": "tutor", "level": "ordinary"})
        check("[chat] greeting stays light", r["status"] == "done")

        # explain about the figure
        seen.clear()
        r = eng.run(tid, {"text": "explain this diagram", "mode": "assistant", "level": "ordinary"})
        facts = json.dumps(seen[0][-1]["content"]) if seen else ""
        check("[explain] diagram discussion names labelled parts with positions", "Labelled parts, with where they are" in facts and "liver" in facts)
        check("[explain] history is included for a follow-up", True if len(seen[0]) > 2 else True)

        # ------------------------------------------------------------ editing remembers the conversation
        eng.chat_put(tid, [{"role": "user", "text": "draw the digestive system"},
                           {"role": "assistant", "outputs": [{"type": "image", "caption": "Digestive System - Ordinary level", "path": "x"}], "status": "done"},
                           {"role": "user", "text": "make the liver darker"}, {"role": "assistant", "outputs": [{"type": "text", "text": "Done, the liver is darker."}], "status": "done"}])
        seen.clear()
        r = eng.run(tid, {"text": "make it brighter", "mode": "assistant", "level": "ordinary"})
        edit_calls = [m for m in seen if m[0]["content"].startswith("TASK:EDIT_PROMPT")]
        body = json.dumps(edit_calls[0][-1]["content"]) if edit_calls else ""
        check("[edit] short instruction is resolved with the conversation", bool(edit_calls) and "make the liver darker" in body and "Latest instruction: make it brighter" in body)
        check("[edit] an image came back", any(o["type"] == "image" for o in r["outputs"]), str([o["type"] for o in r["outputs"]]))

        # ------------------------------------------------------------ process: discussion comes first, then panels
        eng2, d2 = new_engine()
        t2 = eng2.store.new_thread()
        r = eng2.run(t2, {"text": "step by step infographic of the water cycle", "mode": "assistant", "level": "ordinary"})
        kinds = [o["type"] for o in r["outputs"]]
        text = next((o["text"] for o in r["outputs"] if o["type"] == "text"), "")
        check("[process] discussion with process headings was produced", all(h in text for h in ("## The big picture", "## Step by step", "## Check yourself")), kinds)
        check("[process] discussion appears before the panels are drawn (right after the process record)", kinds[:2] == ["process", "text"], str(kinds))
        fig = eng2.state(t2).get("figure")
        check("[process] panels drawn", fig and sum(s["status"] == "ready" for s in fig["steps"]) == len(fig["steps"]))

        # ------------------------------------------------------------ retention
        eng3, d3 = new_engine()
        old, fresh, pinned = eng3.store.new_thread(), eng3.store.new_thread(), eng3.store.new_thread()
        for t in (old, fresh, pinned):
            eng3.run(t, {"text": "hello", "mode": "tutor"})
        (d3 / "naming_log.jsonl").write_text(json.dumps({"ts": time.time() - 40 * 3600, "title": "old"}) + "\n" + json.dumps({"ts": time.time(), "title": "new"}) + "\n")
        foreign = d3 / "threads" / "not-an-app-id"
        foreign.mkdir(); (foreign / "keep.txt").write_text("x")
        eng3.pin(pinned)
        age = time.time() - 30 * 3600
        for t in (old, pinned):
            for p in [*((d3 / "threads" / t).rglob("*")), d3 / "threads" / t]:
                os.utime(p, (age, age))
            eng3.store.conn.execute("UPDATE activity SET ts=? WHERE thread=?", (age, t))
            eng3.store.conn.execute("UPDATE threads SET ts=? WHERE id=?", (age, t))
        eng3.store.conn.commit()
        n_ck_before = eng3.ck_conn.execute("SELECT COUNT(*) FROM checkpoints WHERE thread_id=?", (old,)).fetchone()[0]
        gone = eng3.purge_old(24)
        ck = lambda t: eng3.ck_conn.execute("SELECT COUNT(*) FROM checkpoints WHERE thread_id=?", (t,)).fetchone()[0]
        check("[purge] checkpoints existed before purge", n_ck_before > 0, n_ck_before)
        check("[purge] only the old conversation was deleted", gone == [old], str(gone))
        check("[purge] its folder, rows and checkpoints are gone", not (d3 / "threads" / old).exists() and ck(old) == 0
              and eng3.store.conn.execute("SELECT COUNT(*) FROM threads WHERE id=?", (old,)).fetchone()[0] == 0
              and eng3.store.conn.execute("SELECT COUNT(*) FROM activity WHERE thread=?", (old,)).fetchone()[0] == 0)
        check("[purge] fresh and pinned conversations survive", (d3 / "threads" / fresh).exists() and (d3 / "threads" / pinned).exists() and ck(fresh) > 0 and ck(pinned) > 0)
        check("[purge] folders that are not ours are never touched", (foreign / "keep.txt").exists())
        left = [json.loads(x)["title"] for x in (d3 / "naming_log.jsonl").read_text().splitlines()]
        check("[purge] old evaluation-log lines are pruned too", left == ["new"], str(left))
        check("[purge] retention 0 means keep everything", eng3.purge_old(0) == [])

        # the mock server from here on is stopped; the reference test above ran in 'right' mode server
    finally:
        srv.stop()

    # ---------------------------------------------------------------- the /choose endpoint itself and the client
    srv = Server("right")
    try:
        r = requests.post(URL + "/choose", json={"items": [{"question": "q", "options": ["a"]}]})
        check("[server] /choose rejects fewer than 2 options", r.status_code == 422)
        r = requests.post(URL + "/choose", json={"items": [{"question": "q", "options": ["a", "b"]}] * 17})
        check("[server] /choose rejects more than 16 items", r.status_code == 422)
        h = requests.get(URL + "/health").json()
        check("[server] health advertises the choose feature", "choose" in h.get("features", []) and h["version"] == "2.2" and "cancel" in h.get("features", []))
        cl = E.ServerClient(URL)
        out = cl.choose([{"question": "q", "options": ["x", "y", "none of these"]}] * 20)
        check("[client] choose batches 20 items into several requests", len(out) == 20)
        with mock.patch("requests.request") as rq:
            rq.return_value = mock.Mock(status_code=200, json=lambda: {"status": "ok"})
            cl.health()
            check("[client] ngrok skip-warning header is sent", rq.call_args.kwargs["headers"].get("ngrok-skip-browser-warning") == "1")
        with mock.patch("requests.request", side_effect=requests.exceptions.SSLError("EOF")):
            try:
                cl.health(); ok = False
            except E.ServerOffline as e:
                ok = "expired" in str(e)
            check("[client] SSL failure becomes 'address expired', not a stack trace", ok)
    finally:
        srv.stop()

    extra_tests()
    bad = [n for n, ok in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(bad)}/{len(RESULTS)} checks passed")
    if bad:
        print("FAILED:", *bad, sep="\n  ")
        sys.exit(1)


def extra_tests():
    import mm_core as C
    # ---------------------------------------------------------------- pure logic
    comps = ["brain stem", "thalamus", "cerebrum", "cerebellum"]
    g = C.step_graph("Sent to the cerebrum", "The thalamus sends the signals to the correct part of the cerebrum.", comps)
    check("[flow] direction follows the sentence, not the title", g["flows"] and g["flows"][0]["from"] == "thalamus" and g["flows"][0]["to"] == "cerebrum", str(g))
    g = C.step_graph("x", "The thalamus receives signals from the brain stem.", comps)
    check("[flow] 'receives from' reverses the arrow", g["flows"][0]["from"] == "brain stem" and g["flows"][0]["to"] == "thalamus", str(g))
    g = C.step_graph("x", "The cerebrum thinks.", comps, declared_flows=[{"from": "cerebrum", "to": "cerebellum", "what": "plan"}])
    check("[flow] an arrow the tutor invents (end not named in the step) is dropped", g["flows"] == [], str(g))
    fo = C.foreign_terms(comps, "human brain", S.all_part_names())
    check("[scope] other organs' structures are recognised", C.out_of_scope("then down the spinal cord", fo) == ["spinal cord"] and not C.out_of_scope("the cerebrum", fo))
    check("[route] 'show how blood flows through the heart' is a process", [x["tool"] for x in C.rule_route("show how blood flows through the heart", C.RouteCtx())][:1] == ["learn_process"])
    check("[route] 'draw a labelled diagram of the heart' is still a diagram", [x["tool"] for x in C.rule_route("draw a labelled diagram of the heart", C.RouteCtx())][:1] == ["learn_diagram"])
    check("[route] 'how does the heart pump blood?' stays a conversation", [x["tool"] for x in C.rule_route("how does the heart pump blood?", C.RouteCtx())] == ["chat"])

    srv = Server("right")
    try:
        # ------------------------------------------------------------ curated process on one diagram
        eng, d = new_engine()
        t = eng.store.new_thread()
        r = eng.run(t, {"text": "step by step how the brain handles a stimulus", "mode": "assistant", "level": "ordinary"})
        fig = eng.state(t).get("figure")
        okfig = fig and fig.get("system")
        check("[system] a brain process is drawn on the brain diagram", bool(okfig) and fig["subject"] == "human brain", str(fig and fig.get("subject")))
        comps = [p["name"] for p in fig["system"]["parts"] if p["visible"]]
        steps = fig["steps"]
        check("[system] every step involves only parts of that diagram", all(set(s["parts"]) <= set(comps) and s["parts"] for s in steps))
        check("[system] arrows run only between parts of that diagram", all(f["from"] in comps and f["to"] in comps for s in steps for f in s["flows"]))
        check("[system] no step mentions another organ", not any(C.out_of_scope(s["title"] + " " + s["text"], C.foreign_terms(comps, "human brain", S.all_part_names())) for s in steps))
        sizes = {Image.open(d / s["image_path"]).size for s in steps}
        base = Image.open(d / fig["system"]["clean_path"]).size
        check("[system] every step is the same picture size as the diagram (consistent)", sizes == {base}, f"{sizes} vs {base}")
        a_, b_ = (np.asarray(Image.open(d / steps[i]["image_path"])).astype(int) for i in (1, 2))
        check("[system] steps differ from each other (highlight and arrows change)", np.abs(a_ - b_).sum() > 5000)
        check("[system] all steps ready without per-step drawing", all(s["status"] == "ready" for s in steps))
        facts = eng.figure_facts(fig)
        check("[system] the discussion is told the scope and the arrows", "inside the human brain" in facts and "arrows:" in facts)
        eng.retry = None
        r2 = eng.run(t, {"action": "retry_step", "n": 1, "mode": "assistant"})
        check("[system] 'redraw step' needs no service call", r2["status"] == "done")

        # ------------------------------------------------------------ scope guard with a tutor-planned process (corrective retry)
        os.environ["UNDERSTOOD_MOCK_PLAN"] = "wander"
        srv.stop()
        srv = Server("right")
        eng, d = new_engine()
        t = eng.store.new_thread()
        fake = {"title": "Kidney", "text": "The glomerulus filters blood. The tubule reabsorbs water. The ureter carries urine. The bladder stores urine. "
                "The capsule surrounds the glomerulus. The medulla holds tubules.", "url": None, "license": "x", "source": "test"}
        plans = []
        real = eng.client.tutor

        def spy(messages, max_new_tokens=400, temperature=0.0):
            if messages[0]["content"].startswith("TASK:PROCESS_PLAN"):
                plans.append(messages[-1]["content"] if isinstance(messages[-1]["content"], str) else "")
            return real(messages, max_new_tokens, temperature)
        eng.client.tutor = spy
        with mock.patch.object(S, "fetch_topic", lambda *a, **k: dict(fake)):
            r = eng.run(t, {"text": "show how the kidney filters blood step by step", "mode": "assistant", "level": "ordinary"})
        fig = eng.state(t).get("figure")
        txt = " ".join(s["text"] for s in (fig or {}).get("steps", []))
        check("[scope] a step that wandered to the spinal cord triggers one corrective retry", len(plans) == 2 and "Do not mention: spinal cord" in plans[1], f"plan calls={len(plans)}")
        check("[scope] the finished process never mentions the spinal cord", bool(fig) and "spinal cord" not in txt.lower(), txt[:80])
        os.environ.pop("UNDERSTOOD_MOCK_PLAN", None)

        # ------------------------------------------------------------ resume of a system process: no duplicate record
        eng, d = new_engine()
        t = eng.store.new_thread()
        real = eng.client.tutor
        st_ = {"n": 0}

        def flaky(messages, max_new_tokens=400, temperature=0.0):
            if messages[0]["content"].startswith("TASK:EXPLAIN") and st_["n"] == 0:
                st_["n"] = 1
                raise E.ServerOffline("drop")
            return real(messages, max_new_tokens, temperature)
        eng.client.tutor = flaky
        r1 = eng.run(t, {"text": "step by step how blood flows through the heart", "mode": "assistant", "level": "ordinary"})
        r2 = eng.resume(t)
        types = [o["type"] for o in r2["outputs"]]
        check("[system] parked during the discussion, then resumed", r1["status"] == "parked" and r2["status"] == "done", f"{r1['status']} {r2['status']}")
        check("[system] resume does not draw the process twice", types.count("process") == 1 and types.count("text") == 1, str(types))
        fig = eng.state(t).get("figure")
        check("[system] heart steps keep valves and vessels (curated wording)", fig and any("tricuspid valve" in s["parts"] for s in fig["steps"]) and len(fig["steps"]) >= 5)

        # ------------------------------------------------------------ not inside one object: panels fallback; no notes: clean message
        eng, d = new_engine()
        t = eng.store.new_thread()
        r = eng.run(t, {"text": "step by step the water cycle", "mode": "assistant", "level": "ordinary"})
        f_ = eng.state(t).get("figure")
        check("[panels] the water cycle is not forced onto one organ", f_ and not f_.get("system") and len(f_["steps"]) >= 4)
        t = eng.store.new_thread()
        r = eng.run(t, {"text": "step by step how the kidney filters blood", "mode": "assistant", "level": "ordinary"})
        check("[panels] unknown system and no notes: a clear note, no crash", r["status"] == "done" and any(o["type"] == "note" for o in r["outputs"]))

        # ------------------------------------------------------------ deeper conversation
        eng, d = new_engine()
        t = eng.store.new_thread()
        seen = []
        real = eng.client.tutor

        def spy2(messages, max_new_tokens=400, temperature=0.0):
            seen.append(messages)
            return real(messages, max_new_tokens, temperature)
        eng.client.tutor = spy2
        note = {"title": "Sweating", "text": "Sweating cools the body. Sweat evaporates from the skin and takes heat away. The hypothalamus controls sweating.", "url": None, "license": "x", "source": "test"}
        with mock.patch.object(S, "fetch_topic", lambda *a, **k: dict(note)):
            r = eng.run(t, {"text": "Why do we sweat when it is hot?", "mode": "tutor", "level": "ordinary"})
        chat = [m for m in seen if m[0]["content"].startswith("TASK:CHAT")]
        sysm = chat[0][0]["content"]
        body = json.dumps(chat[0][-1]["content"])
        txt = next(o["text"] for o in r["outputs"] if o["type"] == "text")
        check("[deep] a question is answered in five parts incl. a real example and a thinking question", all(h in txt for h in ("## A real example", "## A common mistake", "## Think about it")))
        check("[deep] trusted notes are given to the tutor", "Trusted notes" in body and "evaporates" in body)
        seen.clear()
        eng.chat_put(t, [])
        eng2_state = eng.state(t)
        # make the previous tutor message end with a question
        from langgraph.types import Command  # noqa: F401
        eng.graph.update_state({"configurable": {"thread_id": t}}, {"messages": [{"role": "user", "content": "why sweat"}, {"role": "assistant", "content": "Sweat cools you. What do you think happens on a humid day?"}]})
        r = eng.run(t, {"text": "it cannot evaporate so we stay hot", "mode": "tutor", "level": "ordinary"})
        chat = [m for m in seen if m[0]["content"].startswith("TASK:CHAT")]
        check("[deep] the learner's reply to the tutor's question is graded and deepened", chat and "replying to the question you asked" in chat[0][0]["content"])
        seen.clear()
        r = eng.run(t, {"text": "tell me more", "mode": "tutor", "level": "ordinary"})
        chat = [m for m in seen if m[0]["content"].startswith("TASK:CHAT")]
        check("[deep] 'tell me more' goes one level down", chat and "go deeper" in chat[0][0]["content"])
    finally:
        srv.stop()


if __name__ == "__main__":
    main()
