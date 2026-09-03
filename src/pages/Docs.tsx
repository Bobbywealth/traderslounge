/**
 * ConfluenceX knowledge base — replaces the generic Education placeholder.
 * In-app documentation so paid users have one place to look up scoring,
 * lifecycle states, broker setup, alerts, and Trading Memory semantics.
 *
 * Sidebar navigation is left-anchored so long pages stay scannable.
 * Sections render inline (no external docs site) so search engines and
 * signed-out visitors can also discover the canonical wording.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronRight, Search, ShieldCheck, Workflow, Zap, Bell, Brain, BarChart3, History } from 'lucide-react';

type Section = {
  id: string;
  title: string;
  icon: React.ReactNode;
  summary: string;
  render: () => React.ReactNode;
};

const SECTIONS: Section[] = [
  {
    id: 'quick-start',
    title: 'Quick start',
    icon: <Zap className="h-4 w-4" />,
    summary: 'Three minutes from signup to your first guarded signal.',
    render: () => (
      <div className="prose prose-invert max-w-none text-sm leading-relaxed cx-text-muted">
        <ol className="list-decimal space-y-2 pl-5">
          <li>Finish the <b>onboarding wizard</b> on the Command Center to pick your asset classes and sessions.</li>
          <li>Open <code>/alerts</code> and connect Telegram if you want push delivery (optional).</li>
          <li>Watch <code>/scanner</code> for the first VALID/STRONG setup. The Signal feed at <code>/signals</code> shows the same guarded, trade-call stream.</li>
          <li>Any setup you take should be logged in <code>/journal</code> with the post-trade note field — that's what feeds the Calibration dashboard.</li>
        </ol>
        <p className="mt-4 text-xs cx-text-faint">Demo accounts see sample data only. Live signals require Pro or Founding Member.</p>
      </div>
    ),
  },
  {
    id: 'broker',
    title: 'Broker setup (TradeLocker)',
    icon: <ShieldCheck className="h-4 w-4" />,
    summary: 'Connect a demo or live TradeLocker account, test the credentials, and decide whether execution stays paper or live.',
    render: () => (
      <div className="prose prose-invert max-w-none text-sm leading-relaxed cx-text-muted">
        <h3 className="text-base font-black cx-text-strong">Demo</h3>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Settings → Broker → "Use demo server".</li>
          <li>Paste your TradeLocker demo email and password. Click <b>Test connection</b> — this calls <code>/api/tradelocker/auth</code> without committing the credentials to localStorage.</li>
          <li>If the test is green, click <b>Save</b>. The credentials are persisted in your user vault.</li>
        </ol>
        <h3 className="mt-6 text-base font-black cx-text-strong">Live</h3>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Settings → Broker → "Use live server". Same flow as demo.</li>
          <li>Live execution is read-only by default. To enable order placement, the backend must be deployed with <code>EXECUTION_MODE=live</code>, <code>ADMIN_EMAILS</code> set, and the kill-switch route verified by an admin.</li>
        </ol>
        <p className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">
          <b>Safety contract:</b> before any order can be placed through ConfluenceX the broker reconciliation, idempotency, portfolio risk limits, and the independently verified kill switch must all be in place. See <a className="underline" href="/risk-disclaimer">Risk Disclaimer</a>.
        </p>
      </div>
    ),
  },
  {
    id: 'alerts',
    title: 'Alerts & Telegram',
    icon: <Bell className="h-4 w-4" />,
    summary: 'Selective XAUUSD alert pipeline, delivery channels, briefing cadence.',
    render: () => (
      <div className="prose prose-invert max-w-none text-sm leading-relaxed cx-text-muted">
        <p>ConfluenceX publishes <b>guarded</b> alerts only. Each candidate alert must clear every gate below before it is dispatched:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Score ≥ 65 (configurable per-user, floor is 65 server-side).</li>
          <li>Realized R ≥ 1.5 from entry to nearest target.</li>
          <li>Calendar gate is <code>CLEAR</code> (BLOCKED / POST_NEWS suppresses new-trade alerts).</li>
          <li>Cached reference price within $5 of the live spot cross-check.</li>
          <li>60-minute cooldown per (pair, direction).</li>
        </ul>
        <h3 className="mt-6 text-base font-black cx-text-strong">Delivery channels</h3>
        <ul className="list-disc space-y-2 pl-5">
          <li><b>Telegram:</b> link a chat via <code>/alerts</code> → Connect Telegram. Compact card, ~7 lines, drop TP3 + TF header (XAUUSD template).</li>
          <li><b>Browser push:</b> opt in from the Alerts page. Subscription persists across logins.</li>
          <li><b>In-app feed:</b> the activity stream on <code>/alerts</code> shows every dispatch regardless of channel.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'scoring',
    title: 'V2 scoring methodology',
    icon: <BarChart3 className="h-4 w-4" />,
    summary: 'How the canonical V2 total score is built, what the category breakdown means, and when the score is trustworthy.',
    render: () => (
      <div className="prose prose-invert max-w-none text-sm leading-relaxed cx-text-muted">
        <p>The V2 total score is a 0–100 weighted sum across five categories:</p>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[10px] uppercase tracking-wider cx-text-faint"><th>Category</th><th>Cap</th><th>What it measures</th></tr></thead>
          <tbody>
            <tr><td>Structure</td><td>20</td><td>Swing placement, BOS/CHoCH confirmation, HTF alignment.</td></tr>
            <tr><td>Volume</td><td>10</td><td>Relative volume vs the same session, not the raw count.</td></tr>
            <tr><td>Momentum</td><td>10</td><td>EMA period-5 slope + directional strength at the selected timeframe.</td></tr>
            <tr><td>Liquidity</td><td>15</td><td>Nearby equal-highs / equal-lows and untested zones.</td></tr>
            <tr><td>Confluence</td><td>45</td><td>Harmonic completion, ADR position, MTF alignment score.</td></tr>
          </tbody>
        </table>
        <p className="mt-4">Scores are only trustworthy when:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>The selected timeframe has a fresh closed bar (see <code>data_quality.reference_price_time</code>).</li>
          <li>The calendar gate is <code>CLEAR</code> — BLOCKED / POST_NEWS scores are deliberately lower-confidence.</li>
          <li>The lifecycle state is <code>CONFIRMED</code>. <code>FORMING</code> scores should be treated as setup-prep, not entries.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'lifecycle',
    title: 'Lifecycle states',
    icon: <Workflow className="h-4 w-4" />,
    summary: 'Why direction flips are slow on purpose, and what WAIT / WEAKENING mean.',
    render: () => (
      <div className="prose prose-invert max-w-none text-sm leading-relaxed cx-text-muted">
        <p>Direction is not a single number — it is a small state machine:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li><b>FORMING</b> — the engine has a lean but has not seen two consecutive completed candles agree.</li>
          <li><b>CONFIRMED</b> — closed-candle confirmation passed, hysteresis margin cleared, cooldown satisfied, or structural reversal confirmed.</li>
          <li><b>WEAKENING</b> — a confirmed direction is being challenged; one or more gates have flipped against it.</li>
          <li><b>INVALIDATED</b> — structural reversal plus the reversal margin; the prior thesis is dead.</li>
          <li><b>BLOCKED_BY_NEWS / BLOCKED_BY_DATA / BLOCKED_BY_RISK</b> — calendar or portfolio gate is preventing the engine from publishing.</li>
        </ul>
        <p className="mt-4">The visible <code>direction</code> only flips after <code>required_closes</code> (default 2) consecutive completed candles agree, the <code>reversal_margin</code> is cleared, and the <code>cooldown_bars</code> cooldown has elapsed. That is why minute-scale noise never produces a flip.</p>
      </div>
    ),
  },
  {
    id: 'memory',
    title: 'Trading Memory',
    icon: <Brain className="h-4 w-4" />,
    summary: 'Persistent institutional-style insights, auto-derivation, manual annotation.',
    render: () => (
      <div className="prose prose-invert max-w-none text-sm leading-relaxed cx-text-muted">
        <p>Trading Memory is a per-user store of long-lived insights that survive across sessions. The engine auto-derives two kinds:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li><b>Zone rejection</b> — when price revisits the same zone three or more times and gets pushed back, an insight is recorded with the zone range and the count.</li>
          <li><b>News impact</b> — after four or more events with &gt; 1.2% intraday impact, an insight records the pair and timeframe so future setups know to be more conservative.</li>
        </ul>
        <p className="mt-4">The Why-This-Trade panel on the Command Center retrieves memory entries for the current setup so you can see how the engine has been wrong (or right) on similar structure before.</p>
      </div>
    ),
  },
  {
    id: 'calibration',
    title: 'Calibration & walk-forward',
    icon: <History className="h-4 w-4" />,
    summary: 'How outcome evidence is collected without look-ahead, and how to read the reliability curve.',
    render: () => (
      <div className="prose prose-invert max-w-none text-sm leading-relaxed cx-text-muted">
        <p>Outcomes are resolved bar-by-bar using an expanding window so the engine never trains on data it would have seen in production:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Each closed-trade stores <code>opened_at</code>, <code>closed_at</code>, <code>pnl_usd</code>, <code>r_multiple</code>, and the originating <code>source</code> (backtested / forward_tested / user_journal / paper_traded).</li>
          <li><code>/backtester</code> shows the calibration status: <code>CALIBRATED</code> means the reliability curve is within 5pp per decile, <code>UNSTABLE</code> otherwise.</li>
          <li><code>/calibration</code> shows the per-bucket predicted-vs-observed gap. Buckets with low sample size are intentionally empty.</li>
        </ul>
        <p className="mt-4">Scenario weights in the engine are only updated after the evidence passes the calibration gate — never on raw score output.</p>
      </div>
    ),
  },
];

const Docs: React.FC = () => {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter((s) =>
      s.title.toLowerCase().includes(q) || s.summary.toLowerCase().includes(q),
    );
  }, [search]);

  // Track which section the user is reading via IntersectionObserver so the
  // sidebar highlight follows the scroll without us forcing a hash jump.
  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => (a.target.getBoundingClientRect().top - b.target.getBoundingClientRect().top))[0];
        if (visible) setActiveId(visible.target.id);
      },
      { rootMargin: '-30% 0px -60% 0px', threshold: 0 },
    );
    SECTIONS.forEach((s) => {
      const node = document.getElementById(s.id);
      if (node) observer.observe(node);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="space-y-6 pb-10 cx-text" data-testid="docs-page">
      <section className="relative overflow-hidden rounded-[28px] border cx-border bg-[#080d1a] p-6 shadow-2xl shadow-black/20 sm:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(34,211,238,0.10),transparent_28%),radial-gradient(circle_at_85%_20%,rgba(139,92,246,0.13),transparent_32%)]" />
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/[0.07] px-3 py-1 text-[10px] font-black tracking-[0.2em] text-cyan-300">
              <BookOpen className="h-3 w-3" /> KNOWLEDGE BASE
            </div>
            <h1 className="text-3xl font-black tracking-[-0.04em] cx-text-strong sm:text-4xl">
              ConfluenceX documentation
            </h1>
            <p className="mt-2 max-w-2xl text-sm cx-text-muted">
              Scoring methodology, lifecycle states, broker setup, alerts, Trading Memory, and how the
              Calibration dashboard actually grades the engine.
            </p>
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 cx-text-faint" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search docs"
              className="w-full rounded-xl border cx-border cx-bg-card py-2 pl-9 pr-3 text-sm cx-text-muted focus:border-cyan-400/40 focus:outline-none"
              data-testid="docs-search"
            />
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <nav className="space-y-1" aria-label="Documentation">
            {filtered.map((section) => {
              const active = section.id === activeId;
              return (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm transition ${
                    active
                      ? 'border-cyan-400/40 bg-cyan-400/10 cx-text-strong'
                      : 'border-transparent cx-text-muted hover:border-white/[0.06] hover:bg-white/[0.02]'
                  }`}
                  data-testid={`docs-nav-${section.id}`}
                >
                  <span className="flex items-center gap-2">
                    {section.icon}
                    {section.title}
                  </span>
                  <ChevronRight className={`h-3 w-3 transition ${active ? 'text-cyan-300' : 'cx-text-faint'}`} />
                </a>
              );
            })}
            {filtered.length === 0 && (
              <div className="rounded-xl border cx-border cx-bg-card p-3 text-xs cx-text-faint">
                No sections match "{search}".
              </div>
            )}
          </nav>
        </aside>

        <div className="space-y-6">
          {filtered.map((section) => (
            <article
              key={section.id}
              id={section.id}
              className="scroll-mt-6 rounded-3xl border cx-border cx-bg-card p-6"
            >
              <header className="mb-4 flex items-start gap-3">
                <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-400/10 text-cyan-300">
                  {section.icon}
                </div>
                <div>
                  <h2 className="text-xl font-black cx-text-strong">{section.title}</h2>
                  <p className="mt-1 text-sm cx-text-muted">{section.summary}</p>
                </div>
              </header>
              {section.render()}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Docs;
