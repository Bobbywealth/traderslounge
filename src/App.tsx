import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import ConfluenceXLogo from './components/ConfluenceXLogo';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import LandingPage from './pages/LandingPage';
import Dashboard from './pages/Dashboard';
import CommandCenter from './pages/CommandCenter';
import TradingTable from './pages/TradingTable';
import TradingView from './pages/TradingView';
import AdminDashboard from './pages/AdminDashboard';
import EconomicNews from './pages/EconomicNews';
import Signals from './pages/Signals';
import Education from './pages/Education';
import Community from './pages/Community';
import LiveScanner from './pages/LiveScanner';
import MarketAnalysis from './pages/MarketAnalysis';
import Debate from './pages/Debate';
import Alerts from './pages/Alerts';
import Positions from './pages/Positions';
import Journal from './pages/Journal';
import Backtester from './pages/Backtester';
import Performance from './pages/Performance';
import Settings from './pages/Settings';
import TradingDesk from './pages/TradingDesk';
import AIAssistant from './components/AIAssistant';
import { ThemeProvider } from './contexts/ThemeContext';
import { BrokerProvider } from './contexts/BrokerContext';
import ErrorBoundary from './components/ErrorBoundary';
import { NotificationProvider } from './contexts/NotificationContext';

const AppContent: React.FC = () => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : true,
  );
  const isTradingWorkspace = location.pathname === '/tradingview';
  const effectiveSidebarCollapsed = isTradingWorkspace || sidebarCollapsed;

  // Track viewport for responsive sidebar behavior. The desktop layout keeps
  // the persistent sidebar; the mobile layout hides it behind a hamburger.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(min-width: 768px)');
    const handler = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    setIsDesktop(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Close the mobile drawer whenever the route changes so navigating doesn't
  // leave a stale overlay covering the new page.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Allow Escape to dismiss the mobile drawer.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mobileMenuOpen]);

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
        <div className="text-center flex flex-col items-center">
          <ConfluenceXLogo size="lg" showTagline className="animate-pulse mb-5" />
          <p className="text-gray-600 dark:cx-text-faint">Loading market intelligence...</p>
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
          mode={isDesktop ? 'desktop' : 'overlay'}
          mobileOpen={mobileMenuOpen}
          onMobileClose={() => setMobileMenuOpen(false)}
        />

        <div className={`flex-1 min-w-0 h-screen overflow-hidden flex flex-col transition-all duration-300 ${
          isDesktop
            ? (effectiveSidebarCollapsed ? 'ml-16' : 'ml-72')
            : 'ml-0'
        }`}>
          {!isTradingWorkspace && (
            <Header
              showMenuButton={!isDesktop}
              onMenuToggle={() => setMobileMenuOpen((open) => !open)}
              menuOpen={mobileMenuOpen}
            />
          )}

          <main className={`flex-1 min-w-0 min-h-0 bg-gray-50 dark:bg-gray-900 ${
            isTradingWorkspace ? 'overflow-hidden' : 'overflow-auto'
          }`}>
            <div className={isTradingWorkspace ? 'h-full min-w-0 min-h-0 overflow-hidden p-0' : 'p-6'}>
              <Routes>
                <Route path="/" element={<CommandCenter />} />
                <Route path="/command-center" element={<Navigate to="/" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/scanner" element={<LiveScanner />} />
                <Route path="/signals" element={<Signals />} />
                <Route path="/debate" element={<Debate />} />
                <Route path="/debate/:pair" element={<Debate />} />
                <Route path="/analysis" element={<Navigate to="/tradingview?panel=full" replace />} />
                <Route path="/analysis/:pair" element={({ params }) => <Navigate to={`/tradingview?symbol=${String(params.pair).toUpperCase()}&panel=full`} replace />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/positions" element={<Positions />} />
                <Route path="/journal" element={<Journal />} />
                <Route path="/backtester" element={<Backtester />} />
                <Route path="/performance" element={<Performance />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/trading-desk" element={<TradingDesk />} />
                <Route path="/trades" element={<TradingTable />} />
                <Route path="/tradingview" element={<TradingView />} />
                <Route path="/calendar" element={<EconomicNews />} />
                <Route path="/economic-news" element={<Navigate to="/calendar" replace />} />
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
            <NotificationProvider>
              <AppContent />
            </NotificationProvider>
          </Router>
        </ErrorBoundary>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;