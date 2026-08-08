/**
 * Hook for monitoring backend health status.
 * 
 * Features:
 * - Periodic health checks
 * - Automatic retry on failure
 * - Connection status tracking
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../services/apiClient';

interface HealthStatus {
  status: 'ok' | 'degraded' | 'error' | 'unknown';
  latencyMs: number;
  lastChecked: Date | null;
  error: string | null;
}

interface UseHealthCheckOptions {
  intervalMs?: number;
  enabled?: boolean;
  onStatusChange?: (status: HealthStatus) => void;
}

interface UseHealthCheckReturn {
  status: HealthStatus;
  check: () => Promise<void>;
  isChecking: boolean;
}

export function useHealthCheck({
  intervalMs = 30000, // Check every 30 seconds
  enabled = true,
  onStatusChange,
}: UseHealthCheckOptions = {}): UseHealthCheckReturn {
  const [status, setStatus] = useState<HealthStatus>({
    status: 'unknown',
    latencyMs: 0,
    lastChecked: null,
    error: null,
  });
  const [isChecking, setIsChecking] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout>();
  const mountedRef = useRef(true);
  
  // Check health
  const check = useCallback(async () => {
    if (isChecking || !mountedRef.current) return;
    
    setIsChecking(true);
    const startTime = Date.now();
    
    try {
      const response = await apiClient.get('/health', undefined, { timeout: 5000 });
      const latencyMs = Date.now() - startTime;
      
      const newStatus: HealthStatus = {
        status: response.status === 'ok' ? 'ok' : 'degraded',
        latencyMs,
        lastChecked: new Date(),
        error: null,
      };
      
      if (mountedRef.current) {
        setStatus(newStatus);
        onStatusChange?.(newStatus);
      }
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Health check failed';
      
      const newStatus: HealthStatus = {
        status: 'error',
        latencyMs,
        lastChecked: new Date(),
        error: errorMessage,
      };
      
      if (mountedRef.current) {
        setStatus(newStatus);
        onStatusChange?.(newStatus);
      }
    } finally {
      if (mountedRef.current) {
        setIsChecking(false);
      }
    }
  }, [isChecking, onStatusChange]);
  
  // Set up periodic checks
  useEffect(() => {
    if (!enabled) return;
    
    // Initial check
    check();
    
    // Set up interval
    intervalRef.current = setInterval(check, intervalMs);
    
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [enabled, intervalMs, check]);
  
  return {
    status,
    check,
    isChecking,
  };
}

/**
 * Component to display health status
 */
export function HealthIndicator({ status }: { status: HealthStatus }) {
  const getStatusColor = () => {
    switch (status.status) {
      case 'ok':
        return 'bg-green-500';
      case 'degraded':
        return 'bg-yellow-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };
  
  const getStatusText = () => {
    switch (status.status) {
      case 'ok':
        return `Healthy (${status.latencyMs}ms)`;
      case 'degraded':
        return `Degraded (${status.latencyMs}ms)`;
      case 'error':
        return `Error: ${status.error}`;
      default:
        return 'Unknown';
    }
  };
  
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
      <span className="text-gray-400">{getStatusText()}</span>
    </div>
  );
}
