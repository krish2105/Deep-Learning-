import Link from "next/link";
import { ChromaDrain } from "@/components/landing/ChromaDrain";
import { HeroVisual } from "@/components/landing/HeroVisual";
import { Reveal, SmoothScroll, Stagger, StaggerItem } from "@/components/motion/Primitives";
import { ThemeToggle } from "@/components/ThemeToggle";

const SYLLABUS = [
  { wk: "01–02", topic: "Neural networks & backpropagation", detail: "Backprop from scratch in NumPy; activation and optimiser ablation." },
  { wk: "03", topic: "Convolutional neural networks", detail: "DenseNet-121 multi-label classifier over 14 thoracic pathologies." },
  { wk: "04", topic: "Recurrent neural networks", detail: "GRU over per-visit embeddings, forecasting progression." },
  { wk: "05", topic: "Long short-term memory", detail: "BiLSTM vs GRU vs vanilla RNN on real patient timelines." },
  { wk: "06", topic: "Generative adversarial networks", detail: "DCGAN synthesises rare findings; measured ΔAUC on minority classes." },
  { wk: "07", topic: "Autoencoders & VAEs", detail: "Convolutional VAE rejects anything that is not a chest radiograph." },
  { wk: "08", topic: "Transfer learning", detail: "ImageNet→CXR; frozen vs progressive unfreezing." },
  { wk: "09", topic: "Deep reinforcement learning", detail: "DQN orders the worklist to minimise time-to-critical-diagnosis." },
  { wk: "10", topic: "Vision transformers & CLIP", detail: "ViT-B/16 branch; CNN vs Transformer head-to-head." },
  { wk: "11", topic: "Generative AI integration", detail: "Reports drafted from model output, never from the image." },
  { wk: "12", topic: "Ethics & societal impact", detail: "Bias audit by age, sex and view position; equalised-odds gaps." },
];

const DEFENCES = [
  {
    n: "Distributional gate",
    body: "A variational autoencoder scores reconstruction error. If the image is not a chest radiograph, it is refused before the classifier ever runs — a category error deserves refusal, not a probability.",
  },
  {
    n: "Epistemic uncertainty",
    body: "Monte-Carlo dropout separates the model's own ignorance from genuine ambiguity in the film. Only ignorance justifies abstention; ambiguity is reported as ambiguity.",
  },
  {
    n: "Conformal prediction",
    body: "A calibrated nonconformity threshold turns scores into a set with a distribution-free coverage guarantee. When the set is empty or implausibly large, the system abstains.",
  },
];

