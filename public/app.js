/**
 * GEMINI 3.8 FLASH MULTI-ACCOUNT POOL - FRONTEND CONTROLLER
 */

// Global State
let keysList = [];
let statsData = {};
let chatHistory = [];
let isGenerating = false;

// Snippets for 9router tab
const curlSnippet = `curl -X POST http://localhost:3003/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gemini-3.8-flash",
    "messages": [
      {"role": "user", "content": "Halo Gemini 3.8 Flash!"}
    ]
  }'`;

const pythonSnippet = `from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3003/v1",
    api_key="gemini-pool-active"
)

response = client.chat.completions.create(
    model="gemini-3.8-flash",
    messages=[{"role": "user", "content": "Halo Gemini!"}]
)
print(response.choices[0].message.content)`;

const jsSnippet = `import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://localhost:3003/v1',
  apiKey: 'gemini-pool-token'
});

const res = await openai.chat.completions.create({
  model: 'gemini-3.8-flash',
  messages: [{ role: 'user', content: 'Halo dari Node.js!' }]
});
console.log(res.choices[0].message.content);`;

// Init on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initChat();
  initKeyModal();
  initStrategySettings();
  
  // Initial data fetch
  fetchKeys();
  fetchStats();

  // Poll stats every 3 seconds for live tracking
  setInterval(() => {
    fetchStats();
  }, 3000);
});

/* ==================== 1. TABS SYSTEM ==================== */
function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const panes = document.querySelectorAll('.tab-pane');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');

      tabBtns.forEach(b => b.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');

      if (targetId === 'tab-keys') fetchKeys();
      if (targetId === 'tab-analytics') fetchStats();
    });
  });
}

/* ==================== 2. CHATBOT INTERFACE ==================== */
function initChat() {
  const input = document.getElementById('chat-user-input');
  const sendBtn = document.getElementById('btn-send-chat');
  const clearBtn = document.getElementById('btn-clear-chat');
  const tempSlider = document.getElementById('chat-temp-slider');
  const tempDisplay = document.getElementById('temp-display');
  const modelSelect = document.getElementById('chat-model-select');
  const modelIndicator = document.getElementById('chat-model-indicator');

  if (tempSlider && tempDisplay) {
    tempSlider.addEventListener('input', (e) => {
      tempDisplay.textContent = e.target.value;
    });
  }

  if (modelSelect && modelIndicator) {
    modelSelect.addEventListener('change', (e) => {
      modelIndicator.textContent = `Model: ${e.target.value}`;
    });
  }

  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Auto-grow textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', sendMessage);
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      chatHistory = [];
      const container = document.getElementById('chat-messages');
      if (container) {
        container.innerHTML = `
          <div class="message-wrapper assistant-msg">
            <div class="avatar-box ai-avatar"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
            <div class="message-content-wrap">
              <div class="message-meta-header">
                <span class="sender-name">GEMINI 3.8 FLASH</span>
                <span class="badge-meta">MULTI-ACCOUNT POOL</span>
              </div>
              <div class="message-bubble">
                <p>Riwayat percakapan telah dibersihkan. Silakan ajukan pertanyaan baru!</p>
              </div>
            </div>
          </div>
        `;
      }
      showToast('Riwayat chat telah dibersihkan.');
    });
  }
}

async function sendMessage() {
  if (isGenerating) return;

  const input = document.getElementById('chat-user-input');
  const text = (input?.value || '').trim();
  if (!text) return;

  const model = document.getElementById('chat-model-select')?.value || 'gemini-3.8-flash';
  const temperature = parseFloat(document.getElementById('chat-temp-slider')?.value || '0.7');
  const systemPrompt = (document.getElementById('chat-system-prompt')?.value || '').trim();

  // Append user message
  appendMessage('user', text);
  input.value = '';
  input.style.height = 'auto';

  // Construct message array
  const messagesToSend = [];
  if (systemPrompt) {
    messagesToSend.push({ role: 'system', content: systemPrompt });
  }

  chatHistory.push({ role: 'user', content: text });
  // Add last 10 messages for context
  chatHistory.slice(-10).forEach(m => messagesToSend.push(m));

  // Show thinking indicator
  isGenerating = true;
  toggleSendBtn(true);
  const thinkingId = appendThinkingIndicator();

  try {
    const res = await fetch('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: messagesToSend,
        temperature
      })
    });

    const data = await res.json();
    removeThinkingIndicator(thinkingId);

    if (!res.ok) {
      const errMsg = data?.error?.message || `HTTP ${res.status}`;
      appendMessage('assistant', `⚠️ **Gagal memproses pesan:** ${errMsg}`, null, true);
      showToast(`Gagal: ${errMsg}`);
    } else {
      const reply = data.choices?.[0]?.message?.content || 'Tidak ada balasan.';
      chatHistory.push({ role: 'assistant', content: reply });
      appendMessage('assistant', reply, data);
      
      // Update sidebar active key snapshot
      if (data._meta?.handledBy) {
        updateActiveKeySnapshot(data._meta.handledBy, data.usage, data._meta.latencyMs);
      }

      fetchStats();
    }
  } catch (err) {
    removeThinkingIndicator(thinkingId);
    appendMessage('assistant', `⚠️ **Koneksi error:** ${err.message}`, null, true);
    showToast(`Error: ${err.message}`);
  } finally {
    isGenerating = false;
    toggleSendBtn(false);
  }
}

