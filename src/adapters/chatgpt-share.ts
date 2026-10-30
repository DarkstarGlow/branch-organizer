import { decodeLoader, extractLoaderPayload, parseLegacyShare } from 'chatgpt-share-parser';
import type { Conversation, Workspace } from '../domain/conversation';
import { buildTimeline } from '../domain/step-engine';

export function normalizeShareUrl(input: string): { key: string; url: string } {
  let url: URL;
  try { url = new URL(input.trim()); }
  catch { throw new Error('请输入完整的 ChatGPT 分享链接，例如 https://chatgpt.com/share/…'); }
  const match = url.pathname.match(/^\/share\/(?:e\/)?([a-f0-9-]{36})\/?$/i);
  const shareId = match?.[1];
  if (url.protocol !== 'https:' || !['chatgpt.com', 'chat.openai.com'].includes(url.hostname) ||
    url.username || url.password || url.port || !shareId ||
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(shareId)) {
    throw new Error('只支持公开的 ChatGPT Share Link；请使用“分享”生成的链接，不是 /c/ 私有会话地址。');
  }
  const key = shareId.toLowerCase();
  return { key, url: `https://chatgpt.com/share/${key}` };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function parseVisibleMessages(html: string) {
  const loader = extractLoaderPayload(html);
  let data: Record<string, unknown>;
  if (loader) {
    const loaderData = record(decodeLoader(loader).loaderData);
    data = record(record(record(loaderData['routes/share.$shareId.($action)']).serverResponse).data);
  } else {
    const raw = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
    if (!raw) throw new Error('Share payload missing');
    data = record(record(record(record(record(JSON.parse(raw)).props).pageProps).serverResponse).data);
  }
  if (!Array.isArray(data.linear_conversation)) throw new Error('Conversation sequence missing');
  const mapping = record(data.mapping);
  const replies = data.linear_conversation.flatMap((entry: unknown) => {
    const item = record(entry);
    const node = typeof item.id === 'string' ? record(mapping[item.id] ?? item) : item;
    const message = record(node.message);
    const metadata = record(message.metadata);
    if (metadata.is_visually_hidden_from_conversation === true || metadata.is_user_system_message === true) return [];
    const content = record(message.content);
    const role = record(message.author).role;
    if (role !== 'user' && role !== 'assistant') return [];
    if (role === 'assistant') {
      // 分享载荷也包含可见的工具过程和思考摘要；正文只接收给用户的最终回答。
      // 旧版载荷可能没有 channel / end_turn，仍接收其普通文本回答。
      if ((message.channel != null && message.channel !== 'final') || message.end_turn === false ||
        (message.recipient != null && message.recipient !== 'all') ||
        !['text', 'multimodal_text'].includes(String(content.content_type)) ||
        metadata.reasoning_status === 'is_reasoning' || metadata.reasoning_status === 'reasoning_ended') return [];
    }
    const sourceText = Array.isArray(content.parts)
      ? content.parts.filter((part): part is string => typeof part === 'string').join('\n\n')
      : '';
    // 沿用上游内容/附件解析；逐条转换以保持原始载荷与输出消息一一对应。
    const payload = JSON.stringify({ props: { pageProps: { serverResponse: { data: { linear_conversation: [node] } } } } }).replace(/</g, '\\u003c');
    return parseLegacyShare(`<script id="__NEXT_DATA__">${payload}</script>`).replies.map((reply) => ({
      ...reply,
      // 普通文字直接采用原载荷，避免上游清洗 citation 标记、JSON 或空白。
      statement: content.content_type === 'text' && sourceText ? sourceText : reply.statement,
      lookupText: sourceText || (typeof content.text === 'string' ? content.text : reply.statement),
      sourceContent: content,
      sourceReferences: {
        citations: Array.isArray(metadata.citations) ? metadata.citations : [],
        contentReferences: Array.isArray(metadata.content_references) ? metadata.content_references : [],
      },
    }));
  });
  return { title: typeof data.title === 'string' ? data.title : '', replies };
}

export function parseShareHtml(html: string, input: string): Workspace {
  const { key, url } = normalizeShareUrl(input);
  let parsed: ReturnType<typeof parseVisibleMessages>;
  try { parsed = parseVisibleMessages(html); }
  catch { throw new Error('未能解析分享页。请先确认链接可以公开打开；也可能是页面验证拦截或分享页格式发生变化。'); }
  const conversation: Conversation = {
    key, shareUrl: url, title: parsed.title || '未命名会话',
    messages: parsed.replies.map((reply, order) => ({
      id: `M${String(order + 1).padStart(3, '0')}`, order, role: reply.type,
      text: reply.statement, createdAt: reply.createdAt, assets: reply.assets,
      lookupText: reply.lookupText, sourceContent: reply.sourceContent, sourceReferences: reply.sourceReferences,
    })),
  };
  const timeline = buildTimeline(conversation.messages);
  if (timeline.steps.length === 0) throw new Error('分享页中没有解析到用户消息，无法生成 Step。请检查分享内容是否完整。');
  return { conversation, timeline };
}

export async function importShare(input: string): Promise<Workspace> {
  const { url } = normalizeShareUrl(input);
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'omit', headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(25_000) });
  } catch (error) {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) throw new Error('读取分享页超时。请检查网络后重试。');
    throw new Error('无法连接分享页。请检查网络和插件的 ChatGPT 网站访问权限后重试。');
  }
  if (!response.ok) throw new Error(`分享页读取失败（HTTP ${response.status}）。请先打开分享页确认链接有效，稍后重试。`);
  return parseShareHtml(await response.text(), url);
}
