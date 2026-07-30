import React from 'react';
import { LogOut, Moon, Sun } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import ConfluenceXLogo from './ConfluenceXLogo';

const Header: React.FC = () => {
  const { isDark, toggleTheme } = useTheme();
  const { user, logout } = useAuth();

  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200/50 px-6 backdrop-blur-xl glass dark:border-gray-700/50 dark:glass-dark">
      <div className="flex items-center gap-3">
        <ConfluenceXLogo compact size="sm" />
        <div>
          <h2 className="text-sm font-bold text-gray-900 dark:text-white sm:text-lg">
            Welcome back, <span className="gradient-text">{user?.name || 'Trader'}</span>
          </h2>
          <p className="hidden text-[10px] font-bold uppercase tracking-widest text-slate-500 sm:block">Read-only market intelligence</p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={toggleTheme}
          className="rounded-xl p-2.5 transition-all duration-200 hover:bg-gray-100 dark:hover:bg-gray-700/80"
          title={isDark ? 'Use light theme' : 'Use dark theme'}
        >
          {isDark ? <Sun className="h-5 w-5 text-gray-400 hover:text-amber-500" /> : <Moon className="h-5 w-5 text-gray-500 hover:text-indigo-500" />}
        </button>
        <button
          onClick={logout}
          className="rounded-xl p-2.5 transition-all duration-200 hover:bg-red-50 dark:hover:bg-red-900/20"
          title="Sign Out"
        >
          <LogOut className="h-5 w-5 text-gray-500 hover:text-red-500 dark:text-gray-400" />
        </button>
        <div className="mx-2 h-8 w-px bg-gray-200 dark:bg-gray-700" />
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-violet-600 font-bold text-white shadow-lg ring-2 ring-cyan-500/20">
            {user?.avatar ? <img src={user.avatar} alt={user.name} className="h-full w-full rounded-xl object-cover" /> : user?.name?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div className="hidden md:block">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{user?.name || 'User'}</p>
            <p className="text-xs font-medium text-cyan-600 dark:text-cyan-400">Intelligence workspace</p>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