function appendMessage(role, content, rawData = null, isError = false) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  const isUser = role === 'user';
  const wrapper = document.createElement('div');
  wrapper.className = `message-wrapper ${isUser ? 'user-msg' : 'assistant-msg'}`;

  const avatar = document.createElement('div');
  avatar.className = `avatar-box ${isUser ? 'user-avatar' : 'ai-avatar'}`;
  avatar.innerHTML = isUser ? '<i class="fa-solid fa-user"></i>' : '<i class="fa-solid fa-wand-magic-sparkles"></i>';

  const contentWrap = document.createElement('div');
  contentWrap.className = 'message-content-wrap';

  // Meta header
  const metaHeader = document.createElement('div');
  metaHeader.className = 'message-meta-header';
  metaHeader.innerHTML = `
    <span class="sender-name">${isUser ? 'ANDA' : 'GEMINI 3.8 FLASH'}</span>
    <span class="badge-meta">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
  `;

  // Bubble
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  if (isError) bubble.style.borderColor = 'rgba(239, 68, 68, 0.5)';

  // Format markdown & code
  bubble.innerHTML = formatMarkdown(content);

  // If assistant and metadata exists, add attribution badge
  if (!isUser && rawData?._meta?.handledBy) {
    const meta = rawData._meta;
    const usage = rawData.usage || {};
    const footerMeta = document.createElement('div');
    footerMeta.style.cssText = 'margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 0.725rem; font-family: "JetBrains Mono", monospace; color: #94a3b8; display: flex; flex-wrap: wrap; gap: 10px;';
    
    footerMeta.innerHTML = `
      <span style="color: #00f2fe;"><i class="fa-solid fa-key"></i> ${meta.handledBy.name}</span>
      <span>•</span>
      <span><i class="fa-solid fa-coins text-amber"></i> ${usage.total_tokens || 0} tok</span>
      <span>•</span>
      <span><i class="fa-solid fa-bolt text-cyan"></i> ${meta.latencyMs || 0}ms</span>
      ${meta.attemptsCount > 1 ? `<span style="color:#f59e0b;"><i class="fa-solid fa-arrows-rotate"></i> Failover ke-${meta.attemptsCount}</span>` : ''}
    `;
    bubble.appendChild(footerMeta);
  }

  contentWrap.appendChild(metaHeader);
  contentWrap.appendChild(bubble);

  wrapper.appendChild(avatar);
  wrapper.appendChild(contentWrap);

  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
}

function appendThinkingIndicator() {
  const container = document.getElementById('chat-messages');
  if (!container) return null;

  const id = `thinking-${Date.now()}`;
  const wrapper = document.createElement('div');
  wrapper.id = id;
  wrapper.className = 'message-wrapper assistant-msg';
  wrapper.innerHTML = `
    <div class="avatar-box ai-avatar"><i class="fa-solid fa-wand-magic-sparkles fa-spin"></i></div>
    <div class="message-content-wrap">
      <div class="message-meta-header">
        <span class="sender-name">GEMINI 3.8 FLASH</span>
        <span class="badge-meta">SEDANG MEMPROSES...</span>
      </div>
      <div class="message-bubble" style="display:flex; align-items:center; gap:8px;">
        <span class="live-dot pulse" style="background:#00f2fe;"></span>
        <span style="color:#94a3b8; font-size:0.85rem;">Memilih akun terbaik dan merotasi pool API...</span>
      </div>
    </div>
  `;
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
  return id;
}

function removeThinkingIndicator(id) {
  if (!id) return;
  const el = document.getElementById(id);
  if (el) el.remove();
}

function toggleSendBtn(loading) {
  const btn = document.getElementById('btn-send-chat');
  const icon = document.getElementById('btn-send-icon');
  if (btn) btn.disabled = loading;
  if (icon) {
    icon.className = loading ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-arrow-up';
  }
}

