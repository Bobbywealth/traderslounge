import express from 'express';
import axios from 'axios';

const router = express.Router();

const DEMO_BASE_URL = 'https://demo.tradelocker.com/backend-api';
const LIVE_BASE_URL = 'https://live.tradelocker.com/backend-api';

// Store tokens in memory (in production, use secure session storage or Redis)
const tokenStore = new Map();

// Auto-authenticate using environment credentials
async function getAutoAuthTokens() {
  const email = process.env.TRADELOCKER_EMAIL;
  const password = process.env.TRADELOCKER_PASSWORD;
  const server = process.env.TRADELOCKER_SERVER;
  const isDemo = process.env.TRADELOCKER_IS_DEMO !== 'false';

  if (!email || !password || !server) {
    return null;
  }

  const baseUrl = isDemo ? DEMO_BASE_URL : LIVE_BASE_URL;

  try {
    const response = await axios.post(
      `${baseUrl}/auth/jwt/token`,
      { email, password, server },
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );
    return {
      accessToken: response.data.accessToken,
      refreshToken: response.data.refreshToken,
      baseUrl,
      expiresAt: Date.now() + (response.data.accessTokenExpiration * 1000)
    };
  } catch (error) {
    console.error('Auto-auth failed:', error.message);
    return null;
  }
}

// Helper: get or refresh valid tokens (sessionId or auto-auth)
async function getValidTokens(sessionId = null) {
  // Check if we have a session
  if (sessionId && tokenStore.has(sessionId)) {
    const session = tokenStore.get(sessionId);
    // Check if expired
    if (session.expiresAt > Date.now() + 60000) { // 1 min buffer
      return session;
    }
    // Try refresh
    try {
      const refreshResponse = await axios.post(
        `${session.baseUrl}/auth/jwt/refresh`,
        { refreshToken: session.refreshToken },
        { timeout: 30000 }
      );
      const updated = {
        ...session,
        accessToken: refreshResponse.data.accessToken,
        refreshToken: refreshResponse.data.refreshToken,
        expiresAt: Date.now() + (refreshResponse.data.accessTokenExpiration * 1000)
      };
      tokenStore.set(sessionId, updated);
      return updated;
    } catch {
      tokenStore.delete(sessionId);
    }
  }
  // Fall back to auto-auth
  return getAutoAuthTokens();
}

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

// Proxy helper function - supports sessionId from query params or body, falls back to auto-auth
async function proxyRequest(req, res, method, path, data = null) {
  const sessionId = req.body?.sessionId || req.query?.sessionId;
  const session = await getValidTokens(sessionId);

  if (!session || !session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated. Set TRADELOCKER_EMAIL, TRADELOCKER_PASSWORD, TRADELOCKER_SERVER env vars.' });
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

// Check connection status (uses auto-auth or session)
router.get('/status', async (req, res) => {
  const sessionId = req.query.sessionId || req.body?.sessionId;
  const tokens = await getValidTokens(sessionId);
  if (tokens) {
    res.json({ connected: true, demo: tokens.baseUrl === DEMO_BASE_URL });
  } else {
    res.json({ connected: false, hasCredentials: !!(process.env.TRADELOCKER_EMAIL && process.env.TRADELOCKER_PASSWORD && process.env.TRADELOCKER_SERVER) });
  }
});

// Get account info (requires auto-auth or session)
router.get('/account', async (req, res) => {
  const sessionId = req.query.sessionId || req.body?.sessionId;
  const tokens = await getValidTokens(sessionId);
  if (!tokens) {
    return res.status(401).json({ error: 'Not authenticated. Set TRADELOCKER_EMAIL, TRADELOCKER_PASSWORD, TRADELOCKER_SERVER env vars, or provide sessionId.' });
  }
  try {
    const response = await axios.get(`${tokens.baseUrl}/trade/accounts`, {
      headers: { 'Authorization': `Bearer ${tokens.accessToken}` },
      timeout: 30000
    });
    res.json(response.data);
  } catch (error) {
    console.error('Get account error:', error.message);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Execute trade from signal
router.post('/execute-signal', async (req, res) => {
  const sessionId = req.body?.sessionId;
  const tokens = await getValidTokens(sessionId);
  if (!tokens) {
    return res.status(401).json({ error: 'Not authenticated. Set TRADELOCKER_EMAIL, TRADELOCKER_PASSWORD, TRADELOCKER_SERVER env vars, or provide sessionId.' });
  }

  try {
    // Get account first
    const accountsResponse = await axios.get(`${tokens.baseUrl}/trade/accounts`, {
      headers: { 'Authorization': `Bearer ${tokens.accessToken}` },
      timeout: 30000
    });
    const accounts = accountsResponse.data?.accounts || accountsResponse.data;
    if (!accounts || accounts.length === 0) {
      return res.status(400).json({ error: 'No trading accounts found' });
    }
    const accountId = req.body.accountId || accounts[0].id;

    // Build order from signal data
    const { signal, orderType = 'market', quantity = 1 } = req.body;
    if (!signal?.symbol || !signal?.direction) {
      return res.status(400).json({ error: 'signal.symbol and signal.direction are required' });
    }

    // Map symbol for TradeLocker (e.g., EURUSD → EURUSD, XAUUSD → XAUUSD)
    const symbol = signal.symbol;
    const direction = signal.direction.toLowerCase();

    const orderPayload = {
      symbol,
      side: direction === 'buy' ? 'buy' : 'sell',
      quantity: quantity,
      type: orderType,
      ...(signal.entry_price && { entryPrice: signal.entry_price }),
      ...(signal.stop_loss && { stopLoss: signal.stop_loss }),
      ...(signal.take_profit && { takeProfit: signal.take_profit }),
    };

    const response = await axios.post(
      `${tokens.baseUrl}/trade/accounts/${accountId}/orders`,
      orderPayload,
      { headers: { 'Authorization': `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    res.json({ success: true, order: response.data, signal });
  } catch (error) {
    console.error('Execute signal error:', error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to execute trade',
      message: error.response?.data?.message || error.message
    });
  }
});

export { router as tradeLockerRouter };
