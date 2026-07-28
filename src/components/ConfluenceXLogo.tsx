import React from 'react';

interface ConfluenceXLogoProps {
  compact?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  className?: string;
}

const sizes = {
  sm: { mark: 'w-8 h-8', name: 'text-lg' },
  md: { mark: 'w-10 h-10', name: 'text-xl' },
  lg: { mark: 'w-14 h-14', name: 'text-3xl' },
};

const ConfluenceXLogo: React.FC<ConfluenceXLogoProps> = ({
  compact = false,
  size = 'md',
  showTagline = false,
  className = '',
}) => {
  const scale = sizes[size];
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <img
        src="/confluencex-mark.svg"
        alt="ConfluenceX"
        className={`${scale.mark} shrink-0 drop-shadow-[0_0_14px_rgba(34,211,238,0.24)]`}
      />
      {!compact && (
        <div className="min-w-0">
          <div className={`${scale.name} font-black tracking-[-0.045em] leading-none text-white whitespace-nowrap`}>
            Confluence<span className="bg-gradient-to-r from-violet-400 to-cyan-300 bg-clip-text text-transparent">X</span>
          </div>
          {showTagline && (
            <div className="mt-1 text-[9px] font-semibold tracking-[0.19em] text-slate-500 whitespace-nowrap">
              SEE THE SETUP. CONFIRM THE EDGE.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ConfluenceXLogo;
