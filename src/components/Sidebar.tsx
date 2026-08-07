import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import ConfluenceXLogo from './ConfluenceXLogo';
import {
  Activity, BarChart3, Bell, BookOpen, ChevronLeft, ChevronRight, X,
  FlaskConical, LayoutDashboard, LineChart, Newspaper, Settings as SettingsIcon, Zap, Search,
  Briefcase, History, ArrowLeftRight,
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

/**
 * Sidebar surfaces
 * ----------------
 * `botMode` is reserved for the upcoming automated-trading strategy. When
 * that ships, we will surface broker execution views (open positions, trade
 * history) from the bot strategy itself. The route files for /positions and
 * /trades stay in the repo so the strategy can navigate to them directly
 * without re-adding nav links here.
 *
 * The current product is read-only market intelligence, so the broker pages
 * are intentionally hidden from the sidebar. The single source of truth for
 * which pages appear in the nav is `groups` below.
 */
const groups: NavGroup[] = [
  {
    label: 'Find trades',
    items: [
      { name: 'Dashboard', href: '/', icon: LayoutDashboard },
      { name: 'Signals', href: '/signals', icon: Zap },
      { name: 'Chart', href: '/tradingview', icon: BarChart3 },
    ],
  },
  {
    label: 'Research',
    items: [
      { name: 'Economic News', href: '/calendar', icon: Newspaper },
      { name: 'Backtest & Accuracy', href: '/backtester', icon: FlaskConical },
    ],
  },
  {
    label: 'Track',
    items: [
      { name: 'Alerts', href: '/alerts', icon: Bell },
      { name: 'Performance', href: '/performance', icon: LineChart },
      { name: 'Journal', href: '/journal', icon: BookOpen },
      { name: 'Settings', href: '/settings', icon: SettingsIcon },
    ],
  },
];

/**
 * Broker / bot surfaces that are intentionally NOT in the main nav but stay
 * available in code for the future bot strategy:
 *   - /positions  (Briefcase,  Positions.tsx)
 *   - /trades     (History,    TradingTable.tsx)
 * Flip this flag to true when the bot strategy is ready, then re-introduce
 * the items in the appropriate group.
 */
export const botNavigationItems: NavItem[] = [
  { name: 'Positions', href: '/positions', icon: Briefcase },
  { name: 'Trade History', href: '/trades', icon: History },
];

/**
 * Pages that previously had their own top-level route but are now surfaced
 * inside the Dashboard or Chart pages. The route files are still in the repo
 * for the bot strategy, but the nav no longer exposes them.
 */
export const foldedNavigationItems: NavItem[] = [
  { name: 'Hot Scanner', href: '/scanner', icon: Activity },
  { name: 'Market Analysis', href: '/analysis', icon: Search },
  { name: 'Full Analysis', href: '/tradingview?symbol=BTCUSD&panel=full', icon: ArrowLeftRight },
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
    const isSignalsView = (location.pathname === '/signals') || (location.pathname === '/' && new URLSearchParams(location.search).get('tab') === 'signals');
    const isActive = item.name === 'Signals' ? isSignalsView : location.pathname === item.href && !(item.href === '/' && isSignalsView);
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
            ? 'bg-gradient-to-r from-cyan-400/15 to-violet-500/15 text-cyan-300 cx-neon-cyan'
            : 'cx-text-faint hover:cx-bg-card-hover hover:text-gray-200'
        } ${collapsed ? 'justify-center px-2' : ''}`}
      >
        <item.icon className={`h-5 w-5 shrink-0 ${isActive ? 'text-cyan-300' : 'cx-text-faint group-hover:text-gray-300'}`} />
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
            <X className="h-5 w-5 cx-text-faint" />
          </button>
        ) : (
          <button onClick={onToggle} className="rounded-xl p-2 transition-all duration-200 hover:bg-white/10" title={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
            {collapsed ? <ChevronRight className="h-5 w-5 cx-text-faint" /> : <ChevronLeft className="h-5 w-5 cx-text-faint" />}
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
