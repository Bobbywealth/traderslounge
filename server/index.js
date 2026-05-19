import express from 'express';
import cors from 'cors';
import { tradeLockerRouter } from './routes/tradelocker.js';
import { signalsRouter } from './routes/signals.js';
import { perplexityRouter } from './routes/perplexity.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: [
    'https://traderslounge.onrender.com',
    'http://localhost:5173',
    'http://localhost:3000'
  ],
  credentials: true
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/tradelocker', tradeLockerRouter);
app.use('/api/signals', signalsRouter);
app.use('/api/perplexity', perplexityRouter);

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
});

export default app;
