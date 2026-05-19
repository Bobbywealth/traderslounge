import express from 'express';
import axios from 'axios';

const router = express.Router();

const DEMO_BASE_URL = 'https://demo.tradelocker.com/backend-api';
const LIVE_BASE_URL = 'https://live.tradelocker.com/backend-api';

// Store tokens + account info in memory
const tokenStore = new Map();

// Cache for the env-var-based auto-auth flow. Without this, every call
// to getValidTokens(null) re-runs the full /auth/jwt/token + /trade/accounts
// dance, which TradeLocker rate-limits aggressively (we observed 429s
// after ~10 back-to-back auths during a signals refresh).
let autoAuthCache = null;
let autoAuthInFlight = null;

// Auto-authenticate and fetch account info
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
    // Step 1: Authenticate
    const authResponse = await axios.post(
      `${baseUrl}/auth/jwt/token`,
      { email, password, server },
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    const tokens = {
      accessToken: authResponse.data.accessToken,
      refreshToken: authResponse.data.refreshToken,
      baseUrl,
      expiresAt: Date.now() + (authResponse.data.accessTokenExpiration * 1000),
      accountId: null,
      accountNum: null
    };

    // Step 2: Fetch account list (demo uses accNum=1)
    const accNum = isDemo ? 1 : (parseInt(process.env.TRADELOCKER_ACCOUNT_NUM) || 1);
    try {
      const accountsResponse = await axios.get(`${baseUrl}/trade/accounts`, {
        headers: {
          'Authorization': `Bearer ${tokens.accessToken}`,
          'accNum': accNum.toString()
        },
        timeout: 30000
      });

      const accounts = accountsResponse.data?.d || accountsResponse.data?.accounts || [];
      if (accounts.length > 0) {
        tokens.accountId = accounts[0].id;
        tokens.accountNum = accNum;
        tokens.account = accounts[0];
      }
    } catch (accError) {
      console.warn('Could not fetch account info (accNum may differ):', accError.response?.data?.message || accError.message);
      // Try common accNum values
      if (isDemo) {
        for (const num of [1, 2, 3]) {
          try {
            const r = await axios.get(`${baseUrl}/trade/accounts`, {
              headers: { 'Authorization': `Bearer ${tokens.accessToken}`, 'accNum': num.toString() },
              timeout: 10000
            });
            const accounts = r.data?.d || r.data?.accounts || [];
            if (accounts.length > 0) {
              tokens.accountId = accounts[0].id;
              tokens.accountNum = num;
              tokens.account = accounts[0];
              break;
            }
          } catch {}
        }
      }
    }

    return tokens;
  } catch (error) {
    console.error('Auto-auth failed:', error.response?.data?.message || error.message);
    return null;
  }
}

// Auto-auth with caching + in-flight dedupe. Concurrent callers during a
// signals refresh share a single auth round-trip instead of all hammering
// /auth/jwt/token in parallel.
async function getCachedAutoAuthTokens() {
  if (autoAuthCache && autoAuthCache.expiresAt > Date.now() + 60_000) {
    return autoAuthCache;
  }
  if (autoAuthInFlight) {
    return autoAuthInFlight;
  }
  autoAuthInFlight = (async () => {
    try {
      const tokens = await getAutoAuthTokens();
      autoAuthCache = tokens;
      return tokens;
    } finally {
      autoAuthInFlight = null;
    }
  })();
  return autoAuthInFlight;
}

