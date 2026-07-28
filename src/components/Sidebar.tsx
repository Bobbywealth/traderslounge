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

      {/* Footer - Upgrade CTA */}
      {!collapsed && (
        <div className="absolute bottom-4 left-4 right-4">
          <div className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 rounded-xl p-4 border border-emerald-500/20">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">Upgrade Available</span>
            </div>
            <p className="text-xs text-gray-400 mb-3">Unlock advanced features and priority support</p>
            <button 
              onClick={handleUpgrade}
              className="w-full py-2 px-4 bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-sm font-semibold rounded-lg hover:shadow-lg hover:shadow-emerald-500/25 transition-all duration-200"
            >
              Upgrade Now
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Sidebar;
