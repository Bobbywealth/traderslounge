import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import ConfluenceXLogo from './ConfluenceXLogo';
import {
  Activity, BarChart3, BookOpen, Calendar, ChevronLeft, ChevronRight,
  FlaskConical, LayoutDashboard, Zap,
} from 'lucide-react';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Live Scanner', href: '/scanner', icon: Activity },
  { name: 'Signals', href: '/signals', icon: Zap },
  { name: 'Chart', href: '/tradingview', icon: BarChart3 },
  { name: 'Validation', href: '/backtester', icon: FlaskConical },
  { name: 'Calendar', href: '/calendar', icon: Calendar },
  { name: 'Journal', href: '/journal', icon: BookOpen },
];

const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggle }) => {
  const location = useLocation();

  return (
    <div className={`fixed left-0 top-0 z-40 h-full border-r border-gray-700/50 backdrop-blur-xl glass-dark transition-all duration-300 ${collapsed ? 'w-16' : 'w-72'}`}>
      <div className={`${collapsed ? 'flex flex-col items-center gap-1 p-2' : 'flex items-center justify-between p-4'} border-b border-gray-700/50`}>
        <ConfluenceXLogo compact={collapsed} size={collapsed ? 'sm' : 'md'} showTagline={!collapsed} />
        <button onClick={onToggle} className="rounded-xl p-2 transition-all duration-200 hover:bg-white/10" title={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
          {collapsed ? <ChevronRight className="h-5 w-5 text-gray-400" /> : <ChevronLeft className="h-5 w-5 text-gray-400" />}
        </button>
      </div>

      <nav className="mt-6 px-3">
        {!collapsed && <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Intelligence workflow</h3>}
        {navigation.map((item) => {
          const isActive = location.pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              to={item.href}
              title={collapsed ? item.name : undefined}
              className={`group relative mb-1 flex items-center rounded-xl px-3 py-3 text-sm font-medium transition-all duration-200 ${isActive ? 'bg-gradient-to-r from-cyan-500 to-violet-500 text-white shadow-lg shadow-cyan-500/20' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}
            >
              <Icon className={`h-5 w-5 ${collapsed ? '' : 'mr-3'} ${isActive ? 'text-white' : 'group-hover:text-cyan-400'}`} />
              {!collapsed && <span>{item.name}</span>}
              {collapsed && isActive && <div className="absolute right-2 h-1.5 w-1.5 rounded-full bg-white" />}
            </Link>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="absolute bottom-5 left-4 right-4 rounded-xl border border-cyan-400/10 bg-cyan-400/[0.04] p-3 text-[10px] leading-relaxed text-slate-500">
          <strong className="block font-black uppercase tracking-widest text-cyan-300">Decision support only</strong>
          No broker connections or order execution.
        </div>
      )}
    </div>
  );
};

export default Sidebar;
