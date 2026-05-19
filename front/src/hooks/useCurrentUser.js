import { apiFetch } from '../utils/http';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clearSessionStorage, getSessionTiming, persistSession, sanitizeUser } from '../utils/session';

const readStoredUser = () => {
  try {
    const raw = localStorage.getItem('user');
    return raw ? sanitizeUser(JSON.parse(raw)) || {} : {};
  } catch {
    return {};
  }
};

const isSameUser = (a, b) => {
  const left = a || {};
  const right = b || {};
  const leftCentres = JSON.stringify(left.centre_ids ?? []);
  const rightCentres = JSON.stringify(right.centre_ids ?? []);

  return (
    String(left.id ?? '') === String(right.id ?? '') &&
    String(left.username ?? '') === String(right.username ?? '') &&
    String(left.role ?? '') === String(right.role ?? '') &&
    leftCentres === rightCentres &&
    Boolean(left.requires_centre_selection) === Boolean(right.requires_centre_selection)
  );
};

export const useCurrentUser = ({ refreshIntervalMs = 30000 } = {}) => {
  const [currentUser, setCurrentUser] = useState(() => readStoredUser());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const currentUserRef = useRef(readStoredUser());
  const refreshInFlightRef = useRef(false);

  const syncUserState = useCallback((nextUser) => {
    const normalizedNextUser = nextUser || {};
    currentUserRef.current = normalizedNextUser;
    setCurrentUser(normalizedNextUser);
    return normalizedNextUser;
  }, []);

  const refreshCurrentUser = useCallback(async () => {
    if (refreshInFlightRef.current) {
      return currentUserRef.current;
    }

    const { isExpired } = getSessionTiming();
    if (isExpired) {
      clearSessionStorage();
      return syncUserState({});
    }

    try {
      refreshInFlightRef.current = true;
      setIsRefreshing(true);
      const response = await apiFetch('/api/auth/me');

      if (!response.ok) {
        const storedUser = readStoredUser();
        return syncUserState(storedUser);
      }

      const data = await response.json();
      const nextUser = data?.user || {};

      if (!isSameUser(currentUserRef.current, nextUser)) {
        persistSession({ user: nextUser, centres: nextUser.centres || [] });
        return syncUserState(nextUser);
      }

      return nextUser;
    } catch (error) {
      console.error('Error refrescando usuario actual:', error);
      const storedUser = readStoredUser();
      return syncUserState(storedUser);
    } finally {
      refreshInFlightRef.current = false;
      setIsRefreshing(false);
    }
  }, [syncUserState]);

  useEffect(() => {
    refreshCurrentUser();
  }, [refreshCurrentUser]);

  useEffect(() => {
    const handleFocus = () => refreshCurrentUser();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshCurrentUser();
      }
    };
    const handleStorage = (event) => {
      if (event.key === 'user') {
        syncUserState(readStoredUser());
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('storage', handleStorage);

    const intervalId = window.setInterval(refreshCurrentUser, refreshIntervalMs);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('storage', handleStorage);
      window.clearInterval(intervalId);
    };
  }, [refreshCurrentUser, refreshIntervalMs]);

  return {
    currentUser,
    isRefreshing,
    refreshCurrentUser,
    setCurrentUser,
  };
};

