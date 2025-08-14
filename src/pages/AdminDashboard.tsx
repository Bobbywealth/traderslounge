import React, { useState, useEffect } from 'react';
import { 
  Users, 
  DollarSign, 
  TrendingUp, 
  Activity, 
  UserCheck, 
  UserX, 
  Crown, 
  Shield,
  BarChart3,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Clock,
  Search,
  Filter,
  Download,
  Settings,
  Mail,
  Phone,
  MapPin,
  LogOut,
  Bell,
  Sun,
  Moon,
  Menu,
  X,
  Home,
  CreditCard,
  FileText,
  MessageSquare,
  Zap,
  Globe,
  Database,
  Lock,
  Eye,
  Edit,
  Trash2,
  Plus,
  RefreshCw
} from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';

interface AdminUser {
  id: string;
  name: string;
  email: string;
  plan: 'free' | 'pro' | 'premium';
  status: 'active' | 'inactive' | 'suspended';
  joinDate: Date;
  lastLogin: Date;
  revenue: number;
  trades: number;
  country: string;
  avatar?: string;
  phone?: string;
  lastActivity: string;
}

interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  totalRevenue: number;
  monthlyRevenue: number;
  totalTrades: number;
  conversionRate: number;
  churnRate: number;
  avgRevenuePerUser: number;
}

interface RevenueData {
  month: string;
  revenue: number;
  users: number;
}

const AdminDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<AdminStats>({
    totalUsers: 0,
    activeUsers: 0,
    totalRevenue: 0,
    monthlyRevenue: 0,
    totalTrades: 0,
    conversionRate: 0,
    churnRate: 0,
    avgRevenuePerUser: 0,
  });
  const [revenueData, setRevenueData] = useState<RevenueData[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'suspended'>('all');
  const [planFilter, setPlanFilter] = useState<'all' | 'free' | 'pro' | 'premium'>('all');
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const usersPerPage = 10;

  useEffect(() => {
    loadMockData();
  }, []);

  const loadMockData = () => {
    // Enhanced mock users data
    const mockUsers: AdminUser[] = [
      {
        id: '1',
        name: 'John Smith',
        email: 'john@example.com',
        plan: 'premium',
        status: 'active',
        joinDate: new Date('2024-01-15'),
        lastLogin: new Date(),
        revenue: 1188,
        trades: 245,
        country: 'United States',
        avatar: 'https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&w=100',
        phone: '+1-555-0123',
        lastActivity: '2 minutes ago'
      },
      {
        id: '2',
        name: 'Sarah Johnson',
        email: 'sarah@example.com',
        plan: 'pro',
        status: 'active',
        joinDate: new Date('2024-02-01'),
        lastLogin: new Date(Date.now() - 2 * 60 * 60 * 1000),
        revenue: 348,
        trades: 89,
        country: 'United Kingdom',
        phone: '+44-20-7946-0958',
        lastActivity: '2 hours ago'
      },
      {
        id: '3',
        name: 'Mike Chen',
        email: 'mike@example.com',
        plan: 'free',
        status: 'active',
        joinDate: new Date('2024-02-10'),
        lastLogin: new Date(Date.now() - 24 * 60 * 60 * 1000),
        revenue: 0,
        trades: 12,
        country: 'Canada',
        phone: '+1-416-555-0199',
        lastActivity: '1 day ago'
      },
      {
        id: '4',
        name: 'Emma Wilson',
        email: 'emma@example.com',
        plan: 'pro',
        status: 'inactive',
        joinDate: new Date('2024-01-20'),
        lastLogin: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        revenue: 174,
        trades: 34,
        country: 'Australia',
        phone: '+61-2-9374-4000',
        lastActivity: '7 days ago'
      },
      {
        id: '5',
        name: 'David Rodriguez',
        email: 'david@example.com',
        plan: 'premium',
        status: 'suspended',
        joinDate: new Date('2024-01-05'),
        lastLogin: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        revenue: 594,
        trades: 156,
        country: 'Spain',
        phone: '+34-91-123-4567',
        lastActivity: '14 days ago'
      },
      // Add more mock users...
      ...Array.from({ length: 45 }, (_, i) => ({
        id: `user_${i + 6}`,
        name: `User ${i + 6}`,
        email: `user${i + 6}@example.com`,
        plan: ['free', 'pro', 'premium'][Math.floor(Math.random() * 3)] as 'free' | 'pro' | 'premium',
        status: ['active', 'inactive', 'suspended'][Math.floor(Math.random() * 3)] as 'active' | 'inactive' | 'suspended',
        joinDate: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000),
        lastLogin: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
        revenue: Math.floor(Math.random() * 2000),
        trades: Math.floor(Math.random() * 500),
        country: ['United States', 'United Kingdom', 'Canada', 'Australia', 'Germany', 'France'][Math.floor(Math.random() * 6)],
        phone: `+1-555-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
        lastActivity: `${Math.floor(Math.random() * 30)} days ago`
      }))
    ];

    const mockStats: AdminStats = {
      totalUsers: 12847,
      activeUsers: 8934,
      totalRevenue: 284750,
      monthlyRevenue: 45230,
      totalTrades: 156789,
      conversionRate: 23.5,
      churnRate: 4.2,
      avgRevenuePerUser: 22.15,
    };

    const mockRevenueData: RevenueData[] = [
      { month: 'Jan', revenue: 35000, users: 8500 },
      { month: 'Feb', revenue: 38000, users: 9200 },
      { month: 'Mar', revenue: 42000, users: 10100 },
      { month: 'Apr', revenue: 45000, users: 11000 },
      { month: 'May', revenue: 48000, users: 11800 },
      { month: 'Jun', revenue: 52000, users: 12500 },
    ];

    setUsers(mockUsers);
    setStats(mockStats);
    setRevenueData(mockRevenueData);
  };

  const filteredUsers = users.filter(user => {
    const matchesSearch = user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         user.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || user.status === statusFilter;
    const matchesPlan = planFilter === 'all' || user.plan === planFilter;
    
    return matchesSearch && matchesStatus && matchesPlan;
  });

  const paginatedUsers = filteredUsers.slice(
    (currentPage - 1) * usersPerPage,
    currentPage * usersPerPage
  );

  const totalPages = Math.ceil(filteredUsers.length / usersPerPage);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300';
      case 'inactive':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
      case 'suspended':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
    }
  };

  const getPlanColor = (plan: string) => {
    switch (plan) {
      case 'premium':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300';
      case 'pro':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
      case 'free':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
    }
  };

  const getPlanIcon = (plan: string) => {
    switch (plan) {
      case 'premium':
        return <Crown className="w-4 h-4" />;
      case 'pro':
        return <Shield className="w-4 h-4" />;
      default:
        return <Users className="w-4 h-4" />;
    }
  };

  const handleUserAction = (action: string, userId: string) => {
    console.log(`${action} user:`, userId);
    // Implement user actions
  };

  const handleBulkAction = (action: string) => {
    console.log(`Bulk ${action}:`, selectedUsers);
    // Implement bulk actions
  };

  const sidebarItems = [
    { id: 'overview', label: 'Overview', icon: Home },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'revenue', label: 'Revenue', icon: DollarSign },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'subscriptions', label: 'Subscriptions', icon: CreditCard },
    { id: 'support', label: 'Support', icon: MessageSquare },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">+12.5%</span>
          </div>
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
            {stats.totalUsers.toLocaleString()}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">Total Users</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
              <UserCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">+8.2%</span>
          </div>
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
            {stats.activeUsers.toLocaleString()}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">Active Users</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-lg">
              <DollarSign className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">+15.3%</span>
          </div>
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
            ${stats.totalRevenue.toLocaleString()}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">Total Revenue</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <TrendingUp className="w-6 h-6 text-purple-600 dark:text-purple-400" />
            </div>
            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">+{stats.conversionRate}%</span>
          </div>
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
            {stats.conversionRate}%
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">Conversion Rate</p>
        </div>
      </div>

      {/* Additional Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold text-gray-900 dark:text-white">Monthly Revenue</h4>
            <TrendingUp className="w-5 h-5 text-emerald-500" />
          </div>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">${stats.monthlyRevenue.toLocaleString()}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">This month</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold text-gray-900 dark:text-white">Churn Rate</h4>
            <AlertTriangle className="w-5 h-5 text-orange-500" />
          </div>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">{stats.churnRate}%</p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">Monthly churn</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold text-gray-900 dark:text-white">ARPU</h4>
            <DollarSign className="w-5 h-5 text-blue-500" />
          </div>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">${stats.avgRevenuePerUser}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">Avg revenue per user</p>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Recent Activity</h3>
        <div className="space-y-4">
          {users.slice(0, 5).map((user) => (
            <div key={user.id} className="flex items-center justify-between py-2">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center text-white text-sm font-semibold">
                  {user.name.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{user.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Last active: {user.lastActivity}</p>
                </div>
              </div>
              <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getPlanColor(user.plan)}`}>
                {user.plan}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderUsers = () => (
    <div className="space-y-6">
      {/* Filters and Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0 md:space-x-4">
          <div className="flex items-center space-x-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            </div>
            
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>

            <select
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value as any)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            >
              <option value="all">All Plans</option>
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="premium">Premium</option>
            </select>
          </div>

          <div className="flex items-center space-x-2">
            {selectedUsers.length > 0 && (
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleBulkAction('email')}
                  className="flex items-center space-x-2 px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors duration-200"
                >
                  <Mail className="w-4 h-4" />
                  <span>Email ({selectedUsers.length})</span>
                </button>
                <button
                  onClick={() => handleBulkAction('suspend')}
                  className="flex items-center space-x-2 px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors duration-200"
                >
                  <UserX className="w-4 h-4" />
                  <span>Suspend</span>
                </button>
              </div>
            )}
            <button className="flex items-center space-x-2 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors duration-200">
              <Plus className="w-4 h-4" />
              <span>Add User</span>
            </button>
            <button className="flex items-center space-x-2 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors duration-200">
              <Download className="w-4 h-4" />
              <span>Export</span>
            </button>
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            User Management ({filteredUsers.length} users)
          </h3>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="px-6 py-3 text-left">
                  <input
                    type="checkbox"
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedUsers(paginatedUsers.map(u => u.id));
                      } else {
                        setSelectedUsers([]);
                      }
                    }}
                    className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Plan
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Revenue
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Trades
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Last Login
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {paginatedUsers.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors duration-200">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={selectedUsers.includes(user.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedUsers([...selectedUsers, user.id]);
                        } else {
                          setSelectedUsers(selectedUsers.filter(id => id !== user.id));
                        }
                      }}
                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center text-white font-semibold mr-4">
                        {user.avatar ? (
                          <img src={user.avatar} alt={user.name} className="w-10 h-10 rounded-full" />
                        ) : (
                          user.name.charAt(0)
                        )}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {user.name}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {user.email}
                        </div>
                        <div className="flex items-center text-xs text-gray-400 mt-1">
                          <MapPin className="w-3 h-3 mr-1" />
                          {user.country}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full ${getPlanColor(user.plan)}`}>
                      {getPlanIcon(user.plan)}
                      <span className="ml-1 capitalize">{user.plan}</span>
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(user.status)}`}>
                      {user.status === 'active' && <CheckCircle className="w-3 h-3 mr-1" />}
                      {user.status === 'inactive' && <Clock className="w-3 h-3 mr-1" />}
                      {user.status === 'suspended' && <AlertTriangle className="w-3 h-3 mr-1" />}
                      {user.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                    ${user.revenue.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {user.trades.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {format(user.lastLogin, 'MMM d, yyyy HH:mm')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex items-center space-x-2">
                      <button 
                        onClick={() => handleUserAction('view', user.id)}
                        className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                        title="View User"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleUserAction('edit', user.id)}
                        className="text-emerald-600 hover:text-emerald-900 dark:text-emerald-400 dark:hover:text-emerald-300"
                        title="Edit User"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleUserAction('email', user.id)}
                        className="text-purple-600 hover:text-purple-900 dark:text-purple-400 dark:hover:text-purple-300"
                        title="Send Email"
                      >
                        <Mail className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleUserAction('suspend', user.id)}
                        className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                        title="Suspend User"
                      >
                        <UserX className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-700 dark:text-gray-300">
              Showing {((currentPage - 1) * usersPerPage) + 1} to {Math.min(currentPage * usersPerPage, filteredUsers.length)} of {filteredUsers.length} results
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'overview':
        return renderOverview();
      case 'users':
        return renderUsers();
      case 'revenue':
        return <div className="text-center py-12 text-gray-500">Revenue analytics coming soon...</div>;
      case 'analytics':
        return <div className="text-center py-12 text-gray-500">Advanced analytics coming soon...</div>;
      case 'subscriptions':
        return <div className="text-center py-12 text-gray-500">Subscription management coming soon...</div>;
      case 'support':
        return <div className="text-center py-12 text-gray-500">Support tickets coming soon...</div>;
      case 'settings':
        return <div className="text-center py-12 text-gray-500">Admin settings coming soon...</div>;
      default:
        return renderOverview();
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-64' : 'w-16'} bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transition-all duration-300 flex flex-col`}>
        {/* Logo */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            {sidebarOpen && (
              <div>
                <h1 className="text-lg font-bold text-gray-900 dark:text-white">TradersLounge</h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">Admin Panel</p>
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4">
          <div className="space-y-2">
            {sidebarItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ${
                    activeTab === item.id
                      ? 'bg-emerald-500 text-white'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {sidebarOpen && <span>{item.label}</span>}
                </button>
              );
            })}
          </div>
        </nav>

        {/* User Profile */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center text-white font-semibold text-sm">
              {user?.name?.charAt(0) || 'A'}
            </div>
            {sidebarOpen && (
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-white">{user?.name || 'Admin'}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Administrator</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200"
              >
                <Menu className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              </button>
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white capitalize">
                  {activeTab}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Manage your trading platform
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <button className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200">
                <RefreshCw className="w-5 h-5 text-gray-500 dark:text-gray-400" />
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

              <button
                onClick={logout}
                className="flex items-center space-x-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors duration-200"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-6 overflow-auto">
          {renderContent()}
        </main>
      </div>
    </div>
  );
};

export default AdminDashboard;