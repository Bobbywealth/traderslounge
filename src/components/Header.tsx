import React from 'react';
import { LogOut, Menu, Moon, Sun, X } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import ConfluenceXLogo from './ConfluenceXLogo';

interface HeaderProps {
  /** When true, render the hamburger button that opens the mobile drawer. */
  showMenuButton?: boolean;
  /** Called when the hamburger / close button is tapped. */
  onMenuToggle?: () => void;
  /** Whether the mobile drawer is currently open (swaps Menu ↔ X icon). */
  menuOpen?: boolean;
}

const Header: React.FC<HeaderProps> = ({ showMenuButton = false, onMenuToggle, menuOpen = false }) => {
  const { isDark, toggleTheme } = useTheme();
  const { user, logout } = useAuth();

  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200/50 px-4 sm:px-6 backdrop-blur-xl glass dark:border-gray-700/50 dark:glass-dark">
      <div className="flex items-center gap-3">
        {showMenuButton && (
          <button
            onClick={onMenuToggle}
            className="rounded-xl p-2 transition-all duration-200 hover:bg-gray-100 dark:hover:bg-gray-700/80 md:hidden"
            title={menuOpen ? 'Close navigation' : 'Open navigation'}
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={menuOpen}
          >
            {menuOpen
              ? <X className="h-5 w-5 cx-text-muted dark:text-gray-200" />
              : <Menu className="h-5 w-5 cx-text-muted dark:text-gray-200" />}
          </button>
        )}
        <ConfluenceXLogo compact size="sm" />
        <div>
          <h2 className="text-sm font-bold cx-text-strong dark:cx-text-strong sm:text-lg">
            Welcome back, <span className="gradient-text">{user?.name || 'Trader'}</span>
          </h2>
          <p className="hidden text-[10px] font-bold uppercase tracking-widest cx-text-faint sm:block">Read-only market intelligence</p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={toggleTheme}
          className="rounded-xl p-2.5 transition-all duration-200 hover:bg-gray-100 dark:hover:bg-gray-700/80"
          title={isDark ? 'Use light theme' : 'Use dark theme'}
        >
          {isDark ? <Sun className="h-5 w-5 cx-text-faint hover:text-amber-500" /> : <Moon className="h-5 w-5 cx-text-faint hover:text-indigo-500" />}
        </button>
        <button
          onClick={logout}
          className="rounded-xl p-2.5 transition-all duration-200 hover:bg-red-50 dark:hover:bg-red-900/20"
          title="Sign Out"
        >
          <LogOut className="h-5 w-5 cx-text-faint hover:text-red-500 dark:cx-text-faint" />
        </button>
        <div className="mx-2 h-8 w-px bg-gray-200 dark:bg-gray-700" />
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-violet-600 font-bold cx-text-strong shadow-lg ring-2 ring-cyan-500/20">
            {user?.avatar ? <img src={user.avatar} alt={user.name} className="h-full w-full rounded-xl object-cover" /> : user?.name?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div className="hidden md:block">
            <p className="text-sm font-semibold cx-text-strong dark:cx-text-strong">{user?.name || 'User'}</p>
            <p className="text-xs font-medium text-cyan-600 dark:text-cyan-400">Intelligence workspace</p>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
