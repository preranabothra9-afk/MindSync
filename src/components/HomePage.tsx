import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import {
  Sparkles, ArrowRight, LogIn, UserPlus, Layers, Users,
  Columns3, BookmarkCheck, LineChart, ShieldCheck, Zap, Hash,
  CheckCircle2, ChevronRight, Cpu, MessageSquare, LayoutDashboard, LogOut,
  MailCheck, BadgeCheck, Gavel, Scale, Quote, Paperclip
} from 'lucide-react';
import { MindMark, BRAND } from '../brand';
import ThemeSwitcher from './ThemeSwitcher';

/**
 * MindSync public landing page — the first surface unauthenticated visitors see.
 * Sits ahead of the auth portal at "/"; CTAs route to /login and /register.
 */
export default function HomePage() {
  const { navigateTo, user, logout } = useStore();
  const [scrolled, setScrolled] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);

  const isLoggedIn = !!user;
  const isAdmin = user?.role === 'admin';
  const dashboardPath = isAdmin ? '/admin/dashboard' : '/';
  const dashboardLabel = isAdmin ? 'Admin Dashboard' : 'Workspaces';

  // Navbar gains a glass backdrop once the page is scrolled
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Hero pointer parallax → --mx/--my
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const onMove = (e: PointerEvent) => {
      hero.style.setProperty('--mx', String((e.clientX / window.innerWidth) - 0.5));
      hero.style.setProperty('--my', String((e.clientY / window.innerHeight) - 0.5));
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  const goToLogin = () => navigateTo('/login');
  const goToRegister = () => navigateTo('/register');

  return (
    <div ref={heroRef} className="relative min-h-screen bg-ink font-sans text-sand overflow-x-hidden grain">

      {/* ── Ambient background: one soft warm wash, no giant blurred orbs ── */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            'radial-gradient(60rem 40rem at 12% -8%, color-mix(in srgb, var(--color-ember) 9%, transparent), transparent 62%),' +
            'radial-gradient(48rem 34rem at 92% 8%, color-mix(in srgb, var(--color-ember-soft) 8%, transparent), transparent 60%)',
        }}
      />

      {/* ── Theme switcher ──────────────────────────────────────────── */}
      <ThemeSwitcher variant="floating" className="fixed top-4 right-4 z-60" />

      {/* ── Navbar ──────────────────────────────────────────────────── */}
      <header
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
          scrolled ? 'glass border-b border-line' : 'border-b border-transparent'
        }`}
      >
        <nav className="max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5 select-none">
            <MindMark size={30} />
            <span className="font-bold text-cream tracking-tight text-lg">
              Mind<span className="text-ember">Sync</span>
            </span>
          </div>

          <div className="hidden md:flex items-center gap-7 text-sm">
            <a href="#features" className="text-sand hover:text-cream transition-colors">Features</a>
            <a href="#how-it-works" className="text-sand hover:text-cream transition-colors">How it works</a>
            <a href="#decisions" className="text-sand hover:text-cream transition-colors">Decisions</a>
            <a href="#models" className="text-sand hover:text-cream transition-colors">Models</a>
          </div>

          <div className="flex items-center gap-2.5">
            {isLoggedIn ? (
              <>
                <div className="hidden sm:flex items-center gap-2 mr-1">
                  <div className="w-7 h-7 rounded-full bg-linear-to-br from-ember to-ember-2 text-on-ember font-bold flex items-center justify-center text-[13px] ring-2 ring-ember/20">
                    {user?.avatar || user?.name?.[0]?.toUpperCase() || 'U'}
                  </div>
                  <span className="text-[13px] font-medium text-cream">{user?.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => navigateTo(dashboardPath)}
                  className="px-4 py-2 text-sm font-semibold bg-ember hover:bg-ember-2 text-on-ember rounded-xl transition-colors shadow-lg shadow-ember/20 cursor-pointer flex items-center gap-1.5 btn-3d"
                >
                  <LayoutDashboard size={14} />
                  {dashboardLabel}
                </button>
                <button
                  type="button"
                  onClick={logout}
                  className="p-2 text-sand hover:text-cream hover:bg-panel-2 rounded-lg transition-colors cursor-pointer"
                  title="Sign out"
                >
                  <LogOut size={16} />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={goToLogin}
                  className="px-3.5 py-2 text-sm font-medium text-sand hover:text-cream transition-colors cursor-pointer"
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={goToRegister}
                  className="px-4 py-2 text-sm font-semibold bg-ember hover:bg-ember-2 text-on-ember rounded-xl transition-colors shadow-lg shadow-ember/20 cursor-pointer flex items-center gap-1.5 btn-3d"
                >
                  Get Started
                  <ArrowRight size={14} />
                </button>
              </>
            )}
          </div>
        </nav>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section className="relative pt-36 pb-24 px-5 sm:px-8">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-14 lg:gap-10 items-center">

          {/* Copy */}
          <div className="flex flex-col items-start gap-6 max-w-xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-ember/10 px-3.5 py-1.5 text-[13px] font-semibold uppercase tracking-wider text-ember">
              <Sparkles size={14} />
              <span>Multi-Model AI Collaboration</span>
            </div>

            <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.75rem] font-semibold tracking-tight leading-[1.08] text-cream">
              One prompt.<br />
              <span className="text-ember">Every model.</span><br />
              One shared workspace.
            </h1>

            <p className="text-lg text-sand leading-relaxed">
              {BRAND.name} broadcasts your prompt to multiple AI models at once and streams
              their answers side-by-side — so your team compares, refines, and pins the best
              output in real time. No more tab-switching. No more guesswork.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              {isLoggedIn ? (
                <>
                  <button
                    type="button"
                    onClick={() => navigateTo(dashboardPath)}
                    className="px-6 py-3 bg-ember hover:bg-ember-2 text-on-ember font-semibold text-sm rounded-xl transition-colors shadow-lg shadow-ember/25 cursor-pointer flex items-center gap-2 btn-3d"
                  >
                    <LayoutDashboard size={15} />
                    Go to {dashboardLabel}
                  </button>
                  <button
                    type="button"
                    onClick={logout}
                    className="px-6 py-3 glass border border-line-2 text-cream font-semibold text-sm rounded-xl hover:border-ember/40 transition-colors cursor-pointer flex items-center gap-2"
                  >
                    <LogOut size={15} />
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={goToRegister}
                    className="px-6 py-3 bg-ember hover:bg-ember-2 text-on-ember font-semibold text-sm rounded-xl transition-colors shadow-lg shadow-ember/25 cursor-pointer flex items-center gap-2 btn-3d"
                  >
                    <UserPlus size={15} />
                    Start free — no card needed
                  </button>
                  <button
                    type="button"
                    onClick={goToLogin}
                    className="px-6 py-3 glass border border-line-2 text-cream font-semibold text-sm rounded-xl hover:border-ember/40 transition-colors cursor-pointer flex items-center gap-2"
                  >
                    <LogIn size={15} />
                    Sign in
                  </button>
                </>
              )}
            </div>

            <div className="flex items-center gap-5 pt-2">
              <div className="flex -space-x-2">
                {['A', 'S', 'M', 'J'].map((l, i) => (
                  <div
                    key={l}
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold border-2 border-ink ${
                      i === 0 ? 'bg-ember text-on-ember' : 'bg-panel-2 text-sand border-line-2'
                    }`}
                  >
                    {l}
                  </div>
                ))}
              </div>
              <p className="text-[13px] text-faint">
                Trusted by teams shipping<br className="sm:hidden" /> with AI every day
              </p>
            </div>
          </div>

          {/* 3D product mock */}
          <HeroMock />
        </div>

        {/* Model marquee */}
        <div id="models" className="mt-24 sm:mt-32 scroll-mt-24">
          <p className="text-center text-[13px] font-mono font-bold uppercase tracking-widest text-faint mb-6">
            Compare every major model in one place
          </p>
          <div className="marquee-mask overflow-hidden">
            <div className="animate-marquee flex w-max items-center gap-10 pr-10">
              {[...MARQUEE, ...MARQUEE].map((m, i) => (
                <span
                  key={i}
                  className="text-lg font-semibold text-sand hover:text-ember transition-colors whitespace-nowrap select-none"
                >
                  {m}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Perspective floor grid */}
        <div className="grid-floor" />
      </section>

      {/* ── Features ────────────────────────────────────────────────── */}
      <section id="features" className="relative py-24 px-5 sm:px-8 scroll-mt-20">
        <div className="max-w-7xl mx-auto">
          <Reveal className="text-center max-w-2xl mx-auto mb-14">
            <span className="text-[13px] font-mono font-bold uppercase tracking-widest text-ember-soft">
              Features
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-cream mt-2">
              Built for teams who think in parallels
            </h2>
            <p className="text-sand mt-4 leading-relaxed">
              Every feature is designed around one idea: the best answer isn't found —
              it's <em className="text-cream not-italic font-semibold">compared</em> into existence.
            </p>
          </Reveal>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 70}>
                <FeatureCard {...f} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────── */}
      <section id="how-it-works" className="relative py-24 px-5 sm:px-8 scroll-mt-20">
        <div className="max-w-5xl mx-auto">
          <Reveal className="text-center max-w-2xl mx-auto mb-14">
            <span className="text-[13px] font-mono font-bold uppercase tracking-widest text-ember-soft">
              How it works
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-cream mt-2">
              From sign-up to decision in six steps
            </h2>
            <p className="text-sand mt-4 leading-relaxed">
              Every step is built so the right people are in the room: verified
              accounts, invitations each member accepts for themselves, and a
              roster that always shows who is online.
            </p>
          </Reveal>

          <div className="grid md:grid-cols-3 gap-6">
            {STEPS.map((s, i) => (
              <Reveal key={s.title} delay={i * 90}>
                <div className="relative glass border border-line rounded-2xl p-7 h-full hover:border-line-2 transition-colors">
                  <span className="absolute -top-3 left-7 px-2.5 py-0.5 rounded-full bg-ember text-on-ember text-[13px] font-mono font-bold tracking-wider">
                    STEP {i + 1}
                  </span>
                  <div className="w-11 h-11 rounded-xl bg-ember/10 border border-ember/20 flex items-center justify-center text-ember mb-4">
                    <s.icon size={19} />
                  </div>
                  <h3 className="text-base font-semibold text-cream mb-2">{s.title}</h3>
                  <p className="text-sm text-sand leading-relaxed">{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Decision pipeline ──────────────────────────────────────── */}
      <section id="decisions" className="relative py-24 px-5 sm:px-8 scroll-mt-20">
        <div className="max-w-6xl mx-auto">
          <Reveal className="text-center max-w-2xl mx-auto mb-14">
            <span className="text-[13px] font-mono font-bold uppercase tracking-widest text-ember-soft">
              The decision pipeline
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-cream mt-2">
              A compared answer is not a decision
            </h2>
            <p className="text-sand mt-4 leading-relaxed">
              Side-by-side answers settle which model phrased it best. They don't settle what the
              team commits to. Every room carries the pipeline below, so a decision lands only
              when the evidence behind it holds up.
            </p>
          </Reveal>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {PIPELINE.map((p, i) => (
              <Reveal key={p.title} delay={i * 80}>
                <div className="relative glass border border-line rounded-2xl p-7 h-full hover:border-line-2 transition-colors">
                  <span className="absolute -top-3 left-7 px-2.5 py-0.5 rounded-full bg-ember text-on-ember text-[13px] font-mono font-bold tracking-wider">
                    STAGE {i + 1}
                  </span>
                  <div className="w-11 h-11 rounded-xl bg-ember/10 border border-ember/20 flex items-center justify-center text-ember mb-4">
                    <p.icon size={19} />
                  </div>
                  <h3 className="text-base font-semibold text-cream mb-2">{p.title}</h3>
                  <p className="text-sm text-sand leading-relaxed">{p.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>

          {/* Evidence gate callout */}
          <Reveal className="mt-6">
            <div className="border-glow glass-strong rounded-3xl p-8 sm:p-10 flex flex-col md:flex-row items-start gap-6">
              <div className="w-12 h-12 rounded-xl bg-linear-to-br from-ember to-ember-2 text-on-ember flex items-center justify-center shrink-0 shadow-lg shadow-ember/20">
                <Gavel size={22} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-cream mb-2">The evidence gate</h3>
                <p className="text-sand leading-relaxed">
                  A decision refuses to finalize until its claims carry evidence or a human
                  resolution, its contradictions are closed, and every required approver has signed
                  off. AI-generated references never count — a model's say-so is a lead to check,
                  not proof. What closes the gate is the room.
                </p>
                <div className="flex flex-wrap gap-2 mt-5">
                  {['Claims evidenced', 'Contradictions resolved', 'Approvers signed off', 'Then it locks'].map((g) => (
                    <span key={g} className="px-3 py-1 rounded-full text-[13px] font-mono font-semibold bg-panel-2 border border-line text-sand">
                      {g}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Stats band ─────────────────────────────────────────────── */}
      <section className="relative py-20 px-5 sm:px-8">
        <Reveal className="max-w-5xl mx-auto">
          <div className="border-glow glass-strong rounded-3xl p-10 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {STATS.map((s) => (
              <div key={s.label} className="group">
                <s.icon size={18} className="mx-auto text-ember mb-2.5 group-hover:scale-110 transition-transform" />
                <div className="text-3xl sm:text-4xl font-bold brand-gradient-text tracking-tight">
                  {s.value}
                </div>
                <p className="text-[13px] text-faint mt-1.5 font-medium">{s.label}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────── */}
      <section className="relative py-24 px-5 sm:px-8">
        <Reveal className="max-w-3xl mx-auto text-center">
          <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-3xl border border-line bg-panel shadow-md">
            <MindMark size={36} />
          </div>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-cream mt-6">
            Stop guessing which model is best.
            <br />
            <span className="text-ember">See them all answer at once.</span>
          </h2>
          <p className="text-sand mt-5 leading-relaxed max-w-xl mx-auto">
            Spin up a workspace, invite your team, and broadcast your first prompt to every
            model in under a minute.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
            {isLoggedIn ? (
              <button
                type="button"
                onClick={() => navigateTo(dashboardPath)}
                className="px-7 py-3.5 bg-ember hover:bg-ember-2 text-on-ember font-semibold rounded-xl transition-colors shadow-lg shadow-ember/25 cursor-pointer flex items-center gap-2 btn-3d"
              >
                Go to {dashboardLabel}
                <ArrowRight size={15} />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={goToRegister}
                  className="px-7 py-3.5 bg-ember hover:bg-ember-2 text-on-ember font-semibold rounded-xl transition-colors shadow-lg shadow-ember/25 cursor-pointer flex items-center gap-2 btn-3d"
                >
                  Create your workspace
                  <ArrowRight size={15} />
                </button>
                <button
                  type="button"
                  onClick={goToLogin}
                  className="px-7 py-3.5 glass border border-line-2 text-cream font-semibold rounded-xl hover:border-ember/40 transition-colors cursor-pointer"
                >
                  I already have an account
                </button>
              </>
            )}
          </div>
        </Reveal>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="relative border-t border-line py-10 px-5 sm:px-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-2.5 select-none">
            <MindMark size={24} />
            <span className="font-bold text-cream tracking-tight">
              Mind<span className="text-ember">Sync</span>
            </span>
            <span className="text-[13px] font-mono text-faint ml-2">BUILD {BRAND.version}-STABLE</span>
          </div>
          <p className="text-[13px] text-faint text-center sm:text-right">
            {BRAND.tagline}. Secured via JWT &amp; bcrypt.
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ── Data ────────────────────────────────────────────────────────────── */

const MARQUEE = [
  'Gemini 2.5 Flash', 'GPT-OSS 120B', 'Qwen3.8 27B', 'Parallel streaming',
  'Side-by-side diff', 'Live presence', 'Pinned insights', 'Audit logs',
  'Verified access', 'Invite to join', 'Contradiction detection',
  'Evidence gate', 'Decision records',
];

const FEATURES = [
  {
    icon: Layers,
    title: 'Parallel model streaming',
    desc: 'One prompt broadcasts to every selected model simultaneously — answers stream back in lockstep, not in sequence.',
  },
  {
    icon: Columns3,
    title: 'Side-by-side comparison',
    desc: 'Responses render in aligned columns with per-model timing, so the strongest answer is obvious at a glance.',
  },
  {
    icon: Users,
    title: 'Real-time co-editing',
    desc: 'Shared prompt drafts with live cursors, and a roster that lists every member with their status — online, offline, or mid-action — so you always know who is in the room.',
  },
  {
    icon: BookmarkCheck,
    title: 'Pinned insights',
    desc: 'Bookmark the winning output to a workspace library. Every pin keeps its prompt, model, and author attached.',
  },
  {
    icon: Quote,
    title: 'Claims the room remembers',
    desc: 'Every quotable assertion a model makes is mined into a durable claim, so the next prompt builds on what the room already established instead of starting from scratch.',
  },
  {
    icon: Scale,
    title: 'Contradictions, caught',
    desc: 'When two models disagree, the detector flags the pair with its confidence and an explanation. The AI detects contradictions — it never decides which claim is true; an authorized human does.',
  },
  {
    icon: Gavel,
    title: 'Decisions behind an evidence gate',
    desc: 'A decision finalizes only once its claims carry evidence, its contradictions are resolved, and every approver has signed off. Then it locks — with its full history and a replay of how it got there.',
  },
  {
    icon: LineChart,
    title: 'Enterprise analytics',
    desc: 'Usage, growth, and model-mix telemetry out of the box — plus audit logs for every workspace action.',
  },
  {
    icon: ShieldCheck,
    title: 'Hardened by default',
    desc: 'Dual-token JWT rotation, httpOnly refresh cookies, and role-based admin boundaries on every route.',
  },
  {
    icon: MailCheck,
    title: 'Invitations you choose to accept',
    desc: 'Invite teammates by email and they decide — accept or reject from their own workspace hub. Nobody lands in a room without saying yes, and a room you have declined five times stops asking.',
  },
  {
    icon: LogOut,
    title: 'Leave anytime',
    desc: 'Step out of a workspace whenever you like. Owners hand the room to a teammate first, so a project never loses its lead — and a sole owner is asked to delete instead.',
  },
  {
    icon: BadgeCheck,
    title: 'Verified, then admitted',
    desc: 'Every account confirms its email before touching a workspace, so the people in your rooms are the people behind the addresses you invited.',
  },
];

const STEPS = [
  {
    icon: BadgeCheck,
    title: 'Verify your account',
    desc: 'Sign up and confirm your email — verification is the door to every workspace, so a room only ever admits the person behind the address.',
  },
  {
    icon: MailCheck,
    title: 'Invite your team',
    desc: 'Bring teammates in by email. They accept or reject from their own workspace hub, and a room you have declined five times stops asking.',
  },
  {
    icon: MessageSquare,
    title: 'Prompt once',
    desc: 'Draft the prompt together with live cursors, toggle the models you want to query, and broadcast it to all of them at once.',
  },
  {
    icon: Zap,
    title: 'Compare live',
    desc: 'Watch each model stream its answer in its own column with token-by-token updates and live latency stats.',
  },
  {
    icon: CheckCircle2,
    title: 'Pin the best',
    desc: 'Save the winning response to the workspace library — every pin keeps its prompt, model, and author attached.',
  },
  {
    icon: LogOut,
    title: 'Leave anytime',
    desc: 'Step out of a workspace whenever you like. Owners hand the room to a teammate first, so a project never loses its lead.',
  },
];

const PIPELINE = [
  {
    icon: Quote,
    title: 'Claims become memory',
    desc: 'Every quotable assertion a model makes is mined into a durable claim, so the next prompt is grounded in what the room has already established instead of starting from scratch.',
  },
  {
    icon: Scale,
    title: 'Contradictions surface',
    desc: 'When two models cannot both be right, the detector flags the pair with its confidence and an explanation — then a human adjudicates, with a recorded reason and optional cited evidence.',
  },
  {
    icon: Paperclip,
    title: 'Evidence is pinned',
    desc: 'Members back a claim with a link, a verbatim quote, a file, or a note of their own. Only human-attached evidence satisfies the gate; an AI reference is a lead to check, not proof.',
  },
  {
    icon: Gavel,
    title: 'The room decides',
    desc: 'Draft the commitment, link the claims, name the approvers. Once the gate is satisfied the decision locks — with its whole history intact and a replay of how it got there.',
  },
];

const STATS = [
  { value: '3+', label: 'models per prompt', icon: Layers },
  { value: '<1s', label: 'to first token', icon: Zap },
  { value: '0', label: 'decisions without evidence', icon: Gavel },
  { value: '100%', label: 'actions audited', icon: ShieldCheck },
];

/* ── Sub-components ──────────────────────────────────────────────────── */

/** Faux product window: the comparison view, rendered in 3D with parallax chips. */
function HeroMock() {
  return (
    <div className="parallax relative" style={{ ['--depth' as string]: '26px' }}>
      {/* Glow behind window */}
      <div
        className="absolute -inset-6 rounded-4xl blur-3xl opacity-40"
        style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--color-ember) 40%, transparent), transparent 70%)' }}
      />

      <div className="tilt-card perspective-far relative rounded-2xl overflow-hidden border border-line-2 glass-strong shadow-2xl">
        {/* Window chrome */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-line bg-panel-2/60">
          <span className="w-2.5 h-2.5 rounded-full bg-rust/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-ember-soft/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-leaf/70" />
          <div className="ml-3 flex items-center gap-1.5 text-[13px] font-mono text-faint bg-panel border border-line rounded-md px-2.5 py-1">
            <Hash size={9} />
            mindsync.dev / general
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-leaf animate-pulse" />
            <span className="text-[13px] font-mono text-sand">4 ONLINE</span>
          </div>
        </div>

        {/* Presence strip */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-line bg-panel/40">
          <div className="flex -space-x-1.5">
                {['S', 'M', 'J'].map((l, i) => (
              <span
                key={l}
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-bold border border-panel ${
                  i === 0 ? 'bg-ember text-on-ember' : 'bg-panel-2 text-sand'
                }`}
              >
                {l}
              </span>
            ))}
          </div>
          <span className="text-[13px] font-mono text-faint">
            <span className="text-ember font-semibold">Sarah</span> is drafting the prompt…
          </span>
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-leaf animate-pulse" />
        </div>

        {/* Prompt bubble */}
        <div className="px-5 pt-5 pb-3">
          <div className="max-w-[80%] ml-auto bg-ember/10 border border-ember/25 rounded-2xl rounded-tr-sm px-3.5 py-2.5">
            <p className="text-[14px] text-cream font-medium leading-relaxed">
              Design a resilient retry policy for a payment gateway. Consider idempotency, backoff, and partial outages.
            </p>
          </div>
        </div>

        {/* Comparison columns */}
        <div className="grid grid-cols-3 gap-3 px-5 pb-5">
          {MOCK_MODELS.map((m, i) => (
            <div
              key={m.name}
              className={`relative bg-panel border border-line rounded-xl overflow-hidden ${
                m.winner ? 'winner-glow border-ember/40' : ''
              }`}
              style={{ transform: `translateZ(${i === 1 ? 26 : 0}px)` }}
            >
              {m.winner && (
                <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-ember text-on-ember text-[12px] font-mono font-bold tracking-wider shadow-lg">
                  <BookmarkCheck size={8} />
                  PINNED
                </div>
              )}

              <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-line bg-panel-2/50">
                <span className={`w-1.5 h-1.5 rounded-full ${m.dot} shrink-0`} />
                <span className="text-[13px] font-mono font-semibold text-cream truncate">{m.name}</span>
              </div>

              {/* Streaming answer lines */}
              <div className="p-2.5 space-y-1.5 min-h-22">
                {m.lines.map((w, j) => (
                  <div
                    key={j}
                    className={`stream-line h-1.5 rounded-full ${m.live && j === m.lines.length - 1 ? 'animate-pulse' : ''}`}
                    style={{
                      width: `${w}%`,
                      ['--d' as string]: `${350 + i * 260 + j * 190}ms`,
                      background: m.winner
                        ? 'color-mix(in srgb, var(--color-ember) 55%, transparent)'
                        : 'color-mix(in srgb, var(--color-sand) 38%, transparent)',
                    }}
                  />
                ))}
                {m.live && (
                  <span className="inline-block w-1 h-1.5 bg-ember rounded-full animate-pulse align-middle" />
                )}
              </div>

              {/* Quality meter */}
              <div className="px-2.5 pb-2.5 pt-1 border-t border-line/60">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12px] font-mono uppercase tracking-wider text-faint">quality</span>
                  <span className={`text-[12px] font-mono font-bold ${m.statusCls}`}>{m.status}</span>
                </div>
                <div className="h-1 rounded-full bg-panel-2 overflow-hidden">
                  <div
                    className="h-full rounded-full stream-line"
                    style={{
                      width: `${m.quality}%`,
                      ['--d' as string]: `${1200 + i * 300}ms`,
                      background: m.winner
                        ? 'var(--brand-gradient)'
                        : 'color-mix(in srgb, var(--color-faint) 55%, transparent)',
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Fake input bar */}
        <div className="px-5 pb-5">
          <div className="flex items-center gap-2 bg-panel-2 border border-line rounded-xl px-3 py-2">
            <Cpu size={12} className="text-ember shrink-0" />
            <div className="h-1.5 skel-line flex-1" />
            <span className="text-[13px] font-mono font-bold text-ember-soft">COMPARE</span>
          </div>
        </div>
      </div>

      {/* Floating chips */}
      <FloatingChip
        className="hidden sm:flex -top-5 -left-6"
        depth={-30}
        delay="0s"
        dot="bg-leaf"
        label="412ms"
        value="first token"
      />
      <FloatingChip
        className="hidden sm:flex -bottom-6 -right-5"
        depth={36}
        delay="-2s"
        dot="bg-ember"
        label="3 models"
        value="compared at once"
      />

      {/* Live collaborator cursor */}
      <div
        className="parallax hidden md:block absolute top-[34%] -right-7 z-20"
        style={{ ['--depth' as string]: '44px' }}
      >
        <div className="animate-float" style={{ animationDelay: '-1.2s' }}>
          <svg width="14" height="16" viewBox="0 0 14 16" fill="none" className="drop-shadow-lg">
            <path d="M1 1L13 7.5L7.2 9.2L5 15L1 1Z" fill="var(--color-ember)" />
          </svg>
          <span className="ml-1.5 -mt-1 inline-block px-1.5 py-0.5 rounded-md bg-ember text-on-ember text-[12px] font-mono font-bold shadow-lg">
            Sarah
          </span>
        </div>
      </div>
    </div>
  );
}

const MOCK_MODELS = [
  {
    name: 'Gemini 2.5 Flash', dot: 'bg-ember', status: '412ms', statusCls: 'text-ember',
    lines: [94, 70, 86, 58], quality: 78, live: false,
  },
  {
    name: 'GPT-OSS 120B', dot: 'bg-leaf', status: 'BEST', statusCls: 'text-leaf',
    lines: [88, 96, 74, 82, 64], quality: 94, live: false, winner: true,
  },
  {
    name: 'Qwen3.8 27B', dot: 'bg-rust animate-pulse', status: 'LIVE', statusCls: 'text-rust',
    lines: [80, 66, 54], quality: 41, live: true,
  },
];

function FloatingChip({
  className, depth, delay, dot, label, value,
}: {
  className?: string; depth: number; delay: string; dot: string; label: string; value: string;
}) {
  return (
    <div
      className={`parallax absolute z-10 ${className}`}
      style={{ ['--depth' as string]: `${depth}px` }}
    >
      <div
        className="animate-float glass rounded-2xl px-4 py-3 shadow-xl flex items-center gap-3"
        style={{ animationDelay: delay }}
      >
        <span className={`w-2 h-2 rounded-full ${dot} shrink-0`} />
        <div className="leading-tight">
          <p className="text-[14px] font-semibold text-cream font-mono whitespace-nowrap">{label}</p>
          <p className="text-[13px] text-faint whitespace-nowrap">{value}</p>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  icon: Icon, title, desc,
}: {
  icon: React.ElementType; title: string; desc: string;
}) {
  return (
    <div className="border-glow-hover tilt-card group h-full glass border border-line rounded-2xl p-7 hover:border-line-2 transition-colors">
      <div className="relative w-12 h-12 rounded-xl flex items-center justify-center text-cream mb-5 group-hover:scale-110 transition-transform overflow-hidden">
        <div className="absolute inset-0 opacity-25 group-hover:opacity-45 transition-opacity" style={{ background: 'var(--brand-gradient)' }} />
        <div className="absolute inset-0 border border-ember/25 rounded-xl" />
        <Icon size={20} className="relative z-10 drop-shadow" />
      </div>
      <h3 className="text-base font-semibold text-cream mb-2.5">{title}</h3>
      <p className="text-sm text-sand leading-relaxed">{desc}</p>
      <ChevronRight
        size={15}
        className="text-faint mt-4 group-hover:text-ember group-hover:translate-x-1 transition-all"
      />
    </div>
  );
}

/** Fade-and-rise wrapper triggered when the element scrolls into view. */
function Reveal({
  children, delay = 0, className = '',
}: {
  children: React.ReactNode; delay?: number; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -60px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? 'is-visible' : ''} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}
