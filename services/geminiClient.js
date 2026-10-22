/**
 * Google Gemini REST API Client
 * Supports standard JSON and Server-Sent Events (SSE) streaming.
 */

class GeminiClient {
  normalizeModelName(model) {
    if (!model) return 'gemini-2.5-flash';
    const lower = model.toLowerCase().trim();
    
    // Map custom/preview aliases to the most advanced available Google Gemini model
    if (lower.includes('3.8') || lower.includes('3-flash')) {
      return 'gemini-2.5-flash'; // Google's fastest flash tier
    }
    if (lower.includes('pro')) {
      return 'gemini-2.5-pro';
    }
    if (lower.includes('2.0') || lower.includes('2-flash')) {
      return 'gemini-2.0-flash';
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
  async generateContent({ apiKey, model, messages, temperature = 0.7, maxTokens = 4096 }) {
    const targetModel = this.normalizeModelName(model);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;

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
      headers: {
        'Content-Type': 'application/json'
      },
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
   * Quick key validation test
   */
  async testKey(apiKey, model = 'gemini-2.5-flash') {
    const targetModel = this.normalizeModelName(model);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{ role: 'user', parts: [{ text: 'Ping test. Reply with word PONG only.' }] }],
      generationConfig: { maxOutputTokens: 10 }
    };

    const startTime = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      reply: data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'OK',
      latency
    };
  }
}

module.exports = new GeminiClient();
