const crypto = require('crypto');

// Almacén en memoria para nonces. En una aplicación real usar un almacén persistente o un token firmado.
const nonceStore = new Set();

/**
 * Genera una cadena de estado (state) que contiene la URL del frontend y un nonce aleatorio.
 * El nonce se almacena temporalmente para poder verificarlo en la llamada de retorno (callback).
 * Retorna un objeto con el estado en bruto (base64url) y el nonce (para depuración si es necesario).
 */
function generateState(frontendUrl) {
  const nonce = crypto.randomBytes(16).toString('hex');
  // Almacenar el nonce para poder verificarlo más tarde.
  nonceStore.add(nonce);
  const payload = JSON.stringify({ frontendUrl, nonce });
  const state = Buffer.from(payload).toString('base64url');
  return { state, nonce };
}

/**
 * Verifica un parámetro de estado recibido.
 * Retorna el payload decodificado si es válido, en caso contrario lanza un error.
 */
function verifyState(state) {
  if (!state) throw new Error('Falta el parámetro de estado (state)');
  const decoded = Buffer.from(state, 'base64url').toString('utf8');
  const { frontendUrl, nonce } = JSON.parse(decoded);
  if (!nonceStore.has(nonce)) {
    throw new Error('El nonce de estado no es válido o ya ha sido utilizado');
  }
  // Una vez usado, se elimina para evitar ataques de repetición (replay attacks).
  nonceStore.delete(nonce);
  return { frontendUrl, nonce };
}

module.exports = { generateState, verifyState };
