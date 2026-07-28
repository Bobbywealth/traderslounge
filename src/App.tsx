import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import LandingPage from './pages/LandingPage';
import Dashboard from './pages/Dashboard';
import TradingTable from './pages/TradingTable';
import TradingView from './pages/TradingView';
import AdminDashboard from './pages/AdminDashboard';
import Calendar from './pages/Calendar';
import Signals from './pages/Signals';
import Education from './pages/Education';
import Community from './pages/Community';
import LiveScanner from './pages/LiveScanner';
import Positions from './pages/Positions';
import Journal from './pages/Journal';
import Backtester from './pages/Backtester';
import Settings from './pages/Settings';
import AIAssistant from './components/AIAssistant';
import { ThemeProvider } from './contexts/ThemeContext';
import { BrokerProvider } from './contexts/BrokerContext';
import ErrorBoundary from './components/ErrorBoundary';

const AppContent: React.FC = () => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isTradingWorkspace = location.pathname === '/tradingview';
  const effectiveSidebarCollapsed = isTradingWorkspace || sidebarCollapsed;

  useEffect(() => {
    if (!isTradingWorkspace) return;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [isTradingWorkspace]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-pulse">
            <TrendingUp className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">TradersLounge</h2>
          <p className="text-gray-600 dark:text-gray-400">Loading your trading dashboard...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LandingPage />;
  }

  // Admin users get redirected to admin dashboard
  if (user?.role === 'admin') {
    return (
      <AdminDashboard />
    );
  }

  return (
    <BrokerProvider>
      <div className="flex h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-200">
        <Sidebar
          collapsed={effectiveSidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        
        <div className={`flex-1 min-w-0 h-screen overflow-hidden flex flex-col transition-all duration-300 ${
          effectiveSidebarCollapsed ? 'ml-16' : 'ml-72'
        }`}>
          {!isTradingWorkspace && <Header />}
          
          <main className={`flex-1 min-w-0 min-h-0 bg-gray-50 dark:bg-gray-900 ${
            isTradingWorkspace ? 'overflow-hidden' : 'overflow-auto'
          }`}>
            <div className={isTradingWorkspace ? 'h-full min-w-0 min-h-0 overflow-hidden p-0' : 'p-6'}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/scanner" element={<LiveScanner />} />
                <Route path="/signals" element={<Signals />} />
                <Route path="/positions" element={<Positions />} />
                <Route path="/journal" element={<Journal />} />
                <Route path="/backtester" element={<Backtester />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/trades" element={<TradingTable />} />
                <Route path="/tradingview" element={<TradingView />} />
                <Route path="/calendar" element={<Calendar />} />
                <Route path="/education" element={<Education />} />
                <Route path="/community" element={<Community />} />
              </Routes>
            </div>
          </main>
        </div>
        
        {!isTradingWorkspace && <AIAssistant />}
      </div>
    </BrokerProvider>
  );
};

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ErrorBoundary>
          <Router>
            <AppContent />
          </Router>
        </ErrorBoundary>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;