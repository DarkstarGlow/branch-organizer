export async function copyContextPack(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); }
  catch { throw new Error('复制失败。可点击“选中预览文本”后手动复制，或下载 Markdown。'); }
}

export function downloadContextPack(text: string, title: string): void {
  const name = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().replace(/[. ]+$/g, '').slice(0, 80) || 'conversation';
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `Branch-Organizer-${name}.md`;
  document.body.append(link);
  try { link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