function updateActiveKeySnapshot(key, usage = {}, latency = 0) {
  const nameEl = document.getElementById('active-key-name');
  const statusEl = document.getElementById('active-key-status');
  const tokensEl = document.getElementById('active-key-tokens');

  if (nameEl) nameEl.textContent = key.name;
  if (statusEl) {
    statusEl.textContent = 'ONLINE';
    statusEl.className = 'badge-status-pill badge-active';
  }
  if (tokensEl) tokensEl.textContent = `+${usage.total_tokens || 0} Tok (${latency}ms)`;
}

/* ==================== 3. KEY POOL MANAGER ==================== */
async function fetchKeys() {
  try {
    const res = await fetch('/api/keys');
    const data = await res.json();
    if (data.success && Array.isArray(data.keys)) {
      keysList = data.keys;
      renderKeyCards(keysList);
      
      const badge = document.getElementById('nav-key-count');
      if (badge) badge.textContent = keysList.length;
    }
  } catch (err) {
    console.error('Failed to fetch keys:', err);
  }
}

function renderKeyCards(keys) {
  const container = document.getElementById('keys-card-container');
  if (!container) return;

  if (keys.length === 0) {
    container.innerHTML = `
      <div class="empty-keys-placeholder">
        <i class="fa-solid fa-key-skeleton text-muted"></i>
        <h3>Belum ada API Key Gemini ditambahkan</h3>
        <p>Klik tombol <b>Tambah Akun / API Key</b> di atas untuk menambahkan akun Google Anda.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = keys.map((k, index) => {
    const pct = Math.min(100, Math.round(((k.tokensUsed || 0) / (k.quotaLimit || 1000000)) * 100));
    const isExhausted = k.status === 'EXHAUSTED';
    const isCooling = k.status === 'COOLING_DOWN';
    
    let statusClass = 'badge-active';
    let statusText = 'ACTIVE';

    if (isExhausted) {
      statusClass = 'badge-exhausted';
      statusText = 'KUOTA HABIS';
    } else if (isCooling) {
      statusClass = 'badge-cooling';
      const secLeft = Math.max(1, Math.round(((k.coolingUntil || 0) - Date.now()) / 1000));
      statusText = `RATE LIMIT (${secLeft}s)`;
    } else if (!k.active) {
      statusClass = 'badge-exhausted';
      statusText = 'NONAKTIF';
    }

    return `
      <div class="key-card">
        <div class="key-card-header">
          <div class="key-title-group">
            <h4>${escapeHtml(k.name)}</h4>
            <span class="key-masked-code">${k.maskedKey || 'Belum ada key'}</span>
          </div>
          <span class="badge-status-pill ${statusClass}">${statusText}</span>
        </div>

        <div class="key-progress-wrap">
          <div class="key-progress-meta">
            <span>Pemakaian Kuota</span>
            <strong>${(k.tokensUsed || 0).toLocaleString()} / ${(k.quotaLimit || 1000000).toLocaleString()} Tok (${pct}%)</strong>
          </div>
          <div class="progress-track">
            <div class="progress-fill ${pct > 80 ? 'fill-warn' : ''}" style="width: ${pct}%;"></div>
          </div>
        </div>

        <div class="key-stats-row">
          <div class="ks-item">
            <span>Requests</span>
            <strong>${k.requestCount || 0}</strong>
          </div>
          <div class="ks-item">
            <span>Sukses</span>
            <strong style="color: #10b981;">${k.successCount || 0}</strong>
          </div>
          <div class="ks-item">
            <span>Fail / Limit</span>
            <strong style="color: ${k.failCount > 0 ? '#ef4444' : '#94a3b8'};">${k.failCount || 0}</strong>
          </div>
        </div>

        <div class="key-actions-row">
          <div style="display: flex; gap: 8px;">
            <button type="button" class="btn-card-action" onclick="testKeyAction('${k.id}')" title="Test validitas API Key">
              <i class="fa-solid fa-vial"></i> Test
            </button>
            <button type="button" class="btn-card-action" onclick="toggleKeyAction('${k.id}')" title="Nyalakan / Matikan">
              <i class="fa-solid ${k.active ? 'fa-toggle-on text-green' : 'fa-toggle-off'}"></i> ${k.active ? 'Aktif' : 'Off'}
            </button>
          </div>
          <button type="button" class="btn-card-action btn-danger-action" onclick="deleteKeyAction('${k.id}', '${escapeHtml(k.name)}')" title="Hapus Akun">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/* ==================== 4. MODAL LOGIC ==================== */
function initKeyModal() {
  const modal = document.getElementById('modal-key-backdrop');
  const openBtn = document.getElementById('btn-modal-add-key');
  const closeBtn = document.getElementById('btn-close-modal');
  const form = document.getElementById('form-key');
  const pwToggle = document.getElementById('btn-toggle-pw');
  const testBtn = document.getElementById('btn-test-modal-key');

  if (openBtn) {
    openBtn.addEventListener('click', () => {
      document.getElementById('key-edit-id').value = '';
      document.getElementById('key-input-name').value = '';
      document.getElementById('key-input-apikey').value = '';
      document.getElementById('key-input-quota').value = '1000000';
      document.getElementById('modal-test-result').style.display = 'none';
      document.getElementById('modal-key-title').textContent = 'Tambah Akun Gemini Baru';
      modal.style.display = 'flex';
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }

  if (pwToggle) {
    pwToggle.addEventListener('click', () => {
      const input = document.getElementById('key-input-apikey');
      const icon = document.getElementById('pw-eye-icon');
      if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fa-regular fa-eye-slash';
      } else {
        input.type = 'password';
        icon.className = 'fa-regular fa-eye';
      }
    });
  }

  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      const apiKey = document.getElementById('key-input-apikey').value.trim();
      const testArea = document.getElementById('modal-test-result');
      if (!apiKey) {
        showToast('Masukkan API Key terlebih dahulu.');
        return;
      }

      testArea.style.display = 'block';
      testArea.style.background = 'rgba(0, 242, 254, 0.1)';
      testArea.style.border = '1px solid var(--primary-cyan)';
      testArea.style.color = '#fff';
      testArea.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menghubungi Google Gemini API...';

      try {
        const res = await fetch('/api/keys/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey })
        });
        const data = await res.json();
        if (data.success) {
          testArea.style.background = 'rgba(16, 185, 129, 0.15)';
          testArea.style.borderColor = 'rgba(16, 185, 129, 0.4)';
          testArea.style.color = '#6ee7b7';
          testArea.innerHTML = `<i class="fa-solid fa-circle-check"></i> <b>Koneksi Sukses (200 OK)!</b> Response: "${data.reply}" (${data.latency}ms)`;
        } else {
          testArea.style.background = 'rgba(239, 68, 68, 0.15)';
          testArea.style.borderColor = 'rgba(239, 68, 68, 0.4)';
          testArea.style.color = '#fca5a5';
          testArea.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> <b>Test Gagal:</b> ${data.error || 'API Key tidak valid'}`;
        }
      } catch (e) {
        testArea.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> <b>Error:</b> ${e.message}`;
      }
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('key-input-name').value.trim();
      const apiKey = document.getElementById('key-input-apikey').value.trim();
      const quotaLimit = parseInt(document.getElementById('key-input-quota').value, 10);

      try {
        const res = await fetch('/api/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, apiKey, quotaLimit })
        });
        const data = await res.json();
        if (data.success) {
          showToast(`Akun "${name}" berhasil ditambahkan ke pool!`);
          modal.style.display = 'none';
          fetchKeys();
          fetchStats();
        } else {
          showToast(`Gagal: ${data.message}`);
        }
      } catch (err) {
        showToast(`Error: ${err.message}`);
      }
    });
  }
}

