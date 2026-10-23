const express = require('express');
const cors = require('cors');
const path = require('path');
const keyPool = require('./services/keyPoolManager');
const openAiAdapter = require('./services/openAiAdapter');
const geminiClient = require('./services/geminiClient');

const app = express();
const PORT = process.env.PORT || keyPool.config.port || 3003;

app.use(cors());
app.use(express.json());

// Router that works seamlessly on both '/' and '/9routerui'
const router = express.Router();

router.use(express.static(path.join(__dirname, 'public')));

// ----------------- OPENAI-COMPATIBLE PROXY ROUTES (FOR 9ROUTER, CLAUDE CODE, CURSOR) ----------------- //

router.post('/v1/chat/completions', (req, res) => {
  openAiAdapter.handleChatCompletion(req, res);
});

router.get('/v1/models', (req, res) => {
  res.json(openAiAdapter.getModelsList());
});

router.post('/chat/completions', (req, res) => {
  openAiAdapter.handleChatCompletion(req, res);
});

// ----------------- KEY POOL & MANAGEMENT API ROUTES ----------------- //

router.get('/api/keys', (req, res) => {
  res.json({
    success: true,
    keys: keyPool.getAllKeys()
  });
});

router.post('/api/keys', (req, res) => {
  const { name, apiKey, quotaLimit } = req.body;
  if (!apiKey || apiKey.trim().length < 5) {
    return res.status(400).json({ success: false, message: 'Google Gemini API Key wajib diisi!' });
  }

  const newKey = keyPool.addKey({
    name: name || `Akun Google ${keyPool.keys.length + 1}`,
    apiKey,
    quotaLimit: quotaLimit || 1000000
  });

  res.json({ success: true, key: newKey });
});

router.put('/api/keys/:id', (req, res) => {
  const updated = keyPool.updateKey(req.params.id, req.body);
  if (!updated) {
    return res.status(404).json({ success: false, message: 'Key tidak ditemukan.' });
  }
  res.json({ success: true, key: updated });
});

router.delete('/api/keys/:id', (req, res) => {
  const deleted = keyPool.deleteKey(req.params.id);
  res.json({ success: deleted });
});

router.post('/api/keys/:id/toggle', (req, res) => {
  const toggled = keyPool.toggleKey(req.params.id);
  if (!toggled) {
    return res.status(404).json({ success: false, message: 'Key tidak ditemukan.' });
  }
  res.json({ success: true, key: toggled });
});

