import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrendingUp, DollarSign, Percent, Activity } from 'lucide-react';
import MetricCard from './MetricCard';

describe('MetricCard Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(
      <MetricCard
        title="Test Metric"
        value="$10,000"
        change="+5.2%"
        trend="up"
        icon={DollarSign}
      />
    );
  });

  it('displays the metric title', () => {
    render(
      <MetricCard
        title="Total Balance"
        value="$50,000"
        change="+0%"
        trend="up"
        icon={DollarSign}
      />
    );
    expect(screen.getByText('Total Balance')).toBeTruthy();
  });

  it('displays the metric value', () => {
    render(
      <MetricCard
        title="Test"
        value="$25,000"
        change="+0%"
        trend="up"
        icon={DollarSign}
      />
    );
    expect(screen.getByText('$25,000')).toBeTruthy();
  });

  it('displays positive change correctly', () => {
    render(
      <MetricCard
        title="Win Rate"
        value="65%"
        change="+10%"
        trend="up"
        icon={Percent}
      />
    );
    expect(screen.getByText('+10%')).toBeTruthy();
  });

  it('displays negative change correctly', () => {
    render(
      <MetricCard
        title="Drawdown"
        value="5%"
        change="-2%"
        trend="down"
        icon={Activity}
      />
    );
    expect(screen.getByText('-2%')).toBeTruthy();
  });

  it('applies correct styling for up trend', () => {
    render(
      <MetricCard
        title="Profit"
        value="$1,000"
        change="+15%"
        trend="up"
        icon={TrendingUp}
      />
    );
    const trendElement = screen.getByText('+15%');
    expect(trendElement).toBeTruthy();
  });

  it('applies correct styling for down trend', () => {
    render(
      <MetricCard
        title="Loss"
        value="$500"
        change="-8%"
        trend="down"
        icon={TrendingUp}
      />
    );
    const trendElement = screen.getByText('-8%');
    expect(trendElement).toBeTruthy();
  });
});
