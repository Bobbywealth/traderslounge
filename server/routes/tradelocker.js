import express from 'express';
import axios from 'axios';

const router = express.Router();

const DEMO_BASE_URL = 'https://demo.tradelocker.com/backend-api';
const LIVE_BASE_URL = 'https://live.tradelocker.com/backend-api';

// Store tokens in memory (in production, use secure session storage)
const tokenStore = new Map();

// Authenticate with TradeLocker
router.post('/auth', async (req, res) => {
  try {
    const { email, password, server, isDemo = true, sessionId } = req.body;
    const baseUrl = isDemo ? DEMO_BASE_URL : LIVE_BASE_URL;

    const response = await axios.post(
      `${baseUrl}/auth/jwt/token`,
      { email, password, server },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      }
    );

    // Store tokens associated with session
    if (sessionId) {
      tokenStore.set(sessionId, {
        accessToken: response.data.accessToken,
        refreshToken: response.data.refreshToken,
        baseUrl,
        expiresAt: Date.now() + (response.data.accessTokenExpiration * 1000)
      });
    }

    res.json(response.data);
  } catch (error) {
    console.error('TradeLocker auth error:', error.message);
    res.status(error.response?.status || 500).json({
      error: 'Authentication failed',
      message: error.response?.data?.message || error.message
    });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const tokens = tokenStore.get(sessionId);

    if (!tokens) {
      return res.status(401).json({ error: 'No session found' });
    }

    const response = await axios.post(
      `${tokens.baseUrl}/auth/jwt/refresh`,
      { refreshToken: tokens.refreshToken },
      { timeout: 30000 }
    );

    // Update stored tokens
    tokenStore.set(sessionId, {
      ...tokens,
      accessToken: response.data.accessToken,
      refreshToken: response.data.refreshToken,
      expiresAt: Date.now() + (response.data.accessTokenExpiration * 1000)
    });

    res.json(response.data);
  } catch (error) {
    console.error('Token refresh error:', error.message);
    res.status(error.response?.status || 500).json({
      error: 'Token refresh failed',
      message: error.message
    });
  }
});

// Proxy helper function
async function proxyRequest(req, res, method, path, data = null) {
  const { sessionId } = req.body;
  const session = tokenStore.get(sessionId);

  if (!session || !session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const config = {
      method,
      url: `${session.baseUrl}${path}`,
      headers: {
        'Authorization': `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    res.json(response.data);
  } catch (error) {
    console.error(`TradeLocker ${method} ${path} error:`, error.message);
    
    if (error.response?.status === 401) {
      // Try to refresh token
      try {
        const refreshResponse = await axios.post(
          `${session.baseUrl}/auth/jwt/refresh`,
          { refreshToken: session.refreshToken }
        );

        // Update stored tokens
        const newSession = {
          ...session,
          accessToken: refreshResponse.data.accessToken,
          refreshToken: refreshResponse.data.refreshToken,
          expiresAt: Date.now() + (refreshResponse.data.accessTokenExpiration * 1000)
        };
        tokenStore.set(sessionId, newSession);

        // Retry original request
        const config = {
          method,
          url: `${session.baseUrl}${path}`,
          headers: {
            'Authorization': `Bearer ${newSession.accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        };
        if (data) config.data = data;

        const response = await axios(config);
        return res.json(response.data);
      } catch (refreshError) {
        console.error('Token refresh failed:', refreshError.message);
        return res.status(401).json({ error: 'Session expired' });
      }
    }

    res.status(error.response?.status || 500).json({
      error: 'Request failed',
      message: error.message
    });
  }
}

// Get positions
router.get('/positions', (req, res) => {
  const { sessionId, accountId } = req.query;
  proxyRequest(req, res, 'GET', `/trade/accounts/${accountId}/positions`);
});

// Get orders
router.get('/orders', (req, res) => {
  const { sessionId, accountId } = req.query;
  proxyRequest(req, res, 'GET', `/trade/accounts/${accountId}/orders`);
});

// Get instruments
router.get('/instruments', (req, res) => {
  const { sessionId, accountId } = req.query;
  proxyRequest(req, res, 'GET', `/trade/accounts/${accountId}/instruments`);
});

// Get history
router.get('/history', (req, res) => {
  const { sessionId, accountId, symbol, timeframe, count } = req.query;
  const params = new URLSearchParams({ symbol, timeframe, count });
  proxyRequest(req, res, 'GET', `/trade/history?${params}`);
});

// Create order
router.post('/order', (req, res) => {
  const { sessionId, accountId, ...orderData } = req.body;
  proxyRequest(req, res, 'POST', `/trade/accounts/${accountId}/orders`, orderData);
});

// Close position
router.delete('/position/:positionId', (req, res) => {
  const { sessionId, accountId } = req.body;
  proxyRequest(req, res, 'DELETE', `/trade/accounts/${accountId}/positions/${req.params.positionId}`);
});

// Cancel order
router.delete('/order/:orderId', (req, res) => {
  const { sessionId, accountId } = req.body;
  proxyRequest(req, res, 'DELETE', `/trade/accounts/${accountId}/orders/${req.params.orderId}`);
});

// Disconnect/logout
router.post('/disconnect', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) {
    tokenStore.delete(sessionId);
  }
  res.json({ success: true });
});

export { router as tradeLockerRouter };
