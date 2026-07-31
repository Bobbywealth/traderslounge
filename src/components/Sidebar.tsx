import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import ConfluenceXLogo from './ConfluenceXLogo';
import {
  Activity, BarChart3, BookOpen, Briefcase, ChevronLeft, ChevronRight, X,
  FlaskConical, History, LayoutDashboard, LineChart, Newspaper, Settings as SettingsIcon, Zap,
} from 'lucide-react';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  /**
   * `'desktop'` renders the persistent sidebar with a left margin push on the
   * main content. `'overlay'` renders the sidebar as a slide-in drawer with a
   * backdrop, hiding it by default on small viewports.
   */
  mode?: 'desktop' | 'overlay';
  /** When `mode === 'overlay'`, controls whether the drawer is visible. */
  mobileOpen?: boolean;
  /** When `mode === 'overlay'`, called when the user dismisses the drawer. */
  onMobileClose?: () => void;
}

type NavItem = { name: string; href: string; icon: React.ElementType };
type NavGroup = { label: string; items: NavItem[] };

const groups: NavGroup[] = [
  {
    label: 'Trade',
    items: [
      { name: 'Dashboard', href: '/', icon: LayoutDashboard },
      { name: 'Signals', href: '/signals', icon: Zap },
      { name: 'Positions', href: '/positions', icon: Briefcase },
      { name: 'Trade History', href: '/trades', icon: History },
    ],
  },
  {
    label: 'Analyze',
    items: [
      { name: 'Live Scanner', href: '/scanner', icon: Activity },
      { name: 'Chart', href: '/tradingview', icon: BarChart3 },
      { name: 'Economic News', href: '/calendar', icon: Newspaper },
    ],
  },
  {
    label: 'Track',
    items: [
      { name: 'Performance', href: '/performance', icon: LineChart },
      { name: 'Journal', href: '/journal', icon: BookOpen },
      { name: 'Backtest & Accuracy', href: '/backtester', icon: FlaskConical },
    ],
  },
];

const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  onToggle,
  mode = 'desktop',
  mobileOpen = false,
  onMobileClose,
}) => {
  const location = useLocation();
  const isOverlay = mode === 'overlay';

  const renderItem = (item: NavItem) => {
    const isActive = location.pathname === item.href;
    return (
      <Link
        key={item.name}
        to={item.href}
        onClick={() => {
          if (isOverlay) onMobileClose?.();
        }}
        title={collapsed ? item.name : undefined}
        className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200 ${
          isActive
            ? 'bg-gradient-to-r from-cyan-400/15 to-violet-500/15 text-cyan-300'
            : 'text-gray-400 hover:bg-white/[0.06] hover:text-gray-200'
        } ${collapsed ? 'justify-center px-2' : ''}`}
      >
        <item.icon className={`h-5 w-5 shrink-0 ${isActive ? 'text-cyan-300' : 'text-gray-500 group-hover:text-gray-300'}`} />
        {!collapsed && <span className="truncate">{item.name}</span>}
      </Link>
    );
  };

  // Width class: in overlay mode we always render the full expanded drawer so
  // the user gets the complete nav list. The desktop mode keeps the existing
  // collapsed/expanded toggle behavior.
  const widthClass = isOverlay ? 'w-72' : (collapsed ? 'w-16' : 'w-72');
  const visibilityClass = isOverlay
    ? (mobileOpen ? 'translate-x-0' : '-translate-x-full')
    : '';

  const sidebar = (
    <div
      className={`flex h-full flex-col border-r border-gray-700/50 backdrop-blur-xl glass-dark transition-all duration-300 ${widthClass} ${visibilityClass} ${
        isOverlay ? 'fixed left-0 top-0 z-50 shadow-2xl' : 'fixed left-0 top-0 z-40'
      }`}
      aria-hidden={isOverlay && !mobileOpen}
    >
      <div className={`${collapsed && !isOverlay ? 'flex flex-col items-center gap-1 p-2' : 'flex items-center justify-between p-4'} border-b border-gray-700/50`}>
        <ConfluenceXLogo compact={collapsed && !isOverlay} size={collapsed && !isOverlay ? 'sm' : 'md'} showTagline={!collapsed || isOverlay} />
        {isOverlay ? (
          <button
            onClick={onMobileClose}
            className="rounded-xl p-2 transition-all duration-200 hover:bg-white/10"
            title="Close navigation"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5 text-gray-400" />
          </button>
        ) : (
          <button onClick={onToggle} className="rounded-xl p-2 transition-all duration-200 hover:bg-white/10" title={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
            {collapsed ? <ChevronRight className="h-5 w-5 text-gray-400" /> : <ChevronLeft className="h-5 w-5 text-gray-400" />}
          </button>
        )}
      </div>

      <nav className="mt-4 flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group.label}>
            {(!collapsed || isOverlay) && (
              <h3 className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-gray-600">{group.label}</h3>
            )}
            <div className="space-y-1">{group.items.map(renderItem)}</div>
          </div>
        ))}
      </nav>

      <div className="border-t border-gray-700/50 p-3">
        {renderItem({ name: 'Settings', href: '/settings', icon: SettingsIcon })}
      </div>
    </div>
  );

  if (!isOverlay) return sidebar;

  // Overlay mode: render the sidebar plus a click-to-dismiss backdrop.
  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onMobileClose}
        aria-hidden="true"
      />
      {sidebar}
    </>
  );
};

export default Sidebar;
