/**
 * Google Gemini REST API Client
 * Supports standard JSON and Server-Sent Events (SSE) streaming.
 */

class GeminiClient {
  normalizeModelName(model) {
    if (!model) return 'gemini-3.8-flash';
    const lower = model.toLowerCase().trim();
    
    // Map custom/preview aliases or deprecated model versions to gemini-3.8-flash
    if (lower.includes('3.8') || lower.includes('3-flash') || lower.includes('2.5') || lower === 'gemini-flash') {
      return 'gemini-3.8-flash'; // Google's primary latest flash tier
    }
    if (lower.includes('pro')) {
      return 'gemini-3.8-pro';
    }
    if (lower.includes('2.0') || lower.includes('2-flash')) {
      return 'gemini-2.0-flash';
    }
    if (lower.includes('1.5')) {
      return 'gemini-1.5-flash';
    }
    return model;
  }

  convertOpenAiMessagesToGemini(messages) {
    let systemInstruction = null;
    const contents = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        systemInstruction = {
          parts: [{ text }]
        };
      } else {
        const role = msg.role === 'assistant' ? 'model' : 'user';
        let text = '';
        if (typeof msg.content === 'string') {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          text = msg.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');
        } else {
          text = JSON.stringify(msg.content);
        }

        contents.push({
          role,
          parts: [{ text: text || ' ' }]
        });
      }
    }

    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: 'Halo' }] });
    }

    return { systemInstruction, contents };
  }

  /**
   * Non-streaming call to Gemini API
   */
  async generateContent({ apiKey, authToken, authType = 'apiKey', model, messages, temperature = 0.7, maxTokens = 4096 }) {
    const targetModel = this.normalizeModelName(model);
    let url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent`;
    const headers = {
      'Content-Type': 'application/json'
    };

    if (authType === 'oauth' || authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    } else {
      url += `?key=${apiKey}`;
    }

    const { systemInstruction, contents } = this.convertOpenAiMessagesToGemini(messages);

    const payload = {
      contents,
      generationConfig: {
        temperature: Math.min(Math.max(temperature, 0), 2),
        maxOutputTokens: maxTokens
      }
    };

    if (systemInstruction) {
      payload.systemInstruction = systemInstruction;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      const errMessage = data?.error?.message || `Gemini API returned status ${response.status}`;
      const err = new Error(errMessage);
      err.status = response.status;
      err.geminiData = data;
      throw err;
    }

    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map(p => p.text).join('') || '';

    const promptTokens = data.usageMetadata?.promptTokenCount || 0;
    const completionTokens = data.usageMetadata?.candidatesTokenCount || 0;
    const totalTokens = data.usageMetadata?.totalTokenCount || (promptTokens + completionTokens);

    return {
      text,
      raw: data,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens
      },
      finishReason: candidate?.finishReason || 'STOP'
    };
  }

  /**
   * Quick key validation test with auto-fallback
   */
  async testKey(authData, model = 'gemini-3.8-flash') {
    const auth = typeof authData === 'string' ? { apiKey: authData, authType: 'apiKey' } : authData;
    let targetModel = this.normalizeModelName(model);
    let result = await this._ping(auth, targetModel);

    // If targetModel failed because of model availability (404 / deprecated), try gemini-3.8-flash or gemini-2.0-flash
    if (!result.success && (result.status === 404 || (result.error && (result.error.includes('not found') || result.error.includes('no longer available'))))) {
      if (targetModel !== 'gemini-3.8-flash') {
        const retryFlash = await this._ping(auth, 'gemini-3.8-flash');
        if (retryFlash.success) return retryFlash;
      }
      if (targetModel !== 'gemini-2.0-flash') {
        const retry2 = await this._ping(auth, 'gemini-2.0-flash');
        if (retry2.success) return retry2;
      }
    }

    return result;
  }

  async _ping(auth, targetModel) {
    let url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent`;
    const headers = { 'Content-Type': 'application/json' };

    if (auth.authType === 'oauth' || auth.authToken) {
      headers['Authorization'] = `Bearer ${auth.authToken}`;
    } else {
      url += `?key=${auth.apiKey}`;
    }

    const payload = {
      contents: [{ role: 'user', parts: [{ text: 'Ping test. Reply with word PONG only.' }] }],
      generationConfig: { maxOutputTokens: 10 }
    };

    const startTime = Date.now();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      const latency = Date.now() - startTime;

      if (!response.ok) {
        return {
          success: false,
          status: response.status,
          error: data?.error?.message || `HTTP ${response.status}`,
          latency
        };
      }

      return {
        success: true,
        status: 200,
        reply: data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'PONG',
        model: targetModel,
        latency
      };
    } catch (e) {
      return {
        success: false,
        status: 500,
        error: e.message,
        latency: Date.now() - startTime
      };
    }
  }
}

module.exports = new GeminiClient();
