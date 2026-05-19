/**
 * Envolvedor seguro de fetch (apiFetch) que configura automáticamente las credenciales de sesión,
 * valida los tipos de los argumentos y gestiona la expiración de la sesión (401/403) de forma global.
 */
export const apiFetch = async (input, init) => {
  // Validar tipo de parámetro input
  if (typeof input !== 'string' && !(input instanceof URL) && !(input instanceof Request)) {
    throw new TypeError('El primer argumento de apiFetch "input" debe ser una cadena de texto, URL o una instancia de Request');
  }
  // Validar tipo de parámetro init
  if (init !== undefined && (typeof init !== 'object' || init === null)) {
    throw new TypeError('El segundo argumento de apiFetch "init" debe ser un objeto');
  }

  let finalInput = input;
  let finalInit = init;

  if (input instanceof Request) {
    const nextCredentials = input.credentials === 'omit' ? 'omit' : 'include';
    finalInput = new Request(input, { credentials: nextCredentials });
    finalInit = undefined;
  } else {
    finalInit = { ...(init || {}), credentials: init?.credentials ?? 'include' };
  }

  const response = await fetch(finalInput, finalInit);

  // Disparar cierre de sesión forzado si no está autorizado (401/403)
  const url = typeof input === 'string' ? input : input?.url || '';
  const isApi = typeof url === 'string' && url.includes('/api/');
  const isLogin = typeof url === 'string' && url.includes('/api/auth/login');

  if ((response.status === 401 || response.status === 403) && isApi && !isLogin) {
    window.dispatchEvent(new Event('force-logout'));
  }

  return response;
};
