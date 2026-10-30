import type { JsonCompletion, JsonRequest, ModelUsage, SemanticProvider } from '../domain/semantic';

export const DEEPSEEK_MODEL = 'deepseek-flash';
export const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

class ProviderError extends Error {}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// 只读取标准 SSE data 帧；不执行内容、不解析模型思考字段。
async function readCompletion(body: ReadableStream<Uint8Array>): Promise<JsonCompletion> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finish: unknown;
  let done = false;
  let usage: ModelUsage = { inputTokens: null, cachedInputTokens: null, outputTokens: null };
  function frame(event: string) {
    const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (data.trim() === '[DONE]') { done = true; return; }
    let parsed: unknown;
    try { parsed = JSON.parse(data); } catch { throw new ProviderError('DeepSeek 流式响应格式错误，请重试本阶段。'); }
    const packet = record(parsed);
    if (packet.error) throw new ProviderError('DeepSeek 中断了生成，请稍后重试本阶段。');
    const first = record(Array.isArray(packet.choices) ? packet.choices[0] : undefined);
    const delta = record(first.delta);
    if (typeof delta.content === 'string') content += delta.content;
    if (first.finish_reason != null) finish = first.finish_reason;
    if (packet.usage) {
      const value = record(packet.usage);
      usage = { inputTokens: tokenCount(value.prompt_tokens),
        cachedInputTokens: tokenCount(value.prompt_cache_hit_tokens ?? record(value.prompt_tokens_details).cached_tokens),
        outputTokens: tokenCount(value.completion_tokens) };
    }
  }
  try {
    while (!done) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';
      for (const event of events) frame(event);
      if (chunk.done) { if (buffer.trim()) frame(buffer); break; }
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  if (finish === 'length') throw new ProviderError('DeepSeek 输出达到长度上限，本阶段结果未保存。请使用较短的分享会话后重试。');
  if (finish !== 'stop' || !content.trim()) throw new ProviderError('DeepSeek 未返回完整结果，请重试本阶段。');
  try { return { data: JSON.parse(content), usage }; }
  catch { throw new ProviderError('DeepSeek 返回的 JSON 无法解析，请重试本阶段。'); }
}

export class DeepSeekProvider implements SemanticProvider {
  constructor(private readonly apiKey: string) {}

  async completeJson(request: JsonRequest, signal?: AbortSignal): Promise<JsonCompletion> {
    if (!this.apiKey.trim()) throw new ProviderError('请先在插件中设置 DeepSeek API Key。');
    const combined = AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]);
    try {
      const response = await fetch(DEEPSEEK_ENDPOINT, {
        method: 'POST', credentials: 'omit', signal: combined,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey.trim()}` },
        body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: [{ role: 'system', content: request.system }, { role: 'user', content: JSON.stringify(request.input) }],
          response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, stream: true, stream_options: { include_usage: true }, max_tokens: 16384 }),
      });
      if (!response.ok) {
        const errors: Record<number, string> = { 401: 'DeepSeek 密钥无效，请重新设置。', 402: 'DeepSeek 账户余额不足，请检查 API 账户。', 429: 'DeepSeek 请求过于频繁，请稍后重试。' };
        throw new ProviderError(errors[response.status] ?? `DeepSeek 请求失败（HTTP ${response.status}），请稍后重试。`);
      }
      if (!response.body) throw new ProviderError('DeepSeek 响应为空，请重试本阶段。');
      return await readCompletion(response.body);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (combined.aborted) throw new ProviderError(signal?.aborted ? '生成已取消。' : 'DeepSeek 生成超时，本阶段结果未保存，请稍后重试。');
      // 不回传网络原始异常或供应商错误正文，避免把密钥或会话片段写入界面和日志。
      throw new ProviderError('无法连接 DeepSeek，请检查网络及插件的网站访问权限后重试。');
    }
  }
}
