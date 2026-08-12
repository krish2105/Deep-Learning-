"use client";

import type { Study } from "@/lib/types";

/**
 * Per-study clinical report, rendered for print/PDF export.
 *
 * Hidden on screen, shown only by the print stylesheet. Using the browser's own
 * print-to-PDF avoids shipping a PDF library to every visitor and avoids doing
 * document rendering on a 0.1-CPU dyno — the output is vector text, selectable
 * and searchable, which a canvas-based library would not give.
 *
 * Deliberately monochrome and paper-first: this is the one surface that leaves
 * the application, so it carries the full provenance and the non-diagnostic
 * notice on the page itself, not in a tooltip.
 */
export function PrintableReport({ study }: { study: Study }) {
  const positive = study.findings.filter((f) => f.included);
  const borderline = study.findings.filter(
    (f) => !f.included && f.margin > -0.1 && f.margin < 0,
  );
  const generated = new Date().toISOString().replace("T", " ").slice(0, 16);

  return (
    <div className="print-report" aria-hidden>
      <header className="pr-head">
        <div>
          <h1>SENTINEL-CXR</h1>
          <p className="pr-sub">Uncertainty-Aware Chest Radiograph Triage</p>
        </div>
        <div className="pr-meta">
          <div>Study {study.id.slice(0, 8)}</div>
          <div>Patient {study.patient_ref || "—"} · visit {study.follow_up_index + 1}</div>
          <div>Generated {generated} UTC</div>
        </div>
      </header>

      <p className="pr-banner">
        RESEARCH PROTOTYPE — NOT A MEDICAL DEVICE. This draft was produced by a
        student system for the Deep Learning unit (MAIB AI 114) at S P Jain
        School of Global Management. It has no regulatory clearance and must not
        inform patient care. A qualified radiologist must review the image.
      </p>

      <section className="pr-grid">
        {study.image_url && (
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={study.image_url} alt="" />
            <figcaption>Submitted radiograph</figcaption>
          </figure>
        )}
        {Object.entries(study.gradcam)
          .slice(0, 1)
          .map(([k, src]) => (
            <figure key={k} className="pr-cam">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {study.image_url && <img src={study.image_url} alt="" />}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="pr-overlay" />
              <figcaption>Grad-CAM · {k.replace(/_/g, " ")}</figcaption>
            </figure>
          ))}
      </section>

      <h2>Findings</h2>
      {study.is_ood ? (
        <p>
          Rejected before analysis. Reconstruction error {study.ood_score.toFixed(4)}{" "}
          exceeded the distributional threshold, indicating this is not a frontal
          chest radiograph of the kind the model was trained on. No classification
          was attempted.
        </p>
      ) : positive.length ? (
        <table>
          <thead>
            <tr>
              <th>Finding</th>
              <th>Probability</th>
              <th>Threshold τ</th>
              <th>Margin</th>
              <th>Epistemic</th>
            </tr>
          </thead>
          <tbody>
            {positive.map((f) => (
              <tr key={f.name}>
                <td>{f.display_name}</td>
                <td className="num">{f.probability.toFixed(3)}</td>
                <td className="num">{f.threshold.toFixed(3)}</td>
                <td className="num">+{f.margin.toFixed(3)}</td>
                <td className="num">{f.epistemic.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No pathology met its calibrated detection threshold.</p>
      )}

      {borderline.length > 0 && (
        <>
          <h2>Borderline</h2>
          <ul>
            {borderline.map((f) => (
              <li key={f.name}>
                {f.display_name}: {f.probability.toFixed(3)}, just below its
                threshold of {f.threshold.toFixed(3)}.
              </li>
            ))}
          </ul>
        </>
      )}

      {study.conformal && (
        <>
          <h2>Statistical basis</h2>
          <p>
            Prediction set:{" "}
            {study.conformal.prediction_set.length
              ? study.conformal.prediction_set.map((p) => p.replace(/_/g, " ")).join(", ")
              : "empty"}
            . Nominal coverage {(study.conformal.coverage_target * 100).toFixed(0)}%
            (α = {study.conformal.alpha}). Coverage is marginal per label, not
            simultaneous across all fourteen.
          </p>
          {study.abstained && (
            <p className="pr-abstain">
              <strong>The system abstained.</strong> {study.abstain_reason} This
              study requires a radiologist read.
            </p>
          )}
        </>
      )}

      {study.progression?.available && (
        <>
          <h2>Comparison with priors</h2>
          <p>{study.progression.narrative}</p>
        </>
      )}

      <h2>Triage</h2>
      <p>
        <strong>{study.triage_priority}</strong> (score{" "}
        {study.triage_score.toFixed(3)}). {study.triage_rationale}
      </p>

      <h2>Draft impression</h2>
      <pre>{study.report_text}</pre>

      <footer className="pr-foot">
        Inference mode: {study.mode} · latency {study.latency_ms} ms · report
        source: {study.report_source || "—"}. Weight provenance and known
        limitations are documented in the project model card. Grad-CAM indicates
        where activation correlates with the score; it is not a causal
        explanation.
      </footer>
    </div>
  );
}
