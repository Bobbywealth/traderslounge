import React from 'react';
import { Bell, Settings, Sun, Moon, Link, Rss, LogOut } from 'lucide-react';
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
      <header className="h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-6">
        <div className="flex items-center space-x-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Welcome back, {user?.name || 'Trader'}
          </h2>
          {credentials.length > 0 && (
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {credentials.length} broker{credentials.length !== 1 ? 's' : ''} connected
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowApiConfig(true)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200"
            title="API Configuration"
          >
            <Rss className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
          
          <button
            onClick={() => setShowBrokerSetup(true)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200"
            title="Broker Connections"
          >
            <Link className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
          
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200"
          >
            {isDark ? (
              <Sun className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            ) : (
              <Moon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            )}
          </button>
          
          <div className="relative">
            <button className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200">
              <Bell className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full"></div>
          </div>

          <button className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200">
            <Settings className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
          
          <button
            onClick={logout}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200"
            title="Sign Out"
          >
            <LogOut className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>

          <div className="flex items-center space-x-3 pl-4 border-l border-gray-200 dark:border-gray-700">
            <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center">
              {user?.avatar ? (
                <img src={user.avatar} alt={user.name} className="w-8 h-8 rounded-full" />
              ) : (
                <span className="text-white font-semibold text-sm">
                  {user?.name?.charAt(0).toUpperCase() || 'U'}
                </span>
              )}
            </div>
            <div className="hidden md:block">
              <p className="text-sm font-medium text-gray-900 dark:text-white">{user?.name || 'User'}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{user?.plan || 'Free'} Plan</p>
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