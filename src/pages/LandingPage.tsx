import React, { useEffect, useState } from 'react';
import {
  Activity, ArrowRight, BookOpen, Check, ChevronRight,
  Crosshair, Gauge, Layers3, Menu, Play, Radar, ShieldCheck,
  Sparkles, Users, X
} from 'lucide-react';
import AuthModal from '../components/AuthModal';
import ConfluenceXLogo from '../components/ConfluenceXLogo';
import PricingSection from '../components/PricingSection';

const signals = [
  { pair: 'EURUSD', tf: '15m', side: 'LONG', score: 92, price: '1.0821' },
  { pair: 'XAUUSD', tf: '1h', side: 'LONG', score: 87, price: '2,341.50' },
  { pair: 'GBPUSD', tf: '4h', side: 'SHORT', score: 81, price: '1.2654' },
];

const features = [
  { icon: Radar, eyebrow: 'LIVE SCANNER', title: 'Find the setup before the crowd.', description: 'Continuously scan liquid markets for high-confluence opportunities across structure, momentum, volatility, and trend.', accent: 'cyan' },
  { icon: Crosshair, eyebrow: 'HARMONICS', title: 'See XABCD patterns drawn live.', description: 'Automatic harmonic detection maps the active geometry, completion point, and compact potential reversal zone directly on your chart.', accent: 'violet' },
  { icon: Gauge, eyebrow: 'ADR ENGINE', title: 'Know how much range is left.', description: 'Live ADR context shows today’s range usage, projected high and low, and where price sits inside the expected daily move.', accent: 'fuchsia' },
  { icon: Layers3, eyebrow: 'CONFLUENCE SCORE', title: 'One score. Every critical factor.', description: 'Turn scattered technical evidence into a clear, repeatable framework that helps you prioritize the strongest setups.', accent: 'cyan' },
  { icon: BookOpen, eyebrow: 'JOURNAL', title: 'Turn execution into an edge.', description: 'Review decisions, patterns, and outcomes in one workflow designed to expose what actually improves your trading.', accent: 'violet' },
  { icon: ShieldCheck, eyebrow: 'RISK FIRST', title: 'Trade the plan, not the feeling.', description: 'Structure every idea around invalidation, risk, and confirmation before execution enters the conversation.', accent: 'fuchsia' },
];

const ticker = ['EURUSD  1.0821  +0.02%', 'XAUUSD  2,341.50  +0.15%', 'GBPUSD  1.2654  -0.01%', 'ADR USED  45%', 'LIVE SCANNER  ONLINE'];

