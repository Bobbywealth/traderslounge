import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import PwaSplash from './components/PwaSplash';
import PwaLoginScreen from './components/PwaLoginScreen';
import InstallPwaPrompt from './components/InstallPwaPrompt';
import OnboardingWizard from './components/OnboardingWizard';
import LandingPage from './pages/LandingPage';
import { ThemeProvider } from './contexts/ThemeContext';
import { BrokerProvider } from './contexts/BrokerContext';
import ErrorBoundary from './components/ErrorBoundary';
import { NotificationProvider } from './contexts/NotificationContext';

/**
 * Every route below the landing page is split out of the entry bundle.
 * Importing all ~30 pages eagerly put every route's code (plus recharts and
 * lightweight-charts) into a single 650 kB chunk that every visitor
 * downloaded, including people who only ever saw the marketing page.
 *
 * LandingPage and the app shell stay eager because they are the first paint.
 * `RouteFallback` keeps the Suspense boundary from flashing a blank screen.
 */
const Dashboard = lazy(() => import('./pages/Dashboard'));
const CommandCenter = lazy(() => import('./pages/CommandCenter'));
const TradingTable = lazy(() => import('./pages/TradingTable'));
const TradingView = lazy(() => import('./pages/TradingView'));
const TradingViewWidget = lazy(() => import('./pages/TradingViewWidget'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const EconomicNews = lazy(() => import('./pages/EconomicNews'));
const Signals = lazy(() => import('./pages/Signals'));
const Education = lazy(() => import('./pages/Education'));
const Docs = lazy(() => import('./pages/Docs'));
const Community = lazy(() => import('./pages/Community'));
const LiveScanner = lazy(() => import('./pages/LiveScanner'));
const MarketAnalysis = lazy(() => import('./pages/MarketAnalysis'));
const Debate = lazy(() => import('./pages/Debate'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Positions = lazy(() => import('./pages/Positions'));
const Journal = lazy(() => import('./pages/Journal'));
const Backtester = lazy(() => import('./pages/Backtester'));
const Performance = lazy(() => import('./pages/Performance'));
const Calibration = lazy(() => import('./pages/Calibration'));
const PortfolioRisk = lazy(() => import('./pages/PortfolioRisk'));
const Settings = lazy(() => import('./pages/Settings'));
const TradingDesk = lazy(() => import('./pages/TradingDesk'));
const AIAssistant = lazy(() => import('./components/AIAssistant'));

function RouteFallback() {
  return (
    <div
      className="flex items-center justify-center min-h-[60vh]"
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      <span className="text-sm text-slate-400">Loading…</span>
    </div>
  );
}

/**
 * Returns true when the app is running as an installed PWA
 * (display-mode: standalone on Chrome/Edge/Android, or navigator.standalone
 * on iOS Safari). Used by AppContent to decide whether to send the user
 * straight to the focused PwaLoginScreen instead of the marketing landing.
 */
function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  // Allow a `?standalone=1` query string to force the PWA login branch
  // for QA / preview without installing the app. Also matches ?source=pwa
  // and ?source=shortcut which are emitted by the manifest start_url and
  // shortcuts — the user always opens the installed app from one of those.
  const search = window.location.search;
  if (/(?:^|[?&])standalone=1\b/.test(search)) return true;
  if (/(?:^|[?&])source=pwa\b/.test(search)) return true;
  if (/(?:^|[?&])source=shortcut\b/.test(search)) return true;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    nav.standalone === true
  );
}

const AppContent: React.FC = () => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : true,
  );
  const isTradingWorkspace =
    location.pathname === '/tradingview' || location.pathname === '/tradingview-widget';
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
    return <PwaSplash message="Restoring your workspace…" />;
  }

  if (!isAuthenticated) {
    return isStandalonePwa() ? <PwaLoginScreen /> : <LandingPage />;
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
              <Suspense fallback={<RouteFallback />}>
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
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/positions" element={<Positions />} />
                <Route path="/journal" element={<Journal />} />
                <Route path="/backtester" element={<Backtester />} />
                <Route path="/performance" element={<Performance />} />
                <Route path="/calibration" element={<Calibration />} />
                <Route path="/portfolio" element={<PortfolioRisk />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/trading-desk" element={<TradingDesk />} />
                <Route path="/trades" element={<TradingTable />} />
                <Route path="/tradingview" element={<TradingView />} />
                <Route path="/tradingview-widget" element={<TradingViewWidget />} />
                <Route path="/calendar" element={<EconomicNews />} />
                <Route path="/economic-news" element={<Navigate to="/calendar" replace />} />
                <Route path="/education" element={<Education />} />
                <Route path="/docs" element={<Docs />} />
                <Route path="/community" element={<Community />} />
                </Routes>
              </Suspense>
            </div>
          </main>
          {isAuthenticated && <OnboardingWizard />}
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
              <InstallPwaPrompt />
            </NotificationProvider>
          </Router>
        </ErrorBoundary>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;