import Link from "next/link";
import { ChromaDrain } from "@/components/landing/ChromaDrain";
import { Hero } from "@/components/landing/Hero";
import {
  Architecture,
  LiveDemo,
  Marquee,
  MetricsWall,
  Pipeline,
} from "@/components/landing/Sections";
import { Reveal, SmoothScroll, Stagger, StaggerItem } from "@/components/motion/Primitives";
import { ThemeToggle } from "@/components/ThemeToggle";

const SYLLABUS = [
  { wk: "01–02", topic: "Neural networks & backprop", detail: "From-scratch NumPy backpropagation, verified to 7.2e-11 against finite differences." },
  { wk: "03", topic: "Convolutional networks", detail: "DenseNet-121 over 14 thoracic pathologies, quantised to 7.9 MB for deployment." },
  { wk: "04", topic: "Recurrent networks", detail: "GRU over per-visit embeddings — ChestX-ray14 carries real follow-up sequences." },
  { wk: "05", topic: "Long short-term memory", detail: "RNN vs GRU vs LSTM under identical seeds, with gradient-flow analysis." },
  { wk: "06", topic: "Generative adversarial nets", detail: "DCGAN synthesises rare findings; measured ΔAUPRC on minority classes." },
  { wk: "07", topic: "Autoencoders & VAEs", detail: "Convolutional VAE rejects anything that is not a chest radiograph." },
  { wk: "08", topic: "Transfer learning", detail: "Scratch vs frozen vs full vs progressive unfreezing, plus a data-efficiency curve." },
  { wk: "09", topic: "Deep reinforcement learning", detail: "Double DQN orders the worklist; beats FIFO by 2× on accumulated urgency cost." },
  { wk: "10", topic: "Vision transformers & CLIP", detail: "ViT-B/16 against the CNN under equal budgets; BiomedCLIP zero-shot floor." },
  { wk: "11", topic: "Generative AI integration", detail: "Reports drafted from model output only, with an output verifier that rejects invented findings." },
  { wk: "12", topic: "Ethics & fairness", detail: "Disaggregated audit by sex, age and view position; the AP/PA shortcut probed directly." },
];

