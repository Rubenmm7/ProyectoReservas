const db = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const auditLogger = require('../utils/auditLogger');
const axios = require('axios');

const JWT_EXPIRES_IN = '24h';
const JWT_EXPIRES_MS = 24 * 60 * 60 * 1000;

const getCookieOptions = () => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: JWT_EXPIRES_MS,
    path: '/',
});

const createOAuthPasswordHash = async () => {
    const salt = await bcrypt.genSalt(10);
    const randomSecret = crypto.randomBytes(32).toString('hex');
    return bcrypt.hash(randomSecret, salt);
};

const getCurrentUserWithCentres = async (userId) => {
    const [users] = await db.query(
        'SELECT id, username, role, password, auth_provider, outlook_sync_enabled FROM users WHERE id = ? AND deleted_at IS NULL',
        [userId]
    );

    if (!Array.isArray(users) || users.length === 0) {
        return null;
    }

    const user = users[0];
    const [centreRows] = await db.query(
        'SELECT uc.centre_id, c.nombre FROM user_centres uc JOIN centres c ON uc.centre_id = c.id WHERE uc.user_id = ?',
        [user.id]
    );

    const centreIds = Array.isArray(centreRows) ? centreRows.map((r) => r.centre_id) : [];
    const requiresCentreSelection = centreIds.length === 0 && (
        user.auth_provider === 'microsoft365' ||
        ((user.role === 'empleado' || user.role === 'gestor' || user.role === 'supervisor') && user.auth_provider === 'local')
    );

    return {
        id: user.id,
        username: user.username,
        role: user.role,
        centre_ids: centreIds,
        centres: centreRows,
        requires_centre_selection: requiresCentreSelection,
        outlook_sync_enabled: !!user.outlook_sync_enabled,
    };
};

exports.login = async (req, res) => {
    const { username, password } = req.body;

    try {
        const [rows] = await db.query('SELECT * FROM users WHERE username = ? AND deleted_at IS NULL', [username]);
        if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

        const user = rows[0];
        let isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch && !user.password.startsWith('$2a$') && !user.password.startsWith('$2b$')) {
            if (password === user.password) {
                const salt = await bcrypt.genSalt(10);
                const hashedPassword = await bcrypt.hash(password, salt);
                await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user.id]);
                isMatch = true;
            }
        }

        if (!isMatch) return res.status(401).json({ error: 'Contraseña incorrecta' });

        const userData = await getCurrentUserWithCentres(user.id);
        if (!userData) return res.status(404).json({ error: 'Usuario no encontrado' });

        const token = jwt.sign(
            { id: userData.id, role: userData.role, centre_ids: userData.centre_ids },
            process.env.JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        await auditLogger.logAction(user.id, 'READ', 'auth', user.id, user.role, {
            username,
            action: 'Usuario inició sesión',
        });

        res.cookie('auth_token', token, getCookieOptions());

        res.json({
            message: 'Login correcto',
            user: userData,
        });
    } catch (error) {
        res.status(500).json({ error: 'Error en el login', details: error.message });
    }
};

