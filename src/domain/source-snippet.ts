import { readableSourceText } from './source-text';

// 浏览器查找适合短的连续可见文字，避免跨行及 Markdown 渲染标记。
export function sourceSnippet(text: string): string {
  const visible = readableSourceText(text).replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  const spans = visible.split(/[\r\n`*_#<>\[\]{}|→↓\uE000-\uF8FF]+/u)
    .map((span) => span.trim()).filter(Boolean);
  const candidate = spans.find((span) => span.length >= 24) ?? spans.sort((a, b) => b.length - a.length)[0] ?? '';
  return Array.from(candidate).slice(0, 64).join('');
}
