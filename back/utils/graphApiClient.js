const axios = require('axios');

let cachedToken = null;
let tokenExpiry = null;

async function getAppOnlyToken() {
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 60_000) {
        return cachedToken;
    }

    const response = await axios.post(
        `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`,
        new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: process.env.MS_CLIENT_ID,
            client_secret: process.env.MS_CLIENT_SECRET,
            scope: 'https://graph.microsoft.com/.default',
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    cachedToken = response.data.access_token;
    tokenExpiry = Date.now() + response.data.expires_in * 1000;
    return cachedToken;
}

async function graphGet(path, extraHeaders = {}) {
    const token = await getAppOnlyToken();
    const response = await axios.get(`https://graph.microsoft.com/v1.0${path}`, {
        headers: { Authorization: `Bearer ${token}`, ...extraHeaders },
    });
    return response.data;
}

async function graphPost(path, body) {
    const token = await getAppOnlyToken();
    const response = await axios.post(`https://graph.microsoft.com/v1.0${path}`, body, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    });
    return response.data;
}

async function graphPatch(path, body) {
    const token = await getAppOnlyToken();
    const response = await axios.patch(`https://graph.microsoft.com/v1.0${path}`, body, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    });
    return response.data;
}

async function graphDelete(path) {
    const token = await getAppOnlyToken();
    await axios.delete(`https://graph.microsoft.com/v1.0${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
}

module.exports = { getAppOnlyToken, graphGet, graphPost, graphPatch, graphDelete };
