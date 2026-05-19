export const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
export const SESSION_WARNING_MS = 5 * 60 * 1000;

export const SESSION_STORAGE_KEYS = {
  user: 'user',
  centres: 'centres',
  loginAt: 'loginAt',
};

export const sanitizeUser = (user) => {
  if (!user || typeof user !== 'object') {
    return null;
  }

  const sanitized = {};

  if (user.id !== undefined && user.id !== null) {
    sanitized.id = typeof user.id === 'number' ? user.id : String(user.id);
  }
  sanitized.username = typeof user.username === 'string' ? user.username : '';
  if (typeof user.email === 'string') {
    sanitized.email = user.email;
  }
  sanitized.role = typeof user.role === 'string' ? user.role : '';

  if (Array.isArray(user.centre_ids)) {
    sanitized.centre_ids = user.centre_ids.map(id => typeof id === 'number' ? id : String(id));
  } else {
    sanitized.centre_ids = [];
  }

  if (Array.isArray(user.centres)) {
    sanitized.centres = user.centres.map(centre => {
      if (centre && typeof centre === 'object') {
        return {
          centre_id: typeof centre.centre_id === 'number' ? centre.centre_id : String(centre.centre_id || ''),
          nombre: typeof centre.nombre === 'string' ? centre.nombre : '',
        };
      }
      return null;
    }).filter(Boolean);
  } else {
    sanitized.centres = [];
  }

  sanitized.requires_centre_selection = Boolean(user.requires_centre_selection);
  sanitized.outlook_sync_enabled = Boolean(user.outlook_sync_enabled);

  return sanitized;
};

export const clearSessionStorage = () => {
  localStorage.removeItem(SESSION_STORAGE_KEYS.user);
  localStorage.removeItem(SESSION_STORAGE_KEYS.centres);
  localStorage.removeItem(SESSION_STORAGE_KEYS.loginAt);
};

export const persistSession = ({ user, centres, loginAt = Date.now() }) => {
  if (user) {
    const parsedUser = typeof user === 'string' ? JSON.parse(user) : user;
    const sanitizedUser = sanitizeUser(parsedUser);
    localStorage.setItem(SESSION_STORAGE_KEYS.user, JSON.stringify(sanitizedUser));
    const finalCentres = centres || sanitizedUser.centres || [];
    localStorage.setItem(SESSION_STORAGE_KEYS.centres, JSON.stringify(finalCentres));
  }
  localStorage.setItem(SESSION_STORAGE_KEYS.loginAt, String(loginAt));
};

export const getStoredLoginAt = () => {
  const raw = localStorage.getItem(SESSION_STORAGE_KEYS.loginAt);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const ensureSessionStart = () => {
  const currentLoginAt = getStoredLoginAt();
  if (currentLoginAt) {
    return currentLoginAt;
  }

  const now = Date.now();
  localStorage.setItem(SESSION_STORAGE_KEYS.loginAt, String(now));
  return now;
};

export const getSessionTiming = () => {
  const loginAt = getStoredLoginAt();

  if (!loginAt) {
    return {
      loginAt: null,
      warningAt: null,
      expiresAt: null,
      isExpired: false,
    };
  }

  const expiresAt = loginAt + SESSION_DURATION_MS;
  const warningAt = expiresAt - SESSION_WARNING_MS;

  return {
    loginAt,
    warningAt,
    expiresAt,
    isExpired: Date.now() >= expiresAt,
  };
};
