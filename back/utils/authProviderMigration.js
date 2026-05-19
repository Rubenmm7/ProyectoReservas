const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/db');

const AUTH_PROVIDER_COLUMN = 'auth_provider';

const hashRandomPassword = async () => {
  const salt = await bcrypt.genSalt(10);
  const randomSecret = crypto.randomBytes(32).toString('hex');
  return bcrypt.hash(randomSecret, salt);
};

const ensureUserAuthProviderColumn = async () => {
  const connection = await db.getConnection();

  try {
    const [columns] = await connection.query("SHOW COLUMNS FROM users LIKE ?", [AUTH_PROVIDER_COLUMN]);

    if (!Array.isArray(columns) || columns.length === 0) {
      await connection.query(
        "ALTER TABLE users ADD COLUMN auth_provider ENUM('local', 'microsoft365') NOT NULL DEFAULT 'local' AFTER password"
      );
    }

    const [legacyOauthUsers] = await connection.query(
      "SELECT id FROM users WHERE password = 'OAUTH_USER_EXTERNAL'"
    );

    for (const user of legacyOauthUsers) {
      // A cada usuario heredado de Microsoft se le asigna una contraseña bcrypt real para que la base de datos nunca guarde un marcador en texto plano.
      const hashedPassword = await hashRandomPassword();
      await connection.query(
        "UPDATE users SET password = ?, auth_provider = 'microsoft365' WHERE id = ?",
        [hashedPassword, user.id]
      );
    }

    const [oauthUsersWithoutProvider] = await connection.query(
      "SELECT id FROM users WHERE auth_provider IS NULL"
    );

    if (Array.isArray(oauthUsersWithoutProvider) && oauthUsersWithoutProvider.length > 0) {
      await connection.query(
        "UPDATE users SET auth_provider = 'local' WHERE auth_provider IS NULL"
      );
    }
  } finally {
    connection.release();
  }
};

module.exports = { ensureUserAuthProviderColumn };
