/**
 * Open-Pax — LLM Layer: OpenAI-совместимый провайдер
 * ===================================================
 * Один адаптер на ~90% сценариев «своя модель / свой ключ»:
 * Ollama и LM Studio (у обоих OpenAI-совместимый /v1), OpenAI,
 * OpenRouter, Together, DeepSeek, GLM, Kimi и др.
 */

import { postJson } from './http';
import { LLMError, type LLMGenerateOptions, type LLMProvider, type LLMResponse } from './types';

export interface OpenAICompatibleOptions {
  /** Базовый URL, напр. http://localhost:11434/v1 или https://openrouter.ai/api/v1 */
  baseUrl: string;
  apiKey?: string;          // для Ollama/LM Studio можно любой непустой
  model: string;
  /** Путь чат-эндпоинта (по умолчанию /chat/completions; у MiniMax свой) */
  chatPath?: string;
  timeoutMs?: number;
  retries?: number;
  /** Отображаемое имя провайдера (по умолчанию 'openai-compatible') */
  name?: string;
  /** Extra headers (OpenRouter: HTTP-Referer, X-Title и т.п.) */
  extraHeaders?: Record<string, string>;
  /** Campi extra nel body della richiesta (es. reasoning_effort per i modelli reasoning) */
  extraBody?: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_RETRIES = 2;

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;

  private baseUrl: string;
  private apiKey: string;
  private chatPath: string;
  private timeoutMs: number;
  private retries: number;
  private extraHeaders: Record<string, string>;
  private extraBody: Record<string, unknown>;

  constructor(opts: OpenAICompatibleOptions) {
    this.name = opts.name || 'openai-compatible';
    this.model = opts.model;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey || '';
    this.chatPath = opts.chatPath || '/chat/completions';
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = opts.retries ?? DEFAULT_RETRIES;
    this.extraHeaders = opts.extraHeaders || {};
    this.extraBody = opts.extraBody || {};
  }

  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      ...this.extraHeaders,
    };
  }

  private buildBody(system: string, user: string, options: LLMGenerateOptions, stream: boolean) {
    return {
      model: this.model,
      messages: [
        { role: 'system', content: system },
        // user никогда не пустой: часть моделей деградирует на пустом user-сообщении
        { role: 'user', content: user || 'Esegui le istruzioni del messaggio di sistema.' },
      ],
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      ...(stream ? { stream: true } : {}),
      // Parametri extra dalla configurazione della meccanica
      // (es. reasoning_effort: "low" per limitare il reasoning dei modelli GLM)
      ...this.extraBody,
    };
  }

  async generate(system: string, user: string, options: LLMGenerateOptions = {}): Promise<LLMResponse> {
    const res = await postJson(
      `${this.baseUrl}${this.chatPath}`,
      this.buildHeaders(),
      this.buildBody(system, user, options, false),
      { timeoutMs: this.timeoutMs, retries: this.retries, providerName: this.name, signal: options.signal }
    );

    let data: any;
    try {
      data = await res.json();
    } catch {
      throw new LLMError(`${this.name}: JSON non valido nella risposta`, { provider: this.name, retriable: true });
    }

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      // Диагностика пустых ответов (reasoning-модели, фильтры, обрезка по токенам)
      try {
        const choice = data?.choices?.[0];
        console.error('[LLM] Пустой content. Диагностика:', JSON.stringify({
          finish_reason: choice?.finish_reason,
          message_keys: choice?.message ? Object.keys(choice.message) : null,
          reasoning_len: typeof choice?.message?.reasoning_content === 'string' ? choice.message.reasoning_content.length : null,
          usage: data?.usage ?? null,
          error: data?.error ?? null,
          raw_head: JSON.stringify(data)?.slice(0, 400),
        }));
      } catch { /* ignore */ }
      throw new LLMError(
        `${this.name}: risposta vuota dal modello${data?.error?.message ? ` — ${String(data.error.message).substring(0, 150)}` : ''}`,
        { provider: this.name, retriable: true }
      );
    }

    return { content, tokensUsed: data?.usage?.total_tokens };
  }

  async stream(
    system: string,
    user: string,
    onToken: (charsSoFar: number, contentSoFar?: string) => void,
    options: LLMGenerateOptions = {}
  ): Promise<LLMResponse> {
    const res = await postJson(
      `${this.baseUrl}${this.chatPath}`,
      this.buildHeaders(),
      this.buildBody(system, user, options, true),
      { timeoutMs: this.timeoutMs, retries: this.retries, providerName: this.name, stream: true, signal: options.signal }
    );

    if (!res.body) {
      throw new LLMError(`${this.name}: lo streaming non è supportato dalla risposta`, { provider: this.name, retriable: true });
    }

    // Разбор OpenAI SSE: строки "data: {json}" с delta.content
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const chunk = JSON.parse(payload);
            const delta = chunk?.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) {
              content += delta;
              onToken(content.length, content);
            }
          } catch { /* неполный JSON-чанк — пропускаем */ }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (content.length === 0) {
      // Modelli reasoning (es. GLM/MiniMax) possono spendere l'intero budget in
      // reasoning senza emettere content in streaming. Riproviamo UNA volta
      // senza streaming e con budget quadruplicato: la risposta completa
      // contiene anche il message.content finale.
      try {
        const fallback = await this.generate(system, user, { ...options, maxTokens: (options.maxTokens ?? 4096) * 4 });
        if (fallback.content.length > 0) {
          onToken(fallback.content.length, fallback.content);
          return fallback;
        }
      } catch { /* il fallback fallisce → errore originale */ }
      throw new LLMError(`${this.name}: stream vuoto dal modello`, { provider: this.name, retriable: true });
    }

    return { content };
  }
}