// Helper: get or refresh valid tokens
export async function getValidTokens(sessionId = null) {
  if (sessionId && tokenStore.has(sessionId)) {
    const session = tokenStore.get(sessionId);
    if (session.expiresAt > Date.now() + 60000) {
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
  return getCachedAutoAuthTokens();
}

// Make authenticated request to TradeLocker
export async function tlRequest(method, path, tokens, data = null, params = null) {
  const headers = {
    'Authorization': `Bearer ${tokens.accessToken}`,
    'Content-Type': 'application/json'
  };
  if (tokens.accountNum) {
    headers['accNum'] = tokens.accountNum.toString();
  }

  const config = { method, url: `${tokens.baseUrl}${path}`, headers, timeout: 30000 };
  if (data) config.data = data;
  if (params) config.params = params;

  return axios(config);
}

// Authenticate with TradeLocker
router.post('/auth', async (req, res) => {
  try {
    const { email, password, server, isDemo = true, sessionId } = req.body;
    const baseUrl = isDemo ? DEMO_BASE_URL : LIVE_BASE_URL;

    const authResponse = await axios.post(
      `${baseUrl}/auth/jwt/token`,
      { email, password, server },
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    const tokens = {
      accessToken: authResponse.data.accessToken,
      refreshToken: authResponse.data.refreshToken,
      baseUrl,
      expiresAt: Date.now() + (authResponse.data.accessTokenExpiration * 1000),
      accountId: null,
      accountNum: null,
      account: null
    };

    // Fetch account
    const accNum = isDemo ? 1 : 1;
    try {
      const accountsResponse = await axios.get(`${baseUrl}/trade/accounts`, {
        headers: { 'Authorization': `Bearer ${tokens.accessToken}`, 'accNum': accNum.toString() },
        timeout: 30000
      });
      const accounts = accountsResponse.data?.d || accountsResponse.data?.accounts || [];
      if (accounts.length > 0) {
        tokens.accountId = accounts[0].id;
        tokens.accountNum = accNum;
        tokens.account = accounts[0];
      }
    } catch {}

    if (sessionId) {
      tokenStore.set(sessionId, tokens);
    }

    res.json({ ...authResponse.data, account: tokens.account });
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

    const refreshResponse = await axios.post(
      `${tokens.baseUrl}/auth/jwt/refresh`,
      { refreshToken: tokens.refreshToken },
      { timeout: 30000 }
    );

    const updated = {
      ...tokens,
      accessToken: refreshResponse.data.accessToken,
      refreshToken: refreshResponse.data.refreshToken,
      expiresAt: Date.now() + (refreshResponse.data.accessTokenExpiration * 1000)
    };
    tokenStore.set(sessionId, updated);
    res.json(refreshResponse.data);
  } catch (error) {
    console.error('Token refresh error:', error.message);
    res.status(error.response?.status || 500).json({ error: 'Token refresh failed', message: error.message });
  }
});

// Check connection status
router.get('/status', async (req, res) => {
  const sessionId = req.query.sessionId || req.body?.sessionId;
  const tokens = await getValidTokens(sessionId);
  if (tokens) {
    res.json({
      connected: true,
      demo: tokens.baseUrl === DEMO_BASE_URL,
      accountId: tokens.accountId,
      account: tokens.account
    });
  } else {
    res.json({
      connected: false,
      hasCredentials: !!(process.env.TRADELOCKER_EMAIL && process.env.TRADELOCKER_PASSWORD && process.env.TRADELOCKER_SERVER)
    });
  }
});

// Get account info
router.get('/account', async (req, res) => {
  const sessionId = req.query.sessionId || req.body?.sessionId;
  const tokens = await getValidTokens(sessionId);
  if (!tokens) {
    return res.status(401).json({ error: 'Not authenticated. Set TRADELOCKER_EMAIL, TRADELOCKER_PASSWORD, TRADELOCKER_SERVER env vars.' });
  }

  if (tokens.account) {
    return res.json({ accounts: [tokens.account] });
  }

  // Try to fetch if not cached
  try {
    const response = await tlRequest('GET', '/trade/accounts', tokens);
    const accounts = response.data?.d || response.data?.accounts || [];
    res.json({ accounts });
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Get positions
router.get('/positions', async (req, res) => {
  const { sessionId, accountId } = req.query;
  const tokens = await getValidTokens(sessionId);
  if (!tokens) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const accId = accountId || tokens.accountId;
  try {
    const response = await tlRequest('GET', `/trade/accounts/${accId}/positions`, tokens);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Get orders
router.get('/orders', async (req, res) => {
  const { sessionId, accountId } = req.query;
  const tokens = await getValidTokens(sessionId);
  if (!tokens) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const accId = accountId || tokens.accountId;
  try {
    const response = await tlRequest('GET', `/trade/accounts/${accId}/orders`, tokens);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Get instruments
router.get('/instruments', async (req, res) => {
  const { sessionId, accountId } = req.query;
  const tokens = await getValidTokens(sessionId);
  if (!tokens) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const accId = accountId || tokens.accountId;
  try {
    const response = await tlRequest('GET', `/trade/accounts/${accId}/instruments`, tokens);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Get history
router.get('/history', async (req, res) => {
  const { sessionId, accountId, symbol, timeframe, count } = req.query;
  const tokens = await getValidTokens(sessionId);
  if (!tokens) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const response = await tlRequest('GET', '/trade/history', tokens, null, { symbol, timeframe, count });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Create order
router.post('/order', async (req, res) => {
  const { sessionId, accountId, ...orderData } = req.body;
  const tokens = await getValidTokens(sessionId);
  if (!tokens) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const accId = accountId || tokens.accountId;
  try {
    const response = await tlRequest('POST', `/trade/accounts/${accId}/orders`, tokens, orderData);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Close position
router.delete('/position/:positionId', async (req, res) => {
  const { sessionId, accountId } = req.body;
  const tokens = await getValidTokens(sessionId);
  if (!tokens) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const accId = accountId || tokens.accountId;
  try {
    const response = await tlRequest('DELETE', `/trade/accounts/${accId}/positions/${req.params.positionId}`, tokens);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Cancel order
router.delete('/order/:orderId', async (req, res) => {
  const { sessionId, accountId } = req.body;
  const tokens = await getValidTokens(sessionId);
  if (!tokens) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const accId = accountId || tokens.accountId;
  try {
    const response = await tlRequest('DELETE', `/trade/accounts/${accId}/orders/${req.params.orderId}`, tokens);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Disconnect/logout
router.post('/disconnect', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) {
    tokenStore.delete(sessionId);
  }
  res.json({ success: true });
});

// Execute trade from signal
router.post('/execute-signal', async (req, res) => {
  const sessionId = req.body?.sessionId;
  const tokens = await getValidTokens(sessionId);
  if (!tokens) {
    return res.status(401).json({ error: 'Not authenticated. Set TRADELOCKER_EMAIL, TRADELOCKER_PASSWORD, TRADELOCKER_SERVER env vars.' });
  }

  try {
    const { signal, orderType = 'market', quantity = 1 } = req.body;
    if (!signal?.symbol || !signal?.direction) {
      return res.status(400).json({ error: 'signal.symbol and signal.direction are required' });
    }

    // Use cached account or fetch
    let accountId = tokens.accountId;
    if (!accountId) {
      const accNum = tokens.baseUrl === DEMO_BASE_URL ? 1 : 1;
      const accountsResponse = await tlRequest('GET', '/trade/accounts', tokens);
      const accounts = accountsResponse.data?.d || accountsResponse.data?.accounts || [];
      if (accounts.length === 0) {
        return res.status(400).json({ error: 'No trading accounts found' });
      }
      accountId = accounts[0].id;
    }

    const orderPayload = {
      symbol: signal.symbol,
      side: signal.direction.toLowerCase() === 'buy' ? 'buy' : 'sell',
      quantity,
      type: orderType,
      ...(signal.entry_price && { entryPrice: signal.entry_price }),
      ...(signal.stop_loss && { stopLoss: signal.stop_loss }),
      ...(signal.take_profit && { takeProfit: signal.take_profit }),
    };

    const response = await tlRequest('POST', `/trade/accounts/${accountId}/orders`, tokens, orderPayload);
    res.json({ success: true, order: response.data, signal });
  } catch (error) {
    console.error('Execute signal error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to execute trade',
      message: error.response?.data?.message || error.message
    });
  }
});

export { router as tradeLockerRouter };
