import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
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
import AIAssistant from './components/AIAssistant';
import { ThemeProvider } from './contexts/ThemeContext';
import { BrokerProvider } from './contexts/BrokerContext';
import ErrorBoundary from './components/ErrorBoundary';

const AppContent: React.FC = () => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
          collapsed={sidebarCollapsed} 
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} 
        />
        
        <div className={`flex-1 flex flex-col transition-all duration-300 ${
          sidebarCollapsed ? 'ml-16' : 'ml-72'
        }`}>
          <Header />
          
          <main className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900">
            <div className="p-6">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/trades" element={<TradingTable />} />
                <Route path="/tradingview" element={<TradingView />} />
                <Route path="/calendar" element={<Calendar />} />
                <Route path="/signals" element={<Signals />} />
                <Route path="/education" element={<Education />} />
                <Route path="/community" element={<Community />} />
              </Routes>
            </div>
          </main>
        </div>
        
        <AIAssistant />
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