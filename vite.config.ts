/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}', 'tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    // tests/load/*.js are k6 scripts (they import k6/http and k6), not Vitest
    // suites. The bare `tests/**/*.{js,...}` include was sweeping them in and
    // failing the run on an unresolvable `k6` import.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/load/**', 'loadtest/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/*.interface.*',
        '**/index.ts'
      ]
    }
  },
  define: {
    global: 'globalThis',
  },
  build: {
    rollupOptions: {
      output: {
        // Function form, not the object form. The object form declared
        // `vendor: ['react', 'react-dom']`, but react-router-dom pulls the
        // same react/react-dom modules in first, so they were claimed by the
        // `router` chunk and `vendor` was emitted as a 0-byte file
        // ("Generated an empty chunk: vendor"). Matching on the resolved
        // module id keeps react in its own long-lived chunk instead.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return 'vendor';
          }
          if (/[\\/]node_modules[\\/](recharts|d3-|victory-|lightweight-charts)/.test(id)) {
            return 'charts';
          }
          if (/[\\/]node_modules[\\/](react-router|react-router-dom|@remix-run)/.test(id)) {
            return 'router';
          }
          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) {
            return 'icons';
          }
          if (/[\\/]node_modules[\\/](date-fns)[\\/]/.test(id)) {
            return 'utils';
          }
          return undefined;
        }
      }
    },
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    }
  },
  server: {
    port: 5173,
    host: true
  },
  preview: {
    allowedHosts: ['traderslounge.onrender.com']
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
