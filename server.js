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

// Test a key directly
router.post('/api/keys/test', async (req, res) => {
  const { apiKey, id, model } = req.body;
  let targetKey = apiKey;

  if (!targetKey && id) {
    const found = keyPool.keys.find(k => k.id === id);
    if (found) targetKey = found.apiKey;
  }

  if (!targetKey) {
    return res.status(400).json({ success: false, message: 'API Key tidak valid untuk dites.' });
  }

  try {
    const testResult = await geminiClient.testKey(targetKey, model || 'gemini-3.8-flash');
    res.json(testResult);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
