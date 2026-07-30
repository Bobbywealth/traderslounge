import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import ConfluenceXLogo from './ConfluenceXLogo';
import {
  LayoutDashboard,
  Calendar,
  Zap,
  GraduationCap,
  MessageSquare,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Activity,
  BookOpen,
  Settings as SettingsIcon,
} from 'lucide-react';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

type NavSection = { heading?: string; items: { name: string; href: string; icon: any }[] };

const navigation: NavSection[] = [
  {
    items: [
      { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    ],
  },
  {
    heading: 'Trading System',
    items: [
      { name: 'Live Scanner', href: '/scanner', icon: Activity },
      { name: 'Signals', href: '/signals', icon: Zap },
      { name: 'Journal', href: '/journal', icon: BookOpen },
      { name: 'Settings', href: '/settings', icon: SettingsIcon },
    ],
  },
  {
    heading: 'Tools',
    items: [
      { name: 'TradingView', href: '/tradingview', icon: BarChart3 },
      { name: 'Calendar', href: '/calendar', icon: Calendar },
      { name: 'Education', href: '/education', icon: GraduationCap },
      { name: 'Community', href: '/community', icon: MessageSquare },
    ],
  },
];

const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggle }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const handleUpgrade = () => {
    // Navigate to admin dashboard for upgrade
    navigate('/admin');
  };

  return (
    <div className={`fixed left-0 top-0 h-full glass-dark border-r border-gray-700/50 transition-all duration-300 z-40 backdrop-blur-xl ${
      collapsed ? 'w-16' : 'w-72'
    }`}>
      {/* Header */}
      <div className={`${collapsed ? 'flex flex-col items-center gap-1 p-2' : 'flex items-center justify-between p-4'} border-b border-gray-700/50`}>
        <ConfluenceXLogo compact={collapsed} size={collapsed ? 'sm' : 'md'} showTagline={!collapsed} />
        <button
          onClick={onToggle}
          className="p-2 rounded-xl hover:bg-white/10 transition-all duration-200 group"
        >
          {collapsed ? (
            <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-white transition-colors" />
          ) : (
            <ChevronLeft className="w-5 h-5 text-gray-400 group-hover:text-white transition-colors" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="mt-6 px-3 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        {navigation.map((section, sIdx) => (
          <div key={sIdx} className={sIdx > 0 ? 'mt-6' : ''}>
            {section.heading && !collapsed && (
              <h3 className="px-3 mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {section.heading}
              </h3>
            )}
            {section.items.map((item) => {
              const isActive = location.pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`relative flex items-center px-3 py-3 rounded-xl text-sm font-medium transition-all duration-200 mb-1 group ${
                    isActive
                      ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/25'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${collapsed ? '' : 'mr-3'} ${
                    isActive ? 'text-white' : 'group-hover:text-emerald-400'
                  }`} />
                  {!collapsed && <span>{item.name}</span>}
                  {collapsed && isActive && (
                    <div className="absolute right-2 w-1.5 h-1.5 bg-white rounded-full" />
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer - Upgrade CTA (collapsed pill / expanded card) */}
      <div className="absolute bottom-4 left-3 right-3">
        {collapsed ? (
          <button
            onClick={handleUpgrade}
            title="Upgrade available"
            className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300 transition hover:bg-cyan-400/15"
          >
            <Sparkles className="h-4 w-4" />
          </button>
        ) : (
          <div className="relative rounded-xl border border-cyan-400/15 bg-gradient-to-br from-cyan-500/[0.07] to-violet-500/[0.07] p-3 transition hover:border-cyan-400/30">
            <button
              onClick={handleUpgrade}
              className="flex w-full items-center justify-between gap-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-cyan-300" />
                <div className="min-w-0 text-left">
                  <div className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Pro · Upgrade</div>
                  <div className="truncate text-[10px] text-slate-400">Unlock advanced features</div>
                </div>
              </div>
              <span className="rounded-md bg-gradient-to-r from-cyan-400 to-violet-500 px-2 py-1 text-[10px] font-black text-[#05070d]">
                Go
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
