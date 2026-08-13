import React from 'react';

/**
 * Branded splash / loading screen for ConfluenceX.
 *
 * - Used as the initial paint when AuthContext is restoring the session
 *   (replaces the previous muted "Loading market intelligence..." block).
 * - Also doubles as the splash shown by iOS/Android launchers when the
 *   installed PWA cold-starts before the React bundle hydrates.
 *
 * The element intentionally uses inline SVG (no extra HTTP request) so the
 * first paint is fully self-contained and renders identically online and
 * offline. The background matches the PWA theme_color (#070a12) so there is
 * no white flash between the native splash and the React tree.
 */

interface PwaSplashProps {
  /** Optional secondary line under the logo. */
  message?: string;
  /** Optional small inline progress indicator. */
  showSpinner?: boolean;
  className?: string;
}

const ConfluenceMark: React.FC<{ size?: number; className?: string }> = ({
  size = 96,
  className = '',
}) => (
  <svg
    role="img"
    aria-label="ConfluenceX"
    viewBox="0 0 128 128"
    width={size}
    height={size}
    className={className}
  >
    <defs>
      <linearGradient id="splash-bg" x1="12" y1="8" x2="116" y2="120" gradientUnits="userSpaceOnUse">
        <stop stopColor="#11182D" />
        <stop offset="1" stopColor="#070A12" />
      </linearGradient>
      <linearGradient id="splash-violet" x1="24" y1="22" x2="98" y2="104" gradientUnits="userSpaceOnUse">
        <stop stopColor="#D946EF" />
        <stop offset="0.48" stopColor="#8B5CF6" />
        <stop offset="1" stopColor="#6D28D9" />
      </linearGradient>
      <linearGradient id="splash-cyan" x1="104" y1="20" x2="28" y2="108" gradientUnits="userSpaceOnUse">
        <stop stopColor="#67E8F9" />
        <stop offset="0.5" stopColor="#22D3EE" />
        <stop offset="1" stopColor="#0891B2" />
      </linearGradient>
      <filter id="splash-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <rect x="4" y="4" width="120" height="120" rx="30" fill="url(#splash-bg)" stroke="#26304D" strokeWidth="2" />
    <path
      d="M24 30L47 50L62 64L82 83L104 103"
      fill="none"
      stroke="url(#splash-violet)"
      strokeWidth="11"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M104 25L83 45L65 62L46 82L24 104"
      fill="none"
      stroke="url(#splash-cyan)"
      strokeWidth="11"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M16 64H40M88 64H112" stroke="#33405F" strokeWidth="3" strokeLinecap="round" />
    <circle cx="64" cy="64" r="11" fill="#0B1020" stroke="#F5F3FF" strokeWidth="2" filter="url(#splash-glow)" />
    <path
      d="M57 64L62 69L72 57"
      fill="none"
      stroke="#A3E635"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const PwaSplash: React.FC<PwaSplashProps> = ({
  message = 'Loading market intelligence…',
  showSpinner = true,
  className = '',
}) => {
  // Avoid hydration mismatch: this component renders identically on server
  // and client because it has no browser-only APIs.
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={`relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-[#070a12] text-slate-100 ${className}`}
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      {/* Decorative radial glows — match LandingPage so the visual hand-off is seamless. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 18% 8%, rgba(34,211,238,0.18), transparent 28%), radial-gradient(circle at 82% 12%, rgba(139,92,246,0.22), transparent 32%), radial-gradient(circle at 50% 100%, rgba(217,70,239,0.10), transparent 38%)',
        }}
      />

      {/* Subtle animated grid lines. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(148,163,184,0.6) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.6) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(circle at center, black 35%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(circle at center, black 35%, transparent 75%)',
        }}
      />

      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        <div className="relative animate-[pulse_3.6s_ease-in-out_infinite]">
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 blur-3xl"
            style={{
              background:
                'radial-gradient(circle, rgba(139,92,246,0.45) 0%, rgba(34,211,238,0.30) 38%, transparent 70%)',
            }}
          />
          <ConfluenceMark size={120} className="drop-shadow-[0_0_28px_rgba(139,92,246,0.45)]" />
        </div>

        <h1 className="mt-6 text-3xl font-black tracking-tight text-white sm:text-4xl">
          Confluence<span className="bg-gradient-to-r from-cyan-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">X</span>
        </h1>
        <p className="mt-1 text-[11px] font-black uppercase tracking-[0.32em] text-cyan-300/80">
          See the Setup. Confirm the Edge.
        </p>

        {showSpinner && (
          <div className="mt-9 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="relative inline-flex h-2 w-2 rounded-full bg-cyan-300"
              style={{ animation: 'cx-blink 1.4s ease-in-out infinite' }}
            />
            <span
              aria-hidden="true"
              className="relative inline-flex h-2 w-2 rounded-full bg-violet-400"
              style={{ animation: 'cx-blink 1.4s ease-in-out infinite', animationDelay: '0.2s' }}
            />
            <span
              aria-hidden="true"
              className="relative inline-flex h-2 w-2 rounded-full bg-fuchsia-400"
              style={{ animation: 'cx-blink 1.4s ease-in-out infinite', animationDelay: '0.4s' }}
            />
          </div>
        )}

        <p className="mt-5 text-sm font-medium text-slate-400">{message}</p>
      </div>

      {/* Local keyframes — kept inline so the splash works without the main CSS bundle (offline-first). */}
      <style>{`
        @keyframes cx-blink {
          0%, 100% { opacity: 0.35; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(-3px); }
        }
      `}</style>
    </div>
  );
};

export default PwaSplash;