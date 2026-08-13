import React, { useEffect, useState } from 'react';
import AuthModal from './AuthModal';
import {
  Mail,
  Lock,
  Loader2,
  Eye,
  EyeOff,
  AlertCircle,
  Sparkles,
  LineChart,
  Radar,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

/**
 * Dedicated login screen used by the ConfluenceX PWA.
 *
 * Why this exists:
 *   When users launch the installed PWA they expect a focused sign-in
 *   experience — not the public marketing landing page. This component
 *   is rendered instead of <LandingPage /> whenever the app is running
 *   as an installed PWA (display-mode: standalone / iOS standalone) and
 *   no session is restored.
 *
 * Behavior:
 *   - Renders a full-bleed branded background matching the PWA theme.
 *   - Inline login form with email + password + Demo Trader autofill.
 *   - Toggle to "Create account" signup mode without leaving the screen.
 *   - One-click "Use demo" button that pre-fills demo@trader.com /
 *     demo123 and submits.
 *   - Auth state is driven by AuthContext; on success the App tree
 *     automatically re-renders the authenticated dashboard.
 */

const ConfluenceMark: React.FC<{ size?: number }> = ({ size = 96 }) => (
  <svg viewBox="0 0 128 128" width={size} height={size} aria-hidden="true">
    <defs>
      <linearGradient id="login-bg" x1="12" y1="8" x2="116" y2="120" gradientUnits="userSpaceOnUse">
        <stop stopColor="#11182D" />
        <stop offset="1" stopColor="#070A12" />
      </linearGradient>
      <linearGradient id="login-violet" x1="24" y1="22" x2="98" y2="104" gradientUnits="userSpaceOnUse">
        <stop stopColor="#D946EF" />
        <stop offset="0.48" stopColor="#8B5CF6" />
        <stop offset="1" stopColor="#6D28D9" />
      </linearGradient>
      <linearGradient id="login-cyan" x1="104" y1="20" x2="28" y2="108" gradientUnits="userSpaceOnUse">
        <stop stopColor="#67E8F9" />
        <stop offset="0.5" stopColor="#22D3EE" />
        <stop offset="1" stopColor="#0891B2" />
      </linearGradient>
    </defs>
    <rect x="4" y="4" width="120" height="120" rx="30" fill="url(#login-bg)" stroke="#26304D" strokeWidth="2" />
    <path d="M24 30L47 50L62 64L82 83L104 103" fill="none" stroke="url(#login-violet)" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M104 25L83 45L65 62L46 82L24 104" fill="none" stroke="url(#login-cyan)" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M16 64H40M88 64H112" stroke="#33405F" strokeWidth="3" strokeLinecap="round" />
    <circle cx="64" cy="64" r="11" fill="#0B1020" stroke="#F5F3FF" strokeWidth="2" />
    <path d="M57 64L62 69L72 57" fill="none" stroke="#A3E635" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PwaLoginScreen: React.FC = () => {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'signup'>('login');

  // Open a browser-level login via AuthModal when the user prefers the
  // existing modal-style experience (e.g. link from email).
  useEffect(() => {
    // Reserved for future deep-link handling (e.g. ?mode=signup from share link).
  }, []);

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!email) next.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) next.email = 'Email is invalid';
    if (!password) next.password = 'Password is required';
    else if (password.length < 6) next.password = 'Password must be at least 6 characters';
    if (mode === 'signup') {
      if (!name) next.name = 'Name is required';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const ok = mode === 'login'
        ? await login(email.trim().toLowerCase(), password)
        : await signup(email.trim().toLowerCase(), password, name.trim());
      if (!ok) setErrors({ submit: 'Authentication failed. Please try again.' });
    } catch {
      setErrors({ submit: 'An unexpected error occurred. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const useDemo = () => {
    setMode('login');
    setEmail('demo@trader.com');
    setPassword('demo123');
    setErrors({});
    // Submit immediately so the user just taps once to enter as Demo Trader.
    setSubmitting(true);
    login('demo@trader.com', 'demo123').then((ok) => {
      if (!ok) setErrors({ submit: 'Demo login is unavailable right now. Please sign in manually.' });
      setSubmitting(false);
    });
  };

  const openAuthModal = (next: 'login' | 'signup') => {
    setAuthModalMode(next);
    setShowAuthModal(true);
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#070a12] text-slate-100">
      {/* Decorative radial glows — same palette as PwaSplash / LandingPage. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            'radial-gradient(circle at 12% 8%, rgba(34,211,238,0.18), transparent 28%), radial-gradient(circle at 88% 12%, rgba(139,92,246,0.22), transparent 32%), radial-gradient(circle at 50% 100%, rgba(217,70,239,0.12), transparent 40%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(148,163,184,0.6) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.6) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(circle at center, black 30%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(circle at center, black 30%, transparent 75%)',
        }}
      />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-5 py-10 sm:py-16">
        <div className="mb-7 flex flex-col items-center text-center">
          <div
            className="relative"
            style={{ filter: 'drop-shadow(0 0 28px rgba(139,92,246,0.45))' }}
          >
            <ConfluenceMark size={104} />
          </div>
          <h1 className="mt-5 text-3xl font-black tracking-tight text-white sm:text-4xl">
            Confluence<span className="bg-gradient-to-r from-cyan-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">X</span>
          </h1>
          <p className="mt-1 text-[11px] font-black uppercase tracking-[0.32em] text-cyan-300/85">
            See the Setup. Confirm the Edge.
          </p>
        </div>

        <div className="w-full max-w-md">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0a0e1a]/85 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.6)] backdrop-blur-xl sm:p-7">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-violet-500/30 blur-3xl"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-16 -left-12 h-48 w-48 rounded-full bg-cyan-400/25 blur-3xl"
            />

            <div className="relative">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white">
                    {mode === 'login' ? 'Welcome back' : 'Create your account'}
                  </h2>
                  <p className="mt-1 text-xs text-slate-400">
                    {mode === 'login'
                      ? 'Sign in to open your trading workspace.'
                      : 'Set up access in under a minute.'}
                  </p>
                </div>
                <Sparkles className="h-5 w-5 text-cyan-300/80" />
              </div>

              <button
                type="button"
                onClick={useDemo}
                disabled={submitting}
                className="group mb-5 flex w-full items-center justify-between gap-3 rounded-2xl border border-cyan-300/30 bg-gradient-to-r from-cyan-400/15 via-violet-500/15 to-fuchsia-500/15 px-4 py-3 text-left transition hover:border-cyan-300/60 hover:from-cyan-400/25 hover:via-violet-500/25 hover:to-fuchsia-500/25 disabled:opacity-60"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-400/20 text-cyan-300">
                    <LineChart className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">Use Demo Trader</div>
                    <div className="text-[11px] text-cyan-200/80">Read-only access — instantly opens the dashboard</div>
                  </div>
                </div>
                <span className="rounded-lg bg-[#070a12] px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-cyan-300">One tap</span>
              </button>

              <form onSubmit={submit} className="space-y-4" noValidate>
                {mode === 'signup' && (
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Full name
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          if (errors.name) setErrors((p) => ({ ...p, name: '' }));
                        }}
                        autoComplete="name"
                        className={`w-full rounded-xl border bg-[#070a12] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/30 ${
                          errors.name ? 'border-rose-500/60' : 'border-white/10'
                        }`}
                        placeholder="Your name"
                      />
                    </div>
                    {errors.name && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-rose-400">
                        <AlertCircle className="h-3 w-3" /> {errors.name}
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (errors.email) setErrors((p) => ({ ...p, email: '' }));
                      }}
                      autoComplete="email"
                      inputMode="email"
                      className={`w-full rounded-xl border bg-[#070a12] py-3 pl-10 pr-4 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/30 ${
                        errors.email ? 'border-rose-500/60' : 'border-white/10'
                      }`}
                      placeholder="you@example.com"
                    />
                  </div>
                  {errors.email && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-rose-400">
                      <AlertCircle className="h-3 w-3" /> {errors.email}
                    </p>
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (errors.password) setErrors((p) => ({ ...p, password: '' }));
                      }}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      className={`w-full rounded-xl border bg-[#070a12] py-3 pl-10 pr-12 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/30 ${
                        errors.password ? 'border-rose-500/60' : 'border-white/10'
                      }`}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-slate-400 transition hover:bg-white/5 hover:text-white"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-rose-400">
                      <AlertCircle className="h-3 w-3" /> {errors.password}
                    </p>
                  )}
                </div>

                {errors.submit && (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300">
                    {errors.submit}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 via-violet-500 to-fuchsia-500 px-5 py-3 text-sm font-black text-[#070a12] shadow-[0_0_28px_rgba(34,211,238,0.35)] transition hover:translate-y-[-1px] hover:shadow-[0_0_40px_rgba(139,92,246,0.45)] disabled:opacity-60"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>{mode === 'login' ? 'Sign in' : 'Create account'}</>
                  )}
                </button>
              </form>

              <div className="mt-5 flex items-center justify-between text-xs text-slate-400">
                <button
                  type="button"
                  onClick={() => setMode((m) => (m === 'login' ? 'signup' : 'login'))}
                  className="font-semibold text-cyan-300 transition hover:text-cyan-200"
                >
                  {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
                </button>
                <button
                  type="button"
                  onClick={() => openAuthModal(mode)}
                  className="font-semibold text-slate-400 transition hover:text-slate-200"
                >
                  Use modal ↗
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 text-[11px] text-slate-400">
            <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-[#0a0e1a]/60 px-3 py-2">
              <Radar className="h-3.5 w-3.5 text-cyan-300" />
              <span>Live Scanner ready</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-[#0a0e1a]/60 px-3 py-2">
              <LineChart className="h-3.5 w-3.5 text-violet-300" />
              <span>Chart-first access</span>
            </div>
          </div>
        </div>
      </div>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        initialMode={authModalMode}
      />
    </div>
  );
};

export default PwaLoginScreen;