export default function Landing() {
  return (
    <SmoothScroll>
      <Nav />

      <main id="main">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pt-28 pb-20 lg:grid-cols-[1.1fr_0.9fr] lg:pt-36">
          <div>
            <Reveal>
              <p className="tabular text-[11px] tracking-[0.28em] text-[var(--film-mid)]">
                MAIB AI 114 · FINAL GROUP PROJECT
              </p>
            </Reveal>
            <Reveal delay={0.08}>
              <h1
                className="mt-5 font-[family-name:var(--font-display)] leading-[0.94] tracking-[-0.02em]"
                style={{ fontSize: "var(--text-hero)" }}
              >
                It tells you when it doesn&rsquo;t know.
              </h1>
            </Reveal>
            <Reveal delay={0.16}>
              <p className="mt-7 max-w-lg text-[var(--text-step-1)] text-[var(--film-mid)]">
                A chest radiograph triage system with calibrated uncertainty.
                Fourteen pathologies, a statistical coverage guarantee, and the
                discipline to abstain rather than guess.
              </p>
            </Reveal>
            <Reveal delay={0.24}>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link
                  href="/console"
                  className="rounded-full px-6 py-3 text-sm font-medium transition-transform hover:scale-[1.02] active:scale-[0.99]"
                  style={{ background: "var(--instrument)", color: "#fff" }}
                >
                  Open the console
                </Link>
                <a
                  href="#method"
                  className="rounded-full border px-6 py-3 text-sm font-medium"
                  style={{ borderColor: "var(--film-shoulder)" }}
                >
                  How it works
                </a>
              </div>
            </Reveal>
            <Reveal delay={0.32}>
              <p className="mt-8 max-w-md text-xs text-[var(--film-mid)]">
                Research prototype. Not a medical device, and not for clinical use.
              </p>
            </Reveal>
          </div>

          <Reveal delay={0.2} className="justify-self-center lg:justify-self-end">
            <HeroVisual />
          </Reveal>
        </section>

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
              A model that outputs a probability for every input will output one
              for a photograph of a cat, for a film degraded at acquisition, and
              for a case where the evidence genuinely does not support a
              decision. Fluent and wrong is more dangerous than silent.
            </p>
          </Reveal>

          <Stagger className="mt-12 space-y-4">
            {DEFENCES.map((d, i) => (
              <StaggerItem key={d.n}>
                <div
                  className="rounded-sm border p-5"
                  style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
                >
                  <div className="flex items-baseline gap-3">
                    <span className="tabular text-xs text-[var(--instrument)]">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="font-medium">{d.n}</h3>
                  </div>
                  <p className="mt-2 pl-8 text-sm text-[var(--film-mid)]">{d.body}</p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        {/* ── Signature: chroma drain ──────────────────────────────────── */}
        <ChromaDrain />

        {/* ── Syllabus coverage ────────────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-6 py-24">
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
              numbers, so a patient&rsquo;s studies form a real timeline.
            </p>
          </Reveal>

          <Stagger className="mt-12 grid gap-px overflow-hidden rounded-sm border sm:grid-cols-2 lg:grid-cols-3"
            >
            {SYLLABUS.map((s) => (
              <StaggerItem key={s.wk}>
                <div className="h-full p-5" style={{ background: "var(--film-panel)" }}>
                  <span className="tabular text-[11px] tracking-widest text-[var(--instrument)]">
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

        {/* ── Architecture ─────────────────────────────────────────────── */}
        <section className="mx-auto max-w-4xl px-6 py-24">
          <Reveal>
            <p className="tabular text-[11px] tracking-[0.28em] text-[var(--film-mid)]">
              ARCHITECTURE
            </p>
            <h2
              className="mt-4 font-[family-name:var(--font-display)] leading-[1.05]"
              style={{ fontSize: "var(--text-step-4)" }}
            >
              Built around a hard constraint.
            </h2>
            <p className="mt-5 text-[var(--film-mid)]">
              Render&rsquo;s free tier gives 512&nbsp;MB of memory. PyTorch does
              not fit. So inference lives on Hugging Face Spaces with 16&nbsp;GB,
              and the orchestrator keeps a quantised ONNX path in reserve. When
              the Space is cold, the fast path answers immediately and the
              interface says so.
            </p>
          </Reveal>

          <Reveal delay={0.1}>
            <div
              className="tabular mt-10 overflow-x-auto rounded-sm border p-6 text-xs leading-relaxed"
              style={{ borderColor: "var(--film-shoulder)", background: "var(--film-panel)" }}
            >
              <pre className="min-w-max text-[var(--film-mid)]">{`  Vercel ─────────── Next.js 15 · console + landing
     │
     ▼  HTTPS + JWT
  Render ─────────── FastAPI · 512 MB · no PyTorch
     │               conformal head · audit log
     ├── cold ─────▶ ONNX int8 · < 900 ms · reduced mode
     │
     ▼  warm
  HF Spaces ──────── 16 GB · DenseNet · ViT · VAE · LSTM · Grad-CAM
     │
     ▼
  Supabase ───────── Postgres + object storage`}</pre>
            </div>
          </Reveal>
        </section>

        {/* ── Team ─────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-4xl px-6 py-24">
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

      <footer
        className="border-t px-6 py-10"
        style={{ borderColor: "var(--film-shoulder)" }}
      >
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
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            href="/dashboard"
            className="hidden rounded-full px-3 py-2 text-xs text-[var(--film-mid)] sm:block"
          >
            Dashboard
          </Link>
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