/* ==================== 5. ACTIONS: TEST, TOGGLE, DELETE ==================== */
async function testKeyAction(id) {
  showToast('Mengetes akun...');
  try {
    const res = await fetch('/api/keys/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`✅ Akun valid & aktif! Kecepatan: ${data.latency}ms`);
    } else {
      showToast(`❌ Gagal: ${data.error}`);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

async function toggleKeyAction(id) {
  try {
    const res = await fetch(`/api/keys/${id}/toggle`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`Status akun telah diubah.`);
      fetchKeys();
      fetchStats();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

async function deleteKeyAction(id, name) {
  if (!confirm(`Yakin ingin menghapus akun "${name}" dari pool?`)) return;

  try {
    const res = await fetch(`/api/keys/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`Akun "${name}" telah dihapus.`);
      fetchKeys();
      fetchStats();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/* ==================== 6. STRATEGY SETTINGS ==================== */
function initStrategySettings() {
  const saveBtn = document.getElementById('btn-save-strategy');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const rotationStrategy = document.getElementById('select-rotation-strategy')?.value || 'failover';
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rotationStrategy })
        });
        const data = await res.json();
        if (data.success) {
          showToast(`Metode rotasi diperbarui ke: ${rotationStrategy}`);
          fetchStats();
        }
      } catch (err) {
        showToast(`Gagal memperbarui strategi: ${err.message}`);
      }
    });
  }

  const refreshStatsBtn = document.getElementById('btn-refresh-stats');
  if (refreshStatsBtn) {
    refreshStatsBtn.addEventListener('click', () => {
      fetchStats();
      showToast('Data analitik diperbarui.');
    });
  }
}

/* ==================== 7. STATS & ANALYTICS FETCH ==================== */
async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    if (data.success && data.stats) {
      statsData = data.stats;
      updateStatsUI(statsData);
    }
  } catch (e) {}
}

function updateStatsUI(s) {
  // Top Navbar Quick Chips
  const chipAcc = document.getElementById('chip-accounts-text');
  const chipStrat = document.getElementById('chip-strategy-text');
  const chipTok = document.getElementById('chip-tokens-text');

  if (chipAcc) chipAcc.textContent = `${s.activeKeys} / ${s.totalKeys} Akun Aktif`;
  if (chipStrat) chipStrat.textContent = s.rotationStrategy === 'failover' ? 'Failover Mode' : (s.rotationStrategy === 'round-robin' ? 'Round Robin' : 'Least Used');
  if (chipTok) chipTok.textContent = `${(s.totalTokensUsed || 0).toLocaleString()} Tokens`;

  // KPI Cards in Tab 3
  const kpiTokens = document.getElementById('kpi-total-tokens');
  const kpiRate = document.getElementById('kpi-success-rate');
  const kpiSuccessDetail = document.getElementById('kpi-success-detail');
  const kpiActive = document.getElementById('kpi-active-keys');
  const kpiActiveSub = document.getElementById('kpi-active-sub');
  const kpiQuota = document.getElementById('kpi-remaining-quota');

  if (kpiTokens) kpiTokens.textContent = (s.totalTokensUsed || 0).toLocaleString();
  if (kpiRate) kpiRate.textContent = `${s.successRate || 100}%`;
  if (kpiSuccessDetail) kpiSuccessDetail.textContent = `${s.totalSuccess || 0} dari ${s.totalRequests || 0} request`;
  if (kpiActive) kpiActive.textContent = `${s.activeKeys || 0} / ${s.totalKeys || 0}`;
  if (kpiActiveSub) {
    if (s.coolingKeys > 0) {
      kpiActiveSub.textContent = `${s.coolingKeys} akun sedang cooldown`;
      kpiActiveSub.style.color = '#f59e0b';
    } else {
      kpiActiveSub.textContent = 'Semua akun standby optimal';
      kpiActiveSub.style.color = '#64748b';
    }
  }
  if (kpiQuota) kpiQuota.textContent = (s.remainingTokens || 0).toLocaleString();

  // Strategy select sync
  const stratSelect = document.getElementById('select-rotation-strategy');
  if (stratSelect && s.rotationStrategy && stratSelect.value !== s.rotationStrategy) {
    stratSelect.value = s.rotationStrategy;
  }

  // Event Logs Table
  const tbody = document.getElementById('logs-tbody');
  if (tbody && Array.isArray(s.eventLogs) && s.eventLogs.length > 0) {
    tbody.innerHTML = s.eventLogs.map(log => {
      let badgeStyle = 'color: #38bdf8;';
      if (log.type === 'RATE_LIMIT') badgeStyle = 'color: #f59e0b;';
      if (log.type === 'EXHAUSTED' || log.type === 'ERROR') badgeStyle = 'color: #ef4444;';
      if (log.type === 'SWITCH') badgeStyle = 'color: #c084fc; font-weight: 700;';
      if (log.type === 'RECOVERED') badgeStyle = 'color: #10b981;';

      return `
        <tr>
          <td style="font-family: 'JetBrains Mono', monospace; font-size: 0.775rem; color: #94a3b8;">${log.timeFormatted || log.timestamp}</td>
          <td><span style="${badgeStyle}">[${log.type}]</span></td>
          <td>${escapeHtml(log.message)}</td>
        </tr>
      `;
    }).join('');
  }
}

/* ==================== 8. UTILITIES ==================== */
function formatMarkdown(text) {
  if (!text) return '';
  let escaped = escapeHtml(text);

  // Bold **text**
  escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Italic *text*
  escaped = escaped.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Code blocks ```lang ... ```
  escaped = escaped.replace(/```([a-z0-9]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Inline code `code`
  escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Paragraphs
  const paragraphs = escaped.split('\n\n');
  return paragraphs.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function copyText(str) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(str).then(() => {
      showToast('Teks berhasil disalin ke clipboard!');
    });
  } else {
    showToast('Clipboard API tidak didukung.');
  }
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}
