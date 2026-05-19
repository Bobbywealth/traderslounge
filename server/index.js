import express from 'express';
import cors from 'cors';
import { tradeLockerRouter } from './routes/tradelocker.js';
import { signalsRouter } from './routes/signals.js';

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

const defaultAllowedOrigins = [
  'https://traderslounge.onrender.com',
  'http://localhost:5173',
  'http://localhost:3000'
];

const envAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = (envAllowedOrigins?.length ? envAllowedOrigins : defaultAllowedOrigins)
  .filter((origin) => origin !== '*');

const localDevOrigins = isProduction
  ? []
  : [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:3000'
    ];

const activeAllowedOrigins = [...new Set([...allowedOrigins, ...localDevOrigins])];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (activeAllowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/tradelocker', tradeLockerRouter);
app.use('/api/signals', signalsRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred'
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 TradersLounge API Server running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   CORS allowed origins: ${activeAllowedOrigins.join(', ') || 'none'}`);
});

export default app;
