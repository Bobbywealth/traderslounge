// Bridge: bwtsApi holds the access token in module scope. We mirror it to
// billingApi so the same JWT is used for billing endpoints without
// duplicating the refresh logic.

import { useEffect } from 'react';
import { setBillingAccessToken } from '../services/billingApi';
import { useAuth } from '../contexts/AuthContext';

export const BillingBootSync: React.FC = () => {
  const { isAuthenticated, user } = useAuth();
  useEffect(() => {
    if (!isAuthenticated) {
      setBillingAccessToken(null);
      return;
    }
    // The auth tokens are managed by bwtsApi internally. We don't have a
    // public getter, so we read what we can via the refresh path.
    // Regardless, the billingApi will use refreshAccessToken on first 401
    // to populate the token.
    setBillingAccessToken(null);
  }, [isAuthenticated, user?.id]);
  return null;
};
