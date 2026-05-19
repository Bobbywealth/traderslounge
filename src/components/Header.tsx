import React from 'react';
import { Bell, Settings, Sun, Moon, Link, Rss, LogOut, Zap } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import BrokerSetup from './BrokerSetup';
import ApiConfiguration from './ApiConfiguration';
import { useBroker } from '../contexts/BrokerContext';

const Header: React.FC = () => {
  const { isDark, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const { credentials } = useBroker();
  const [showBrokerSetup, setShowBrokerSetup] = React.useState(false);
  const [showApiConfig, setShowApiConfig] = React.useState(false);

  return (
    <>
      <header className="h-16 glass dark:glass-dark border-b border-gray-200/50 dark:border-gray-700/50 flex items-center justify-between px-6 backdrop-blur-xl">
        <div className="flex items-center space-x-4">
          {/* Logo / Brand */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center shadow-lg">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              Welcome back, <span className="gradient-text">{user?.name || 'Trader'}</span>
            </h2>
          </div>
          
          {credentials.length > 0 && (
            <div className="flex items-center space-x-2">
              <div className="relative">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                <div className="absolute inset-0 w-2 h-2 bg-emerald-400 rounded-full animate-ping opacity-75"></div>
              </div>
              <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">
                {credentials.length} broker{credentials.length !== 1 ? 's' : ''} connected
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={() => setShowApiConfig(true)}
            className="p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700/80 transition-all duration-200 group"
            title="API Configuration"
          >
            <Rss className="w-5 h-5 text-gray-500 dark:text-gray-400 group-hover:text-emerald-500 transition-colors" />
          </button>
          
          <button
            onClick={() => setShowBrokerSetup(true)}
            className="p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700/80 transition-all duration-200 group"
            title="Broker Connections"
          >
            <Link className="w-5 h-5 text-gray-500 dark:text-gray-400 group-hover:text-emerald-500 transition-colors" />
          </button>
          
          <button
            onClick={toggleTheme}
            className="p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700/80 transition-all duration-200 group"
          >
            {isDark ? (
              <Sun className="w-5 h-5 text-gray-400 group-hover:text-amber-500 transition-colors" />
            ) : (
              <Moon className="w-5 h-5 text-gray-500 group-hover:text-indigo-500 transition-colors" />
            )}
          </button>
          
          <div className="relative">
            <button className="p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700/80 transition-all duration-200 group">
              <Bell className="w-5 h-5 text-gray-500 dark:text-gray-400 group-hover:text-red-500 transition-colors" />
            </button>
            <div className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white dark:border-gray-800 animate-pulse"></div>
          </div>

          <button className="p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700/80 transition-all duration-200 group">
            <Settings className="w-5 h-5 text-gray-500 dark:text-gray-400 group-hover:text-emerald-500 transition-colors" />
          </button>
          
          <button
            onClick={logout}
            className="p-2.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-200 group"
            title="Sign Out"
          >
            <LogOut className="w-5 h-5 text-gray-500 dark:text-gray-400 group-hover:text-red-500 transition-colors" />
          </button>

          <div className="h-8 w-px bg-gray-200 dark:bg-gray-700 mx-2"></div>

          {/* User Avatar */}
          <div className="flex items-center space-x-3">
            <div className="relative">
              <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-lg ring-2 ring-emerald-500/20">
                {user?.avatar ? (
                  <img src={user.avatar} alt={user.name} className="w-full h-full rounded-xl object-cover" />
                ) : (
                  <span className="text-white font-bold text-sm">
                    {user?.name?.charAt(0).toUpperCase() || 'U'}
                  </span>
                )}
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-gray-800"></div>
            </div>
            <div className="hidden md:block">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">{user?.name || 'User'}</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium capitalize">{user?.plan || 'Free'} Plan</p>
            </div>
          </div>
        </div>
      </header>
      
      <BrokerSetup 
        isOpen={showBrokerSetup} 
        onClose={() => setShowBrokerSetup(false)} 
      />
      
      <ApiConfiguration 
        isOpen={showApiConfig} 
        onClose={() => setShowApiConfig(false)} 
      />
    </>
  );
};

export default Header;
