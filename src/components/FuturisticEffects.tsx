import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';

/* ================================================================
   ConfluenceX Futuristic Effect Components
   ================================================================
   Lightweight, composable wrappers for the futuristic.css classes
   plus a few canvas-based effects (particle field, data rain).
   ================================================================ */

// ── Particle Field (canvas-based) ─────────────────────────
interface ParticleFieldProps {
  count?: number;
  color?: string;
  className?: string;
}

export const ParticleField: React.FC<ParticleFieldProps> = ({
  count = 50,
  color = '34, 211, 238',
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener('resize', resize);

    const particles = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.offsetWidth,
      y: Math.random() * canvas.offsetHeight,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      size: Math.random() * 1.5 + 0.5,
      alpha: Math.random() * 0.4 + 0.1,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas.offsetWidth) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.offsetHeight) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color}, ${p.alpha})`;
        ctx.fill();
      }

      // Draw faint connection lines between nearby particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(${color}, ${0.06 * (1 - dist / 120)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      animRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [count, color]);

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none absolute inset-0 z-0 ${className}`}
      style={{ width: '100%', height: '100%' }}
    />
  );
};

// ── Glow Border Wrapper ───────────────────────────────────
interface GlowBorderProps {
  children: React.ReactNode;
  spinning?: boolean;
  className?: string;
}

export const GlowBorder: React.FC<GlowBorderProps> = ({
  children,
  spinning = true,
  className = '',
}) => (
  <div className={`cx-glow-border ${!spinning ? 'cx-glow-border-static' : ''} ${className}`}>
    {children}
  </div>
);

// ── Holographic Card ──────────────────────────────────────
interface HoloCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export const HoloCard: React.FC<HoloCardProps> = ({
  children,
  className = '',
  onClick,
}) => (
  <div
    className={`cx-holo-card p-5 ${className}`}
    onClick={onClick}
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
  >
    {children}
  </div>
);

// ── Live Status Dot ───────────────────────────────────────
interface LiveDotProps {
  color?: 'cyan' | 'green' | 'red' | 'amber';
  size?: 'sm' | 'md';
  className?: string;
}

export const LiveDot: React.FC<LiveDotProps> = ({
  color = 'cyan',
  size = 'sm',
  className = '',
}) => {
  const colorClass = {
    cyan: 'cx-live-dot',
    green: 'cx-live-dot cx-live-dot-green',
    red: 'cx-live-dot cx-live-dot-red',
    amber: 'cx-live-dot cx-live-dot-amber',
  }[color];
  const sizeClass = size === 'md' ? 'w-3 h-3' : '';
  return <span className={`${colorClass} ${sizeClass} ${className}`} />;
};

// ── Heat Bar ──────────────────────────────────────────────
interface HeatBarProps {
  value: number; // 0-100
  className?: string;
}

export const HeatBar: React.FC<HeatBarProps> = ({ value, className = '' }) => (
  <div className={`cx-heat-bar ${className}`}>
    <div
      className="cx-heat-bar-fill"
      style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
    />
  </div>
);