exports.externalLogin = (req, res) => {
    const origin = req.headers.origin || req.headers.referer || process.env.FRONTEND_URL || 'http://localhost:5173';
    let frontendUrl;
    try { frontendUrl = new URL(origin).origin; } catch { frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'; }
    const state = Buffer.from(JSON.stringify({ frontendUrl })).toString('base64url');
    const url = `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/authorize?client_id=${process.env.MS_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(process.env.MS_REDIRECT_URI)}&response_mode=query&scope=User.Read&state=${encodeURIComponent(state)}`;
    res.redirect(url);
};

exports.externalCallback = async (req, res) => {
    const { code } = req.query;

    try {
        const tokenResponse = await axios.post(
            `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`,
            new URLSearchParams({
                client_id: process.env.MS_CLIENT_ID,
                client_secret: process.env.MS_CLIENT_SECRET,
                code,
                redirect_uri: process.env.MS_REDIRECT_URI,
                grant_type: 'authorization_code',
            }).toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const userRes = await axios.get('https://graph.microsoft.com/v1.0/me', {
            headers: { Authorization: `Bearer ${tokenResponse.data.access_token}` },
        });

        const email = userRes.data.userPrincipalName;

        let [users] = await db.query('SELECT * FROM users WHERE username = ? AND deleted_at IS NULL', [email]);
        let user;

        if (users.length > 0) {
            user = users[0];
            if (user.auth_provider !== 'microsoft365') {
                await db.query('UPDATE users SET auth_provider = ? WHERE id = ?', ['microsoft365', user.id]);
                user.auth_provider = 'microsoft365';
            }
        } else {
            const [existingRows] = await db.query(
                'SELECT id, username, role, deleted_at FROM users WHERE username = ?',
                [email]
            );

            if (Array.isArray(existingRows) && existingRows.length > 0) {
                const existingUser = existingRows[0];
                const hashedPassword = await createOAuthPasswordHash();
                await db.query(
                    'UPDATE users SET deleted_at = NULL, password = ?, role = ?, auth_provider = ? WHERE id = ?',
                    [hashedPassword, existingUser.role || 'empleado', 'microsoft365', existingUser.id]
                );
                user = {
                    id: existingUser.id,
                    username: email,
                    role: existingUser.role || 'empleado',
                    auth_provider: 'microsoft365',
                };
            } else {
                const hashedPassword = await createOAuthPasswordHash();
                const [result] = await db.query(
                    'INSERT INTO users (username, password, role, auth_provider) VALUES (?, ?, ?, ?)',
                    [email, hashedPassword, 'empleado', 'microsoft365']
                );
                user = {
                    id: result.insertId,
                    username: email,
                    role: 'empleado',
                    auth_provider: 'microsoft365',
                };

                await auditLogger.logAction(user.id, 'CREATE', 'users', user.id, 'empleado', {
                    username: email,
                    action: 'Registro automático via Login Externo',
                });
            }
        }

        // El admin ha concedido Calendars.ReadWrite como Application permission → todos los MS365 habilitados
        await db.query('UPDATE users SET outlook_sync_enabled = 1 WHERE id = ?', [user.id]);

        const userData = await getCurrentUserWithCentres(user.id);
        if (!userData) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const token = jwt.sign(
            { id: userData.id, role: userData.role, centre_ids: userData.centre_ids },
            process.env.JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        await auditLogger.logAction(user.id, 'READ', 'auth', user.id, user.role, {
            username: email,
            action: 'Login exitoso via Externo',
        });

        let frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        try {
            const state = JSON.parse(Buffer.from(decodeURIComponent(req.query.state || ''), 'base64url').toString());
            if (state.frontendUrl) frontendUrl = state.frontendUrl;
        } catch { /* usa FRONTEND_URL por defecto */ }

        res.cookie('auth_token', token, getCookieOptions());

        const encodedUserData = encodeURIComponent(JSON.stringify(userData));
        res.redirect(`${frontendUrl}/login?user=${encodedUserData}`);
    } catch (error) {
        console.error('Error Externo:', error.message);
        const fallback = process.env.FRONTEND_URL || 'http://localhost:5173';
        res.redirect(`${fallback}/login?error=external_auth_failed`);
    }
};

exports.selectCentre = async (req, res) => {
    try {
        if (!req.user?.id) {
            return res.status(401).json({ error: 'No autenticado' });
        }

        const { centre_id } = req.body;

        const [userRows] = await db.query(
            'SELECT id, password, role, auth_provider FROM users WHERE id = ? AND deleted_at IS NULL',
            [req.user.id]
        );

        if (!Array.isArray(userRows) || userRows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const currentUser = userRows[0];
        const [centreRows] = await db.query('SELECT id, nombre FROM centres WHERE id = ?', [centre_id]);

        if (!Array.isArray(centreRows) || centreRows.length === 0) {
            return res.status(404).json({ error: 'Centro no encontrado' });
        }

        const currentUserData = await getCurrentUserWithCentres(currentUser.id);
        if (!currentUserData) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        if (!currentUserData.requires_centre_selection) {
            return res.status(400).json({ error: 'No necesitas seleccionar un centro' });
        }

        await db.query('DELETE FROM user_centres WHERE user_id = ?', [currentUser.id]);
        await db.query('INSERT INTO user_centres (user_id, centre_id) VALUES (?, ?)', [currentUser.id, centre_id]);

        const updatedUser = await getCurrentUserWithCentres(currentUser.id);
        if (!updatedUser) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const token = jwt.sign(
            { id: updatedUser.id, role: updatedUser.role, centre_ids: updatedUser.centre_ids },
            process.env.JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.cookie('auth_token', token, getCookieOptions());

        await auditLogger.logAction(currentUser.id, 'UPDATE', 'users', currentUser.id, currentUser.role, {
            action: 'Centro asignado en onboarding',
            centre_id,
        });

        res.json({
            message: 'Centro asignado correctamente',
            user: updatedUser,
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al asignar el centro', details: error.message });
    }
};

exports.logout = async (req, res) => {
    res.clearCookie('auth_token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        path: '/',
    });
    res.status(200).json({ message: 'Logout correcto' });
};

exports.me = async (req, res) => {
    try {
        if (!req.user?.id) {
            return res.status(401).json({ error: 'No autenticado' });
        }

        const userData = await getCurrentUserWithCentres(req.user.id);
        if (!userData) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({ user: userData });
    } catch (error) {
        res.status(500).json({ error: 'Error obteniendo el usuario actual', details: error.message });
    }
};