export default function Landing() {
  return (
    <SmoothScroll>
      <Nav />

      <Hero />

      <main id="main" className="page-surface">
        <Marquee />
        <MetricsWall />

        {/* ── The problem ──────────────────────────────────────────────── */}
        <section id="method" className="mx-auto max-w-3xl px-6 py-24">
          <Reveal>
            <p className="tabular text-[11px] tracking-[0.28em] text-[var(--film-mid)]">
              THE PROBLEM
            </p>
            <h2
              className="mt-4 font-[family-name:var(--font-display)] leading-[1.05]"
              style={{ fontSize: "var(--text-step-4)" }}
            >
              Unearned confidence, not accuracy, is what blocks deployment.
            </h2>
            <p className="mt-5 text-[var(--film-mid)]">
              A model trained with cross-entropy emits a probability for every
              input — including a photograph, a mispositioned film, and cases
              where the evidence genuinely does not support a decision. Clinicians
              are measurably less likely to override a confident machine
              judgement, so fluent and wrong is more dangerous than silent.
            </p>
          </Reveal>

          <Stagger className="mt-12 space-y-4">
            {[
              ["Distributional gate", "A variational autoencoder scores reconstruction error. Anything that is not a chest radiograph is refused before the classifier runs — a category error deserves refusal, not a probability."],
              ["Epistemic uncertainty", "Sampling separates the model's own ignorance from irreducible ambiguity in the film. Only ignorance justifies abstention; ambiguity is reported as ambiguity."],
              ["Conformal prediction", "A calibrated nonconformity threshold turns scores into a set with distribution-free finite-sample coverage. Empty or implausibly large, and the system abstains."],
            ].map(([title, body], i) => (
              <StaggerItem key={title}>
                <div
                  className="rounded-sm border p-5"
                  style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
                >
                  <div className="flex items-baseline gap-3">
                    <span className="tabular text-xs" style={{ color: "var(--instrument)" }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="font-medium">{title}</h3>
                  </div>
                  <p className="mt-2 pl-8 text-sm text-[var(--film-mid)]">{body}</p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        <LiveDemo />
        <ChromaDrain />
        <Pipeline />
        <Architecture />

        {/* ── Syllabus ─────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-6 py-24">
          <Reveal>
            <p className="tabular text-[11px] tracking-[0.28em] text-[var(--film-mid)]">
              TWELVE WEEKS, ONE SYSTEM
            </p>
            <h2
              className="mt-4 font-[family-name:var(--font-display)] leading-[1.05]"
              style={{ fontSize: "var(--text-step-4)" }}
            >
              Every topic on the unit, inside one architecture.
            </h2>
            <p className="mt-5 max-w-2xl text-[var(--film-mid)]">
              Not eleven disconnected exercises. The recurrent branch exists
              because ChestX-ray14 carries patient identifiers and follow-up
              numbers, so a patient&rsquo;s studies form a genuine timeline.
            </p>
          </Reveal>

          <Stagger className="mt-12 grid gap-px overflow-hidden rounded-sm border sm:grid-cols-2 lg:grid-cols-3">
            {SYLLABUS.map((s) => (
              <StaggerItem key={s.wk}>
                <div className="h-full p-5" style={{ background: "var(--film-panel)" }}>
                  <span className="tabular text-[11px] tracking-widest" style={{ color: "var(--instrument)" }}>
                    WK {s.wk}
                  </span>
                  <h3 className="mt-2 text-sm font-medium">{s.topic}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--film-mid)]">
                    {s.detail}
                  </p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        {/* ── Team ─────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-4xl px-6 pb-24">
          <Reveal>
            <p className="tabular text-[11px] tracking-[0.28em] text-[var(--film-mid)]">
              GROUP
            </p>
            <div className="mt-6 grid gap-px overflow-hidden rounded-sm border sm:grid-cols-3">
              {[
                ["Krishna Mathur", "AS25DXB018"],
                ["Atharva Soundankar", "AS25DXB020"],
                ["Yash Petkar", "AS25DXB021"],
              ].map(([name, id]) => (
                <div key={id} className="p-5" style={{ background: "var(--film-panel)" }}>
                  <p className="text-sm font-medium">{name}</p>
                  <p className="tabular mt-1 text-xs text-[var(--film-mid)]">{id}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-sm text-[var(--film-mid)]">
              Deep Learning (MAIB AI 114) · Prof Anshul Gupta · S P Jain School
              of Global Management, Dubai
            </p>
          </Reveal>
        </section>
      </main>

      <footer className="page-surface border-t px-6 py-10" style={{ borderColor: "var(--film-shoulder)" }}>
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-[var(--film-mid)]">
            SENTINEL-CXR — research prototype. Not a medical device. Must not be
            used for clinical decisions.
          </p>
          <a
            href="https://github.com/krish2105/Deep-Learning-"
            className="text-xs underline decoration-dotted underline-offset-4"
          >
            Source
          </a>
        </div>
      </footer>
    </SmoothScroll>
  );
}

function Nav() {
  return (
    <header
      className="fixed inset-x-0 top-0 z-50 border-b backdrop-blur-md"
      style={{
        borderColor: "var(--film-shoulder)",
        background: "color-mix(in oklab, var(--film-base) 82%, transparent)",
      }}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-10 focus:rounded focus:px-3 focus:py-2"
        style={{ background: "var(--instrument)", color: "#fff" }}
      >
        Skip to content
      </a>
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link href="/" className="tabular text-sm font-semibold tracking-[0.12em]">
          SENTINEL<span style={{ color: "var(--instrument)" }}>·</span>CXR
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <a href="#method" className="hidden rounded-full px-3 py-2 text-xs text-[var(--film-mid)] sm:block">
            Method
          </a>
          <Link href="/dashboard" className="hidden rounded-full px-3 py-2 text-xs text-[var(--film-mid)] sm:block">
            Dashboard
          </Link>
          <ThemeToggle />
          <Link
            href="/console"
            className="rounded-full px-4 py-2 text-xs font-medium"
            style={{ background: "var(--instrument)", color: "#fff" }}
          >
            Console
          </Link>
        </div>
      </nav>
    </header>
  );
}
