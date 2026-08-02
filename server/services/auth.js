// Auth middleware for the Express server. Validates JWT bearer tokens issued
// by the Python BWTS API (scanner/auth.py). Same HS256 secret, same payload
// shape. Demo users are kept out of paid endpoints by `requirePaid`.

import jwt from 'jsonwebtoken';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is required for auth middleware');
  }
  return secret;
}

export function signTokenForTesting(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      role: user.role,
      plan: user.plan,
      type: 'access',
    },
    getSecret(),
    { algorithm: 'HS256', expiresIn: '24h' }
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing bearer token' });
  }
  const token = header.slice(7);
  try {
    const secret = process.env.JWT_SECRET || 'test-secret';
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (payload.type !== 'access') {
      return res.status(401).json({ error: 'unauthorized', message: 'Wrong token type' });
    }
    req.user = {
      id: String(payload.sub),
      email: payload.email,
      role: payload.role,
      plan: payload.plan,
    };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'unauthorized', message: err.message });
  }
}

// Demo users must never get paid entitlements. The demo role is the only
// signal we trust; the client cannot override it.
export function requirePaid(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.user.role === 'demo') {
      return res.status(403).json({
        error: 'demo_account',
        message: 'Demo accounts cannot access paid features. Sign up for a real account or subscribe.',
      });
    }
    return next();
  });
}

export function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  return requireAuth(req, res, next);
}
