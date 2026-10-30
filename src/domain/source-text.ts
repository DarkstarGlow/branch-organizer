// ChatGPT 文件引用的内部编码没有可读意义；只清理展示文本，原始消息保持完整。
export function withoutFileCitations(text: string): string {
  return text.replace(/\uE200filecite\uE202[^\uE201\r\n]*\uE201/gu, '');
}

function componentText(block: string): string {
  if (!/<text\b/.test(block)) return block;
  return block.replace(/<(\/?)(box|row|column|text|caption|icon)\b[^>]*>/g, (tag: string, closing: string, name: string) => {
    if (name === 'icon') {
      if (/\bname=["']arrow-right["']/.test(tag)) return '\n→\n';
      if (/\bname=["']arrow-down["']/.test(tag)) return '\n↓\n';
      return '';
    }
    return name === 'text' && !closing ? '' : '\n';
  }).split('\n').map((line) => line.trim()).filter(Boolean).join('\n')
    .replace(/\n([→↓])\n/g, ' $1 ');
}

function simplifyComponents(text: string): string {
  let depth = 0;
  let start = 0;
  let cursor = 0;
  const parts: string[] = [];
  // 按嵌套层级找完整 box，只处理组件区域，避免改动附近正文的缩进和排序。
  for (const match of text.matchAll(/<\/?box\b[^>]*>/g)) {
    const tag = match[0];
    if (tag.endsWith('/>')) continue;
    if (!tag.startsWith('</')) {
      if (depth++ === 0) start = match.index;
    } else if (depth > 0 && --depth === 0) {
      const end = match.index + tag.length;
      parts.push(text.slice(cursor, start), componentText(text.slice(start, end)));
      cursor = end;
    }
  }
  return parts.join('') + text.slice(cursor);
}

export function readableSourceText(text: string): string {
  // 代码围栏和行内代码保持原样；只把普通回复里的组件标签转为可读文字，不执行组件。
  return withoutFileCitations(text).split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g)
    .map((part, index) => index % 2 ? part : simplifyComponents(part)).join('');
}