const LandingPage: React.FC = () => {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('signup');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setMobileMenuOpen(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [mobileMenuOpen]);

  const openAuth = (mode: 'login' | 'signup') => {
    setAuthMode(mode);
    setShowAuthModal(true);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#05070d] text-white selection:bg-violet-500/40">
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_15%_5%,rgba(34,211,238,0.10),transparent_24%),radial-gradient(circle_at_85%_10%,rgba(139,92,246,0.13),transparent_28%)]" />

      <nav className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.07] bg-[#05070d]/75 backdrop-blur-2xl">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 lg:px-8">
          <a href="#top" aria-label="ConfluenceX home"><ConfluenceXLogo size="md" /></a>
          <div className="hidden items-center gap-8 text-sm font-medium text-slate-400 md:flex">
            <a href="#platform" className="transition hover:text-cyan-300">Platform</a>
            <a href="#workflow" className="transition hover:text-cyan-300">Workflow</a>
            <a href="#pricing" className="transition hover:text-cyan-300">Pricing</a>
            <a href="#community" className="transition hover:text-cyan-300">Community</a>
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <button onClick={() => openAuth('login')} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/[0.06] hover:text-white">Sign in</button>
            <button onClick={() => openAuth('signup')} className="group rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 p-px shadow-[0_0_28px_rgba(34,211,238,0.16)]">
              <span className="flex items-center gap-2 rounded-[11px] bg-[#0a0e1a] px-5 py-2.5 text-sm font-bold transition group-hover:bg-transparent">Get started <ArrowRight className="h-4 w-4" /></span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-white/10 p-2.5 md:hidden"
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav-drawer"
          >
            {mobileMenuOpen ? <X /> : <Menu />}
          </button>
        </div>
        {mobileMenuOpen && (
          <div
            id="mobile-nav-drawer"
            role="dialog"
            aria-label="Mobile navigation"
            className="border-t border-white/10 bg-[#080b14] px-5 py-5 md:hidden"
          >
            <div className="flex flex-col gap-2 text-slate-300">
              <a href="#features" onClick={() => setMobileMenuOpen(false)} className="flex min-h-[44px] items-center rounded-lg px-3 capitalize hover:bg-white/5">Features</a>
              <a href="#pricing" onClick={() => setMobileMenuOpen(false)} className="flex min-h-[44px] items-center rounded-lg px-3 capitalize hover:bg-white/5">Pricing</a>
              <a href="#testimonials" onClick={() => setMobileMenuOpen(false)} className="flex min-h-[44px] items-center rounded-lg px-3 capitalize hover:bg-white/5">Reviews</a>
              <button onClick={() => openAuth('login')} className="flex min-h-[44px] items-center rounded-xl border border-white/10 px-3">Sign in</button>
            </div>
          </div>
        )}
      </nav>

      <main className="relative z-10">
        <section id="top" className="relative px-5 pb-20 pt-36 lg:pb-28 lg:pt-44">
          <div className="absolute left-[10%] top-32 h-72 w-72 animate-pulse rounded-full bg-cyan-500/[0.07] blur-[100px]" />
          <div className="absolute right-[8%] top-48 h-96 w-96 animate-pulse rounded-full bg-violet-600/[0.09] blur-[120px] [animation-delay:1s]" />
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto max-w-4xl text-center">
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/[0.07] px-4 py-2 text-xs font-bold tracking-[0.16em] text-cyan-300">
                <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-300" /></span>
                LIVE MARKET INTELLIGENCE
              </div>
              <h1 className="text-balance text-5xl font-black leading-[0.96] tracking-[-0.055em] sm:text-7xl lg:text-[92px]">
                Stop chasing.<br /><span className="bg-gradient-to-r from-cyan-300 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">Start confirming.</span>
              </h1>
              <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-slate-400 sm:text-xl">ConfluenceX turns live price action, harmonic structure, ADR, and multi-factor signals into one decisive trading workspace.</p>
              <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <button onClick={() => openAuth('signup')} className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 via-cyan-500 to-violet-500 px-7 py-4 font-black text-[#05070d] shadow-[0_0_40px_rgba(34,211,238,0.22)] transition hover:-translate-y-1 hover:shadow-[0_0_60px_rgba(139,92,246,0.3)] sm:w-auto">Open Live Workspace <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" /></button>
                <div className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-7 py-4 font-semibold text-slate-500 backdrop-blur sm:w-auto">
                  <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-50" /><span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" /></span>
                  Forward-testing in progress
                </div>
              </div>
            </div>

            <div className="relative mx-auto mt-16 max-w-6xl [perspective:1600px]">
              <div className="absolute -inset-8 rounded-[40px] bg-gradient-to-r from-cyan-500/15 via-violet-500/10 to-fuchsia-500/15 blur-3xl" />
              <div className="relative overflow-hidden rounded-[24px] border border-white/15 bg-[#090d18]/95 shadow-2xl shadow-black/60 lg:[transform:rotateX(2deg)]">
                <div className="flex h-12 items-center justify-between border-b border-white/[0.08] px-4">
                  <div className="flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" /><span className="h-2.5 w-2.5 rounded-full bg-amber-300/70" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" /></div>
                  <div className="rounded-md border border-white/[0.08] bg-white/[0.03] px-4 py-1 text-[10px] font-semibold tracking-widest text-slate-500">CONFLUENCEX / LIVE WORKSPACE</div>
                  <div className="flex items-center gap-2 text-[10px] text-cyan-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" /> STREAMING</div>
                </div>
                <div className="grid min-h-[430px] lg:grid-cols-[1fr_280px]">
                  <div className="relative overflow-hidden border-b border-white/[0.08] p-5 lg:border-b-0 lg:border-r">
                    <div className="mb-5 flex items-center justify-between"><div><div className="text-sm font-black">EURUSD <span className="ml-2 text-xs font-medium text-slate-500">15m</span></div><div className="mt-1 text-2xl font-black text-cyan-300">1.0821 <span className="text-xs text-emerald-400">+0.02%</span></div></div><div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs text-cyan-300">ADR 45% used</div></div>
                    <div className="relative h-72 overflow-hidden rounded-xl border border-white/[0.06] bg-[#060912] chart-grid">
                      <svg viewBox="0 0 800 280" className="h-full w-full" preserveAspectRatio="none" aria-label="Animated market chart">
                        <defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#22d3ee" stopOpacity=".22"/><stop offset="1" stopColor="#22d3ee" stopOpacity="0"/></linearGradient><linearGradient id="chartLine" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#22d3ee"/><stop offset=".55" stopColor="#8b5cf6"/><stop offset="1" stopColor="#d946ef"/></linearGradient></defs>
                        <path d="M0 230 C45 225 55 198 92 204 S145 180 180 187 S229 142 266 151 S316 110 354 124 S400 64 446 86 S492 148 532 119 S570 165 610 112 S664 54 704 76 S754 34 800 47 L800 280 L0 280 Z" fill="url(#chartFill)" />
                        <path className="chart-path" d="M0 230 C45 225 55 198 92 204 S145 180 180 187 S229 142 266 151 S316 110 354 124 S400 64 446 86 S492 148 532 119 S570 165 610 112 S664 54 704 76 S754 34 800 47" fill="none" stroke="url(#chartLine)" strokeWidth="3" />
                        <path d="M266 151 L354 124 L446 86 L532 119 L610 112" fill="rgba(139,92,246,.10)" stroke="#a78bfa" strokeWidth="1.5" strokeDasharray="5 5" />
                        {[[266,151,'X'],[354,124,'A'],[446,86,'B'],[532,119,'C'],[610,112,'D']].map(([x,y,label]) => <g key={String(label)}><circle cx={Number(x)} cy={Number(y)} r="5" fill="#070a12" stroke="#e9d5ff" strokeWidth="2"/><text x={Number(x)} y={Number(y)-12} fill="#e9d5ff" fontSize="12" textAnchor="middle">{label}</text></g>)}
                      </svg>
                      <div className="absolute bottom-3 left-3 rounded-lg border border-violet-400/20 bg-violet-500/10 px-3 py-2 text-[10px] font-bold text-violet-200">BULLISH BAT · PRZ CONFIRMED</div>
                    </div>
                  </div>
                  <div className="p-4"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-black tracking-widest text-slate-500">LIVE SIGNALS</span><Activity className="h-4 w-4 text-cyan-300" /></div><div className="space-y-3">{signals.map((signal, index) => <div key={signal.pair} className="signal-card rounded-xl border border-white/[0.07] bg-white/[0.025] p-3" style={{animationDelay: `${index * 220}ms`}}><div className="flex items-center justify-between"><div className="font-black">{signal.pair} <span className="text-[10px] font-medium text-slate-500">{signal.tf}</span></div><span className={`rounded px-2 py-1 text-[9px] font-black ${signal.side === 'LONG' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'}`}>{signal.side}</span></div><div className="mt-3 flex items-end justify-between"><span className="text-xs text-slate-500">{signal.price}</span><div className="text-right"><div className="text-lg font-black text-cyan-300">{signal.score}</div><div className="text-[8px] tracking-wider text-slate-600">SCORE</div></div></div></div>)}</div></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="border-y border-white/[0.06] bg-white/[0.02] py-3"><div className="ticker-track flex w-max gap-12 whitespace-nowrap text-[11px] font-bold tracking-[0.15em] text-slate-500">{[...ticker,...ticker,...ticker].map((item,index) => <span key={`${item}-${index}`} className={item.includes('+') ? 'text-emerald-400/80' : item.includes('-') ? 'text-rose-400/80' : ''}>{item}</span>)}</div></div>

        <section id="platform" className="px-5 py-28"><div className="mx-auto max-w-7xl"><div className="max-w-3xl"><div className="mb-4 text-xs font-black tracking-[0.22em] text-cyan-300">BUILT FOR DECISIVE TRADERS</div><h2 className="text-4xl font-black tracking-[-0.04em] sm:text-6xl">Every signal means more<br/><span className="text-slate-600">when the evidence converges.</span></h2><p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-400">ConfluenceX replaces tab chaos with one focused system for discovery, confirmation, execution planning, and review.</p></div><div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{features.map(({icon:Icon,...feature},index) => <article key={feature.title} className="feature-card group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6 transition duration-500 hover:-translate-y-2 hover:border-cyan-400/25 hover:bg-white/[0.045]" style={{animationDelay:`${index*100}ms`}}><div className="absolute right-0 top-0 h-28 w-28 rounded-full bg-violet-500/0 blur-3xl transition group-hover:bg-violet-500/15"/><div className="mb-8 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-cyan-400/15 to-violet-500/15 text-cyan-300"><Icon className="h-5 w-5"/></div><div className="text-[10px] font-black tracking-[0.2em] text-slate-500">{feature.eyebrow}</div><h3 className="mt-3 text-xl font-black tracking-tight">{feature.title}</h3><p className="mt-3 leading-relaxed text-slate-400">{feature.description}</p><ChevronRight className="mt-6 h-5 w-5 text-slate-700 transition group-hover:translate-x-2 group-hover:text-cyan-300"/></article>)}</div></div></section>

        <section id="workflow" className="border-y border-white/[0.06] bg-[#080b14] px-5 py-28"><div className="mx-auto grid max-w-7xl gap-16 lg:grid-cols-[.8fr_1.2fr] lg:items-center"><div><div className="text-xs font-black tracking-[0.22em] text-violet-300">THE CONFLUENCEX LOOP</div><h2 className="mt-4 text-4xl font-black tracking-[-0.04em] sm:text-6xl">A workflow that keeps emotion out.</h2><p className="mt-6 text-lg leading-relaxed text-slate-400">Move from market discovery to structured review without losing the reason behind the trade.</p><button onClick={() => openAuth('signup')} className="mt-8 flex items-center gap-2 font-black text-cyan-300 transition hover:gap-4">Build your process <ArrowRight className="h-4 w-4"/></button></div><div className="relative"><div className="absolute left-6 top-8 h-[calc(100%-4rem)] w-px bg-gradient-to-b from-cyan-400 via-violet-500 to-fuchsia-500"/>{[['01','SCAN','Surface live opportunities across markets.'],['02','CONFIRM','Validate structure, harmonics, ADR, and score.'],['03','PLAN','Define invalidation and risk before execution.'],['04','REVIEW','Journal the outcome and sharpen the edge.']].map(([number,title,copy])=><div key={number} className="group relative mb-4 flex gap-5 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 transition hover:translate-x-2 hover:border-violet-400/25"><div className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[#0d1324] text-xs font-black text-cyan-300">{number}</div><div><div className="text-xs font-black tracking-[0.2em] text-slate-500">{title}</div><p className="mt-2 text-lg font-bold text-slate-200">{copy}</p></div></div>)}</div></div></section>

        <PricingSection />

        <section id="community" className="px-5 pb-28"><div className="relative mx-auto max-w-7xl overflow-hidden rounded-[32px] border border-white/[0.1] bg-gradient-to-br from-[#0e1830] via-[#111027] to-[#1a0e26] px-6 py-16 text-center sm:px-12 sm:py-24"><div className="absolute left-0 top-0 h-64 w-64 rounded-full bg-cyan-500/10 blur-[90px]"/><div className="absolute bottom-0 right-0 h-64 w-64 rounded-full bg-fuchsia-500/10 blur-[90px]"/><Users className="relative mx-auto h-10 w-10 text-cyan-300"/><h2 className="relative mx-auto mt-6 max-w-3xl text-4xl font-black tracking-[-0.04em] sm:text-6xl">Trade with a system.<br/>Grow with a community.</h2><p className="relative mx-auto mt-5 max-w-xl text-lg text-slate-400">Share setups, compare process, and improve alongside traders who care about confirmation over prediction.</p><button onClick={() => openAuth('signup')} className="relative mt-8 rounded-2xl bg-white px-7 py-4 font-black text-[#070a12] transition hover:-translate-y-1">Join the platform</button></div></section>
      </main>

      <footer className="relative z-10 border-t border-white/[0.07] px-5 py-12"><div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 sm:flex-row sm:items-center"><ConfluenceXLogo size="md" showTagline/><div className="flex flex-wrap gap-6 text-sm text-slate-500"><a href="#platform" className="hover:text-white">Platform</a><a href="#pricing" className="hover:text-white">Access</a><a href="#community" className="hover:text-white">Community</a></div><div className="text-xs text-slate-600">© 2026 ConfluenceX. Market intelligence, converged.</div></div></footer>

      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} initialMode={authMode} />
    </div>
  );
};

export default LandingPage;
