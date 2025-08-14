import React, { createContext, useContext, useState, useEffect } from 'react';

interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  plan: 'free' | 'pro' | 'premium';
  role: 'user' | 'admin';
  createdAt: Date;
  lastLogin: Date;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  signup: (email: string, password: string, name: string) => Promise<boolean>;
  logout: () => void;
  updateProfile: (updates: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing session
    const savedUser = localStorage.getItem('traderslounge_user');
    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        setUser({
          ...userData,
          createdAt: new Date(userData.createdAt),
          lastLogin: new Date(userData.lastLogin),
        });
      } catch (error) {
        console.error('Failed to parse saved user data:', error);
        localStorage.removeItem('traderslounge_user');
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Test login credentials
      let mockUser: User;
      
      if (email === 'admin@traderslounge.com' && password === 'admin123') {
        mockUser = {
          id: 'admin_001',
          email,
          name: 'Admin User',
          plan: 'premium',
          role: 'admin',
          createdAt: new Date(),
          lastLogin: new Date(),
        };
      } else if (email === 'demo@trader.com' && password === 'demo123') {
        mockUser = {
          id: 'user_001',
          email,
          name: 'Demo Trader',
          plan: 'pro',
          role: 'user',
          createdAt: new Date(),
          lastLogin: new Date(),
        };
      } else if (email === 'test@test.com' && password === 'test123') {
        mockUser = {
          id: 'user_002',
          email,
          name: 'Test User',
          plan: 'free',
          role: 'user',
          createdAt: new Date(),
          lastLogin: new Date(),
        };
      } else {
        // Generic user for any other email/password
        mockUser = {
          id: Date.now().toString(),
          email,
          name: email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1),
          plan: 'pro',
          role: 'user',
          createdAt: new Date(),
          lastLogin: new Date(),
        };
      }
      
      setUser(mockUser);
      localStorage.setItem('traderslounge_user', JSON.stringify(mockUser));
      return true;
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const signup = async (email: string, password: string, name: string): Promise<boolean> => {
    setIsLoading(true);
    
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Mock user creation
      const newUser: User = {
        id: Date.now().toString(),
        email,
        name,
        plan: 'free',
        role: 'user',
        createdAt: new Date(),
        lastLogin: new Date(),
      };
      
      setUser(newUser);
      localStorage.setItem('traderslounge_user', JSON.stringify(newUser));
      return true;
    } catch (error) {
      console.error('Signup failed:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('traderslounge_user');
    localStorage.removeItem('broker_credentials');
  };

  const updateProfile = (updates: Partial<User>) => {
    if (user) {
      const updatedUser = { ...user, ...updates };
      setUser(updatedUser);
      localStorage.setItem('traderslounge_user', JSON.stringify(updatedUser));
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoading,
      login,
      signup,
      logout,
      updateProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};