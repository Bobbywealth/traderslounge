import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Header from './Header';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Bell: () => <div data-testid="bell-icon">Bell</div>,
  Settings: () => <div data-testid="settings-icon">Settings</div>,
  Sun: () => <div data-testid="sun-icon">Sun</div>,
  Moon: () => <div data-testid="moon-icon">Moon</div>,
  Link: () => <div data-testid="link-icon">Link</div>,
  Rss: () => <div data-testid="rss-icon">Rss</div>,
  LogOut: () => <div data-testid="logout-icon">LogOut</div>,
  Zap: () => <div data-testid="zap-icon">Zap</div>,
}));

// Mock ThemeContext
const mockToggleTheme = vi.fn();
const mockIsDark = true;
vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({
    isDark: mockIsDark,
    toggleTheme: mockToggleTheme,
  }),
}));

// Mock AuthContext
const mockUser = { id: '1', name: 'Test User', email: 'test@test.com' };
const mockLogout = vi.fn();
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    logout: mockLogout,
  }),
}));

// Mock BrokerContext
vi.mock('../contexts/BrokerContext', () => ({
  useBroker: () => ({
    credentials: { hasCredentials: false },
  }),
}));

// Mock sub-components
vi.mock('./BrokerSetup', () => ({
  default: () => <div data-testid="broker-setup">BrokerSetup</div>,
}));

vi.mock('./ApiConfiguration', () => ({
  default: () => <div data-testid="api-configuration">ApiConfiguration</div>,
}));

describe('Header Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>
    );
  });

  it('displays welcome message with user name', () => {
    render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>
    );
    expect(screen.getByText(/Welcome back/)).toBeTruthy();
  });

  it('displays the logo', () => {
    render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>
    );
    expect(screen.getByTestId('zap-icon')).toBeTruthy();
  });
});
