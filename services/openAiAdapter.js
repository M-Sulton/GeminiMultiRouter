const crypto = require('crypto');
const geminiClient = require('./geminiClient');
const keyPool = require('./keyPoolManager');

class OpenAiAdapter {
  /**
   * Handle incoming /v1/chat/completions request with auto-failover across multiple accounts
   */
  async handleChatCompletion(req, res) {
    const {
      model = 'gemini-3.8-flash',
      messages = [],
      temperature = 0.7,
      max_tokens = 4096,
      stream = false
    } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: {
          message: 'messages array is required and cannot be empty.',
          type: 'invalid_request_error',
          code: 'missing_required_parameter'
        }
      });
    }

    const maxRetries = keyPool.config.maxRetries || 3;
    const triedKeyIds = [];
    let lastError = null;
    const startTime = Date.now();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let currentKey = null;

      try {
        currentKey = keyPool.getNextKey(triedKeyIds);
        triedKeyIds.push(currentKey.id);
      } catch (poolErr) {
        return res.status(503).json({
          error: {
            message: poolErr.message,
            type: 'pool_exhausted_error',
            code: 'no_available_keys'
          }
        });
      }

      console.log(`[Adapter] [Attempt ${attempt}/${maxRetries}] Menjalankan request menggunakan: ${currentKey.name} (${currentKey.maskedKey})`);

      try {
        const result = await geminiClient.generateContent({
          apiKey: currentKey.apiKey,
          model,
          messages,
          temperature,
          maxTokens: max_tokens
        });

        // Record successful token consumption
        const latency = Date.now() - startTime;
        keyPool.recordKeySuccess(
          currentKey.id,
          result.usage.promptTokens,
          result.usage.completionTokens,
          result.usage.totalTokens
        );

        if (attempt > 1) {
          keyPool.logEvent('SUCCESS', `Request berhasil diselesaikan oleh ${currentKey.name} setelah failover (${result.usage.totalTokens} tokens).`);
        }

        // OpenAI-compatible response format
        const responsePayload = {
          id: `chatcmpl-${crypto.randomUUID()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: model || 'gemini-3.8-flash',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: result.text
              },
              finish_reason: result.finishReason === 'STOP' ? 'stop' : result.finishReason.toLowerCase()
            }
          ],
          usage: {
            prompt_tokens: result.usage.promptTokens,
            completion_tokens: result.usage.completionTokens,
            total_tokens: result.usage.totalTokens
          },
          // Custom metadata headers for Hermes / 9router UI
          _meta: {
            handledBy: {
              id: currentKey.id,
              name: currentKey.name,
              maskedKey: currentKey.maskedKey
            },
            latencyMs: latency,
            attemptsCount: attempt
          }
        };

        res.setHeader('X-Gemini-Account', currentKey.name);
        res.setHeader('X-Gemini-Attempts', attempt);
        res.setHeader('X-Gemini-Latency', `${latency}ms`);
        return res.json(responsePayload);

      } catch (err) {
        lastError = err;
        const statusCode = err.status || 500;
        console.warn(`[Adapter] ⚠️ Gagal pada ${currentKey.name} (Status: ${statusCode}): ${err.message}`);

        // Register failure and trigger auto-cooldown/exhaustion
        keyPool.handleKeyFailure(currentKey.id, statusCode, err.message);

        // If not last attempt, log switch notice and continue loop to next account
        if (attempt < maxRetries) {
          keyPool.logEvent('SWITCH', `Otomatis beralih akun: ${currentKey.name} gagal (${statusCode}) -> Mencoba akun berikutnya.`);
        }
      }
    }

    // All retries failed
    return res.status(lastError?.status || 500).json({
      error: {
        message: `Seluruh akun Gemini yang dicoba gagal: ${lastError?.message || 'Unknown error'}`,
        type: 'api_error',
        code: lastError?.status || 500
      }
    });
  }

  /**
   * Return models list formatted like OpenAI /v1/models
   */
  getModelsList() {
    const models = [
      { id: 'gemini-3.8-flash', object: 'model', created: 1730000000, owned_by: 'google-hermes-pool' },
      { id: 'gemini-3.8-pro', object: 'model', created: 1730000000, owned_by: 'google' },
      { id: 'gemini-2.0-flash', object: 'model', created: 1720000000, owned_by: 'google' },
      { id: 'gemini-1.5-flash', object: 'model', created: 1710000000, owned_by: 'google' }
    ];

    return {
      object: 'list',
      data: models
    };
  }
}

module.exports = new OpenAiAdapter();
