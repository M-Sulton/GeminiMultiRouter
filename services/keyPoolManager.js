const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class KeyPoolManager {
  constructor() {
    this.keysFilePath = path.join(__dirname, '..', 'data', 'keys.json');
    this.configFilePath = path.join(__dirname, '..', 'data', 'config.json');
    
    this.keys = [];
    this.config = {};
    this.roundRobinIndex = 0;
    this.eventLogs = [];
    
    this.loadConfig();
    this.loadKeys();
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configFilePath)) {
        this.config = JSON.parse(fs.readFileSync(this.configFilePath, 'utf8'));
      } else {
        this.config = {
          port: 3003,
          defaultModel: 'gemini-3.8-flash',
          rotationStrategy: 'failover',
          cooldownSeconds: 60,
          maxRetries: 3
        };
      }
    } catch (e) {
      console.error('[KeyPool] Gagal membaca config.json:', e.message);
    }
  }

  saveConfig() {
    try {
      fs.writeFileSync(this.configFilePath, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (e) {
      console.error('[KeyPool] Gagal menyimpan config.json:', e.message);
    }
  }

  loadKeys() {
    try {
      if (fs.existsSync(this.keysFilePath)) {
        this.keys = JSON.parse(fs.readFileSync(this.keysFilePath, 'utf8'));
      } else {
        this.keys = [];
      }
    } catch (e) {
      console.error('[KeyPool] Gagal membaca keys.json:', e.message);
      this.keys = [];
    }
  }

  saveKeys() {
    try {
      fs.writeFileSync(this.keysFilePath, JSON.stringify(this.keys, null, 2), 'utf8');
    } catch (e) {
      console.error('[KeyPool] Gagal menyimpan keys.json:', e.message);
    }
  }

  logEvent(type, message, details = {}) {
    const entry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      timeFormatted: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      type, // 'SWITCH', 'RATE_LIMIT', 'EXHAUSTED', 'RECOVERED', 'SUCCESS', 'INFO'
      message,
      details
    };
    this.eventLogs.unshift(entry);
    if (this.eventLogs.length > 80) {
      this.eventLogs.pop();
    }
    console.log(`[KeyPool ${entry.timeFormatted}] [${type}] ${message}`);
  }

  /**
   * Reset cooling down keys if cooldown period has elapsed
   */
  refreshCooldowns() {
    const now = Date.now();
    let updated = false;

    this.keys.forEach(k => {
      if (k.status === 'COOLING_DOWN' && k.coolingUntil && now >= k.coolingUntil) {
        k.status = 'ACTIVE';
        k.coolingUntil = 0;
        updated = true;
        this.logEvent('RECOVERED', `Akun ${k.name} telah selesai masa cooldown dan kembali ACTIVE.`);
      }
    });

    if (updated) {
      this.saveKeys();
    }
  }

  /**
   * Get the next available active Gemini API Key
   */
  getNextKey(excludeKeyIds = []) {
    this.refreshCooldowns();

    const activeKeys = this.keys.filter(k => 
      k.active !== false && 
      k.apiKey && 
      k.apiKey.trim().length > 10 &&
      k.status === 'ACTIVE' &&
      !excludeKeyIds.includes(k.id)
    );

    if (activeKeys.length === 0) {
      const coolingKeys = this.keys.filter(k => k.status === 'COOLING_DOWN');
      if (coolingKeys.length > 0) {
        const nextRecover = Math.min(...coolingKeys.map(k => k.coolingUntil || Date.now() + 60000));
        const waitSec = Math.max(1, Math.round((nextRecover - Date.now()) / 1000));
        throw new Error(`Semua Akun Gemini sedang Rate-Limited. Akun terdekat akan aktif kembali dalam ${waitSec} detik.`);
      }
      throw new Error('Tidak ada akun Gemini API yang aktif dan memiliki kuota tersedia. Silakan tambahkan atau aktifkan API key di tab Manajemen Akun.');
    }

    const strategy = this.config.rotationStrategy || 'failover';

    if (strategy === 'round-robin') {
      this.roundRobinIndex = this.roundRobinIndex % activeKeys.length;
      const selected = activeKeys[this.roundRobinIndex];
      this.roundRobinIndex = (this.roundRobinIndex + 1) % activeKeys.length;
      return selected;
    }

    if (strategy === 'least-used') {
      const sorted = [...activeKeys].sort((a, b) => (a.tokensUsed || 0) - (b.tokensUsed || 0));
      return sorted[0];
    }

    // Default: 'failover' (Sequential Priority)
    return activeKeys[0];
  }

  /**
   * Handle error on a specific key (rate limit / quota exhausted / invalid)
   */
  handleKeyFailure(keyId, statusCode, errorMsg = '') {
    const key = this.keys.find(k => k.id === keyId);
    if (!key) return;

    key.failCount = (key.failCount || 0) + 1;
    key.lastError = errorMsg;

    const lowerMsg = String(errorMsg).toLowerCase();
    const isRateLimit = statusCode === 429 || lowerMsg.includes('quota') || lowerMsg.includes('resource_exhausted') || lowerMsg.includes('rate limit');
    const isExhausted = statusCode === 403 || lowerMsg.includes('quota exceeded') || lowerMsg.includes('billing');

    if (isExhausted) {
      key.status = 'EXHAUSTED';
      this.logEvent('EXHAUSTED', `Kuota Akun ${key.name} telah habis (Status ${statusCode}). Akun ini dinonaktifkan sementara.`, { keyId, errorMsg });
    } else if (isRateLimit) {
      const cooldownSec = this.config.cooldownSeconds || 60;
      key.status = 'COOLING_DOWN';
      key.coolingUntil = Date.now() + (cooldownSec * 1000);
      this.logEvent('RATE_LIMIT', `Akun ${key.name} terkena batas laju (Rate Limit 429). Masuk cooldown selama ${cooldownSec} detik.`, { keyId });
    } else {
      key.status = 'ERROR';
      this.logEvent('ERROR', `Akun ${key.name} mengalami error (Status ${statusCode}): ${errorMsg}`, { keyId });
    }

    this.saveKeys();
  }

  /**
   * Record successful token usage
   */
  recordKeySuccess(keyId, promptTokens = 0, completionTokens = 0, totalTokens = 0) {
    const key = this.keys.find(k => k.id === keyId);
    if (!key) return;

    const tokensToAdd = totalTokens > 0 ? totalTokens : (promptTokens + completionTokens);
    key.tokensUsed = (key.tokensUsed || 0) + tokensToAdd;
    key.requestCount = (key.requestCount || 0) + 1;
    key.successCount = (key.successCount || 0) + 1;
    key.lastUsed = new Date().toISOString();
    key.lastError = null;

    if (key.status !== 'ACTIVE') {
      key.status = 'ACTIVE';
    }

    this.saveKeys();
  }

  /**
   * CRUD Operations
   */
  getAllKeys() {
    this.refreshCooldowns();
    return this.keys.map(k => ({
      ...k,
      // Mask key for safety in frontend: AIzaSy...xxxx
      maskedKey: k.apiKey ? `${k.apiKey.substring(0, 8)}...${k.apiKey.substring(k.apiKey.length - 4)}` : 'Belum diisi',
      hasKey: !!k.apiKey && k.apiKey.trim().length > 10
    }));
  }

  addKey(data) {
    const newKey = {
      id: `key-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: data.name || `Akun ${this.keys.length + 1}`,
      apiKey: (data.apiKey || '').trim(),
      active: data.active !== false,
      status: 'ACTIVE',
      quotaLimit: parseInt(data.quotaLimit || 1000000, 10),
      tokensUsed: 0,
      requestCount: 0,
      successCount: 0,
      failCount: 0,
      coolingUntil: 0,
      lastUsed: null,
      lastError: null
    };

    this.keys.push(newKey);
    this.saveKeys();
    this.logEvent('INFO', `Akun baru ditambahkan: ${newKey.name}`);
    return newKey;
  }

  updateKey(id, data) {
    const key = this.keys.find(k => k.id === id);
    if (!key) return null;

    if (data.name !== undefined) key.name = data.name;
    if (data.apiKey !== undefined && data.apiKey.trim() !== '') key.apiKey = data.apiKey.trim();
    if (data.active !== undefined) key.active = data.active;
    if (data.status !== undefined) key.status = data.status;
    if (data.quotaLimit !== undefined) key.quotaLimit = parseInt(data.quotaLimit, 10);
    if (data.resetTokens) {
      key.tokensUsed = 0;
      key.requestCount = 0;
      key.successCount = 0;
      key.failCount = 0;
      key.status = 'ACTIVE';
      key.lastError = null;
    }

    this.saveKeys();
    this.logEvent('INFO', `Akun ${key.name} diperbarui.`);
    return key;
  }

  deleteKey(id) {
    const idx = this.keys.findIndex(k => k.id === id);
    if (idx === -1) return false;
    const deleted = this.keys.splice(idx, 1)[0];
    this.saveKeys();
    this.logEvent('INFO', `Akun ${deleted.name} dihapus dari pool.`);
    return true;
  }

  toggleKey(id) {
    const key = this.keys.find(k => k.id === id);
    if (!key) return null;
    key.active = !key.active;
    this.saveKeys();
    this.logEvent('INFO', `Akun ${key.name} ${key.active ? 'diaktifkan' : 'dinonaktifkan'}.`);
    return key;
  }

  getStats() {
    this.refreshCooldowns();
    const totalKeys = this.keys.length;
    const activeKeys = this.keys.filter(k => k.active !== false && k.status === 'ACTIVE').length;
    const coolingKeys = this.keys.filter(k => k.status === 'COOLING_DOWN').length;
    const exhaustedKeys = this.keys.filter(k => k.status === 'EXHAUSTED').length;

    const totalTokensUsed = this.keys.reduce((sum, k) => sum + (k.tokensUsed || 0), 0);
    const totalRequests = this.keys.reduce((sum, k) => sum + (k.requestCount || 0), 0);
    const totalSuccess = this.keys.reduce((sum, k) => sum + (k.successCount || 0), 0);
    const totalQuota = this.keys.reduce((sum, k) => sum + (k.quotaLimit || 0), 0);

    return {
      totalKeys,
      activeKeys,
      coolingKeys,
      exhaustedKeys,
      totalTokensUsed,
      totalQuota,
      remainingTokens: Math.max(0, totalQuota - totalTokensUsed),
      totalRequests,
      totalSuccess,
      successRate: totalRequests > 0 ? Math.round((totalSuccess / totalRequests) * 100) : 100,
      rotationStrategy: this.config.rotationStrategy || 'failover',
      defaultModel: this.config.defaultModel || 'gemini-3.8-flash',
      eventLogs: this.eventLogs.slice(0, 30)
    };
  }
}

module.exports = new KeyPoolManager();