// Test a key or OAuth account directly
router.post('/api/keys/test', async (req, res) => {
  const { apiKey, id, model } = req.body;
  let authData = { apiKey, authType: 'apiKey' };

  if (id) {
    const found = keyPool.keys.find(k => k.id === id);
    if (found) {
      if (found.authType === 'oauth') {
        try {
          const auth = await keyPool.getValidAuthToken(found);
          authData = { authToken: auth.token, authType: 'oauth' };
        } catch (authErr) {
          return res.status(401).json({ success: false, error: authErr.message });
        }
      } else {
        authData = { apiKey: found.apiKey, authType: 'apiKey' };
      }
    }
  }

  if (!authData.apiKey && !authData.authToken) {
    return res.status(400).json({ success: false, message: 'API Key atau Token tidak valid untuk dites.' });
  }

  try {
    const testResult = await geminiClient.testKey(authData, model || 'gemini-3.8-flash');
    res.json(testResult);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------- GOOGLE OAUTH 2.0 FLOW ----------------- //

// Get OAuth status and redirect URI
router.get('/api/oauth/google/status', (req, res) => {
  const oauth = keyPool.config.oauth || {};
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'tonhermes.web.id';
  const redirectUri = oauth.redirectUri || `${protocol}://${host}/9routerui/api/oauth/google/callback`;

  res.json({
    success: true,
    configured: !!(oauth.googleClientId && oauth.googleClientSecret),
    clientId: oauth.googleClientId ? `${oauth.googleClientId.substring(0, 12)}...` : '',
    redirectUri
  });
});

// Update OAuth credentials (Client ID & Client Secret)
router.post('/api/oauth/google/config', (req, res) => {
  const { clientId, clientSecret, redirectUri } = req.body;
  if (!keyPool.config.oauth) keyPool.config.oauth = {};

  if (clientId !== undefined) keyPool.config.oauth.googleClientId = clientId.trim();
  if (clientSecret !== undefined) keyPool.config.oauth.googleClientSecret = clientSecret.trim();
  if (redirectUri !== undefined) keyPool.config.oauth.redirectUri = redirectUri.trim();

  keyPool.saveConfig();
  res.json({ success: true, message: 'Konfigurasi Google OAuth berhasil disimpan.' });
});

// Initiate Google OAuth login
router.get('/api/oauth/google/login', (req, res) => {
  const oauth = keyPool.config.oauth || {};
  if (!oauth.googleClientId) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
        <body style="background:#0b0f19;color:#fff;font-family:sans-serif;text-align:center;padding:50px;">
          <h2 style="color:#ef4444;">Google OAuth Belum Dikonfigurasi</h2>
          <p style="color:#94a3b8;">Harap masukkan Google Client ID & Secret di tab Pengaturan terlebih dahulu.</p>
          <button onclick="window.close()" style="padding:10px 20px;border-radius:8px;background:#334155;color:#fff;border:none;cursor:pointer;">Tutup Jendela</button>
        </body>
      </html>
    `);
  }

  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'tonhermes.web.id';
  const redirectUri = oauth.redirectUri || `${protocol}://${host}/9routerui/api/oauth/google/callback`;

  const scope = encodeURIComponent('https://www.googleapis.com/auth/generative-language email profile');
  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${oauth.googleClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;

  res.redirect(googleAuthUrl);
});

// OAuth Callback handler from Google
router.get('/api/oauth/google/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.send(`
      <!DOCTYPE html>
      <html>
        <body style="background:#0b0f19;color:#fff;font-family:sans-serif;text-align:center;padding:50px;">
          <h2 style="color:#ef4444;">Login Google Dibatalkan / Gagal</h2>
          <p style="color:#94a3b8;">${error}</p>
          <button onclick="window.close()" style="padding:10px 20px;border-radius:8px;background:#334155;color:#fff;border:none;cursor:pointer;">Tutup Jendela</button>
        </body>
      </html>
    `);
  }

  if (!code) {
    return res.status(400).send('Authorization code tidak ditemukan.');
  }

  const oauth = keyPool.config.oauth || {};
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'tonhermes.web.id';
  const redirectUri = oauth.redirectUri || `${protocol}://${host}/9routerui/api/oauth/google/callback`;

  try {
    // 1. Exchange code for access & refresh tokens
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: oauth.googleClientId,
        client_secret: oauth.googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenResp.json();
    if (!tokenResp.ok) {
      throw new Error(tokenData?.error_description || tokenData?.error || 'Gagal menukarkan token');
    }

    const { access_token, refresh_token, expires_in } = tokenData;

    // 2. Fetch User Profile
    const profileResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });
    const profile = await profileResp.json();

    const email = profile.email || 'unknown@gmail.com';
    const name = profile.name || email;
    const picture = profile.picture || null;

    // 3. Save into KeyPool
    keyPool.addOrUpdateOAuthAccount({
      email,
      name,
      picture,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in
    });

    // 4. Return success popup closer
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Google OAuth Berhasil</title>
          <style>
            body { background: #080c14; color: #fff; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #111827; border: 1px solid #10b981; border-radius: 16px; padding: 32px; text-align: center; max-width: 400px; box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
            .icon { font-size: 48px; color: #10b981; margin-bottom: 16px; }
            h2 { margin: 0 0 10px; font-size: 20px; }
            p { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
            .btn { background: #10b981; color: #000; font-weight: 600; padding: 10px 24px; border: none; border-radius: 8px; cursor: pointer; text-decoration: none; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">✓</div>
            <h2>Akun Google Terhubung!</h2>
            <p>Akun <b>${email}</b> berhasil ditambahkan ke Gemini Multi-Account Pool.</p>
            <button class="btn" onclick="finish()">Kembali ke Dashboard</button>
          </div>
          <script>
            function finish() {
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_SUCCESS', email: '${email}' }, '*');
                window.close();
              } else {
                window.location.href = '/9routerui/';
              }
            }
            setTimeout(finish, 1800);
          </script>
        </body>
      </html>
    `);

  } catch (err) {
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <body style="background:#0b0f19;color:#fff;font-family:sans-serif;text-align:center;padding:50px;">
          <h2 style="color:#ef4444;">Gagal Mengaitkan Akun Google</h2>
          <p style="color:#fca5a5;">${err.message}</p>
          <button onclick="window.close()" style="padding:10px 20px;border-radius:8px;background:#334155;color:#fff;border:none;cursor:pointer;">Tutup</button>
        </body>
      </html>
    `);
  }
});

// ----------------- STATS & CONFIG API ROUTES ----------------- //

router.get('/api/stats', (req, res) => {
  res.json({
    success: true,
    stats: keyPool.getStats()
  });
});

router.get('/api/config', (req, res) => {
  res.json({
    success: true,
    config: keyPool.config
  });
});

router.post('/api/config', (req, res) => {
  const { rotationStrategy, cooldownSeconds, defaultModel } = req.body;
  if (rotationStrategy) keyPool.config.rotationStrategy = rotationStrategy;
  if (cooldownSeconds) keyPool.config.cooldownSeconds = parseInt(cooldownSeconds, 10);
  if (defaultModel) keyPool.config.defaultModel = defaultModel;

  keyPool.saveConfig();
  keyPool.logEvent('INFO', `Pengaturan router diperbarui: Strategy=${keyPool.config.rotationStrategy}, Cooldown=${keyPool.config.cooldownSeconds}s`);
  res.json({ success: true, config: keyPool.config });
});

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Mount on /9routerui AND root / so both URLs work identically!
app.use('/9routerui', router);
app.use('/', router);

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log('======================================================');
  console.log('  🚀 GEMINI MULTI-ACCOUNT POOL & ROUTER ONLINE        ');
  console.log(`  🌐 Root UI Dashboard : http://localhost:${PORT}/     `);
  console.log(`  🌐 Subpath UI Route  : http://localhost:${PORT}/9routerui`);
  console.log(`  🔌 OpenAI Endpoint   : http://localhost:${PORT}/v1   `);
  console.log(`  ✨ Default Model     : ${keyPool.config.defaultModel} `);
  console.log('======================================================');
});
