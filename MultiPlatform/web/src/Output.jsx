import React, { useEffect, useState } from "react";

// The tutor's text answers often come back as "## Heading\ntext\n## Next heading\ntext" (section_answer()
// in mm_engine.py builds these on purpose - see DEEP_SECTIONS/DIAGRAM_SECTIONS/CHAT_SECTIONS in mm_core.py).
// A full markdown library is overkill for this one pattern, so this just splits on "## " headings and
// treats everything else as a paragraph - enough to turn "## What you see\ntext" into a real heading
// instead of literal "##" showing up in the UI.
function renderSections(text) {
  const blocks = (text || "").split(/\n(?=##\s)/);
  return blocks.map((block, i) => {
    // [^\n]+ (not a lazy .+?) so the heading capture consumes the WHOLE first line - a lazy
    // quantifier here would backtrack to a 1-character match since the rest of the pattern
    // (\n? then [\s\S]*) is satisfied either way, which is exactly the bug this regex had before.
    const m = block.match(/^##\s+([^\n]+)\n?([\s\S]*)$/);
    if (m) {
      return (
        <div key={i} className="md-section">
          <h3>{m[1].trim()}</h3>
          {m[2].trim() && <p>{m[2].trim()}</p>}
        </div>
      );
    }
    return block.trim() ? <p key={i}>{block.trim()}</p> : null;
  });
}

// A "process" output just points at a JSON record (mm_engine.py's process_save()/self.rel()) rather than
// embedding the steps inline, so this fetches it once and gives a Previous/Next viewer over fig.steps.
// By the time the engine emits the "process" output, render_system_steps()/draw_step() have already run
// for every step in the same turn (see process_on_system / process_panels in mm_engine.py), so a single
// fetch is enough - we don't need to poll for images to finish.
function ProcessViewer({ path, fileUrl }) {
  const [fig, setFig] = useState(null);
  const [err, setErr] = useState("");
  const [i, setI] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFig(null);
    setErr("");
    setI(0);
    fetch(fileUrl(path))
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} loading process record`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setFig(data);
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [path, fileUrl]);

  if (err) return <p className="out-note">Could not load the step-by-step process ({err}).</p>;
  if (!fig) return <p className="out-note">Loading steps…</p>;

  const steps = fig.steps || [];
  if (steps.length === 0) return <p className="out-note">This process has no steps.</p>;
  const step = steps[i];

  return (
    <div className="out-process">
      <p className="process-title">
        {fig.title} <span className="process-shape">({fig.shape})</span>
      </p>
      <div className="process-step">
        <div className="process-step-head">
          <span className="process-step-n">
            Step {step.n} of {steps.length}
          </span>
          <span className={`process-status process-status-${step.status}`}>{step.status}</span>
        </div>
        <h4>{step.title}</h4>
        {step.image_path ? (
          <img className="process-step-img" src={fileUrl(step.image_path)} alt={step.title} />
        ) : (
          <p className="out-note">No image for this step yet.</p>
        )}
        {step.text && <p>{step.text}</p>}
      </div>
      <div className="process-nav">
        <button onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0}>
          ← Previous
        </button>
        <div className="process-dots">
          {steps.map((s, j) => (
            <button
              key={j}
              className={`process-dot ${j === i ? "active" : ""} process-dot-${s.status}`}
              onClick={() => setI(j)}
              aria-label={`Step ${j + 1}`}
              title={s.title}
            />
          ))}
        </div>
        <button onClick={() => setI((n) => Math.min(steps.length - 1, n + 1))} disabled={i === steps.length - 1}>
          Next →
        </button>
      </div>
      {fig.source_note && <p className="out-sources">{fig.source_note}</p>}
    </div>
  );
}

// One switch, one place: every output "type" the engine emits (see mm_engine.py's self.out() calls)
// gets exactly one rendering rule here. Add a new case the day the engine starts emitting a new type -
// until then an unrecognised type still shows as a labelled fallback instead of silently vanishing.
export default function Output({ o, fileUrl, onChoice }) {
  switch (o.type) {
    case "text":
      return <div className="out-text">{renderSections(o.text)}</div>;

    case "note":
      return <p className="out-note">{o.text}</p>;

    case "understood":
      return <p className="out-plan">{o.text}</p>;

    case "image":
      return (
        <figure className="out-image">
          <img src={fileUrl(o.path)} alt={o.caption || "generated"} />
          {o.caption && <figcaption>{o.caption}</figcaption>}
        </figure>
      );

    case "video":
      return (
        <video className="out-video" controls src={fileUrl(o.path)}>
          Your browser can't play this video.
        </video>
      );

    case "sources":
      return (
        <ul className="out-sources">
          {(o.items || []).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      );

    case "file":
    case "doc":
      return (
        <a className="out-file" href={fileUrl(o.path)} target="_blank" rel="noreferrer">
          📄 {o.name || "Download"}
        </a>
      );

    case "process":
      return <ProcessViewer path={o.path} fileUrl={fileUrl} />;

    case "choices":
      return (
        <div className="out-choices">
          <p>{o.text}</p>
          <div className="choice-buttons">
            {(o.options || []).map((opt) => (
              <button key={opt} onClick={() => onChoice(o.topic, opt)}>
                {opt}
              </button>
            ))}
          </div>
        </div>
      );

    default:
      return <p className="out-unknown">[{o.type}]</p>;
  }
}