// ── Score Ring (animated SVG) ─────────────────────────────
interface ScoreRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export const ScoreRing: React.FC<ScoreRingProps> = ({
  score,
  size = 56,
  strokeWidth = 3,
  className = '',
}) => {
  const pct = Math.max(0, Math.min(100, score));
  const r = size / 2 - strokeWidth - 1;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  const color = pct >= 70 ? '#22d3ee' : pct >= 40 ? '#a78bfa' : '#475569';

  return (
    <div className={`cx-score-ring ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="cx-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <circle
          className="cx-ring-bg"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={strokeWidth}
        />
        <circle
          className="cx-ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dy="0.35em"
          fill="white"
          fontSize={size * 0.22}
          fontWeight={900}
          fontFamily="Inter, system-ui, sans-serif"
        >
          {pct}
        </text>
      </svg>
    </div>
  );
};

// ── TypeWriter ────────────────────────────────────────────
interface TypeWriterProps {
  text: string;
  speed?: number;
  className?: string;
  onComplete?: () => void;
}

export const TypeWriter: React.FC<TypeWriterProps> = ({
  text,
  speed = 40,
  className = '',
  onComplete,
}) => {
  const [displayed, setDisplayed] = useState('');
  const idx = useRef(0);

  useEffect(() => {
    setDisplayed('');
    idx.current = 0;
    const interval = setInterval(() => {
      if (idx.current < text.length) {
        setDisplayed(text.slice(0, idx.current + 1));
        idx.current++;
      } else {
        clearInterval(interval);
        onComplete?.();
      }
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed, onComplete]);

  return (
    <span className={`cx-typing ${className}`}>
      {displayed}
    </span>
  );
};

// ── Scanner Pulse ─────────────────────────────────────────
interface ScannerPulseProps {
  size?: number;
  color?: string;
  className?: string;
  children?: React.ReactNode;
}

export const ScannerPulse: React.FC<ScannerPulseProps> = ({
  size = 32,
  className = '',
  children,
}) => (
  <div
    className={`cx-scanner-pulse ${className}`}
    style={{ width: size, height: size }}
  >
    {children}
  </div>
);

// ── Stagger Container ─────────────────────────────────────
interface StaggerProps {
  children: React.ReactNode;
  className?: string;
}

export const Stagger: React.FC<StaggerProps> = ({ children, className = '' }) => (
  <div className={`cx-stagger ${className}`}>
    {children}
  </div>
);

// ── Scan Line Overlay ─────────────────────────────────────
interface ScanLineProps {
  children: React.ReactNode;
  className?: string;
}

export const ScanLine: React.FC<ScanLineProps> = ({ children, className = '' }) => (
  <div className={`cx-scan-line ${className}`}>
    {children}
  </div>
);

// ── Grid Background ───────────────────────────────────────
interface GridBgProps {
  children: React.ReactNode;
  className?: string;
}

export const GridBg: React.FC<GridBgProps> = ({ children, className = '' }) => (
  <div className={`cx-grid-bg ${className}`}>
    {children}
  </div>
);

// ── Gradient Border Card ──────────────────────────────────
interface GradientBorderCardProps {
  children: React.ReactNode;
  className?: string;
}

export const GradientBorderCard: React.FC<GradientBorderCardProps> = ({
  children,
  className = '',
}) => (
  <div className={`cx-gradient-border rounded-2xl cx-bg-card p-5 ${className}`}>
    {children}
  </div>
);

// ── Animated Counter ──────────────────────────────────────
interface AnimatedCounterProps {
  value: number;
  duration?: number;
  className?: string;
  suffix?: string;
}

export const AnimatedCounter: React.FC<AnimatedCounterProps> = ({
  value,
  duration = 800,
  className = '',
  suffix = '',
}) => {
  const [displayed, setDisplayed] = useState(0);
  const startRef = useRef<number | null>(null);
  const prevRef = useRef(0);

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    prevRef.current = value;

    const animate = (timestamp: number) => {
      if (!startRef.current) startRef.current = timestamp;
      const progress = Math.min((timestamp - startRef.current) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setDisplayed(Math.round(from + (to - from) * eased));
      if (progress < 1) requestAnimationFrame(animate);
    };

    startRef.current = null;
    requestAnimationFrame(animate);
  }, [value, duration]);

  return (
    <span className={`cx-count-up cx-mono ${className}`}>
      {displayed}{suffix}
    </span>
  );
};

// ── Neon Text ─────────────────────────────────────────────
interface NeonTextProps {
  children: React.ReactNode;
  color?: 'cyan' | 'violet' | 'buy' | 'sell';
  className?: string;
}

export const NeonText: React.FC<NeonTextProps> = ({
  children,
  color = 'cyan',
  className = '',
}) => {
  const colorStyles: Record<string, React.CSSProperties> = {
    cyan: { textShadow: '0 0 7px rgba(34,211,238,0.6), 0 0 20px rgba(34,211,238,0.3)' },
    violet: { textShadow: '0 0 7px rgba(139,92,246,0.6), 0 0 20px rgba(139,92,246,0.3)' },
    buy: { textShadow: '0 0 7px rgba(16,185,129,0.6), 0 0 20px rgba(16,185,129,0.3)' },
    sell: { textShadow: '0 0 7px rgba(239,68,68,0.6), 0 0 20px rgba(239,68,68,0.3)' },
  };

  return (
    <span className={className} style={colorStyles[color]}>
      {children}
    </span>
  );
};

// ── Data Rain (Matrix-style background) ───────────────────
interface DataRainProps {
  className?: string;
}

export const DataRain: React.FC<DataRainProps> = ({ className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener('resize', resize);

    const chars = '01 BUY SELL EUR USD GBP JPY CHF AUD NZD CAD BTC ETH XAU'.split(' ');
    const fontSize = 11;
    const columns = Math.floor(canvas.offsetWidth / fontSize);
    const drops = Array.from({ length: columns }, () => Math.random() * -100);

    const draw = () => {
      ctx.fillStyle = 'rgba(7, 11, 20, 0.06)';
      ctx.fillRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;

        // Gradient from bright to dim
        const alpha = 0.04 + Math.random() * 0.04;
        ctx.fillStyle = `rgba(34, 211, 238, ${alpha})`;
        ctx.fillText(char, x, y);

        if (y > canvas.offsetHeight && Math.random() > 0.98) {
          drops[i] = 0;
        }
        drops[i] += 0.5;
      }

      animRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none absolute inset-0 z-0 opacity-50 ${className}`}
      style={{ width: '100%', height: '100%' }}
    />
  );
};
