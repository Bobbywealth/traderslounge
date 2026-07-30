import React, { createContext, useContext, useState, useEffect } from 'react';
import { bwtsAuth, type BackendAuthUser } from '../services/bwtsApi';

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

const fromBackendUser = (raw: BackendAuthUser): User => ({
  id: String(raw.id),
  email: raw.email,
  name: raw.name || raw.email.split('@')[0],
  plan: (['free', 'pro', 'premium'].includes(raw.plan) ? raw.plan : 'free') as User['plan'],
  role: raw.role === 'admin' ? 'admin' : 'user',
  createdAt: new Date(),
  lastLogin: new Date(),
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      const savedUser = localStorage.getItem('traderslounge_user');
      if (!savedUser) {
        if (active) setIsLoading(false);
        return;
      }
      try {
        const userData = JSON.parse(savedUser);
        let restored = await bwtsAuth.restore();
        if (!restored && userData.email === 'demo@trader.com') {
          const backendUser = await bwtsAuth.login('demo@trader.com', 'demo123');
          if (backendUser) {
            const normalized = fromBackendUser(backendUser);
            localStorage.setItem('traderslounge_user', JSON.stringify(normalized));
            if (active) setUser(normalized);
            return;
          }
        }
        if (!restored) throw new Error('Session expired');
        if (active) setUser({
          ...userData,
          createdAt: new Date(userData.createdAt),
          lastLogin: new Date(userData.lastLogin),
        });
      } catch (error) {
        console.error('Failed to restore session:', error);
        bwtsAuth.clear();
        localStorage.removeItem('traderslounge_user');
        if (active) setUser(null);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    restore();
    return () => { active = false; };
  }, []);

  const login = async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    try {
      const backendUser = await bwtsAuth.login(email.trim().toLowerCase(), password);
      if (!backendUser) return false;
      const authenticatedUser = fromBackendUser(backendUser);
      setUser(authenticatedUser);
      localStorage.setItem('traderslounge_user', JSON.stringify(authenticatedUser));
      return true;
    } catch (error) {
      console.error('Login failed:', error);
      bwtsAuth.clear();
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const signup = async (email: string, password: string, name: string): Promise<boolean> => {
    setIsLoading(true);
    try {
      const backendUser = await bwtsAuth.signup(email.trim().toLowerCase(), password, name.trim());
      if (!backendUser) return false;
      const newUser = fromBackendUser(backendUser);
      setUser(newUser);
      localStorage.setItem('traderslounge_user', JSON.stringify(newUser));
      return true;
    } catch (error) {
      console.error('Signup failed:', error);
      bwtsAuth.clear();
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    bwtsAuth.clear();
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