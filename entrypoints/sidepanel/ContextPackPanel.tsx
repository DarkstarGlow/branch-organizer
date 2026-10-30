import { useEffect, useMemo, useRef, useState } from 'react';
import type { Workspace } from '../../src/domain/conversation';
import type { NodeTree } from '../../src/domain/tree';
import type { StepDigest } from '../../src/domain/semantic';
import { buildContextPack } from '../../src/domain/context-pack';
import { contextPackExport, DEFAULT_HANDOFF_PROMPT, serializeContextPack } from '../../src/application/context-pack-markdown';
import { copyContextPack, downloadContextPack } from '../../src/adapters/context-pack-export';

export default function ContextPackPanel({ workspace, tree, digests, selectedIds, disabledReason, onClear }: {
  workspace: Workspace; tree: NodeTree; digests: StepDigest[]; selectedIds: string[];
  disabledReason: string; onClear: () => void;
}) {
  const [includePrompt, setIncludePrompt] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const preview = useRef<HTMLTextAreaElement>(null);
  const result = useMemo(() => {
    if (disabledReason || !selectedIds.length) return null;
    try {
      const pack = buildContextPack(workspace, tree, selectedIds, digests);
      return { pack, markdown: serializeContextPack(pack), error: '' };
    } catch (error) { return { pack: null, markdown: '', error: error instanceof Error ? error.message : '上下文组装失败，请重新读取分享链接。' }; }
  }, [workspace, tree, digests, selectedIds, disabledReason]);
  const text = result?.pack ? contextPackExport(result.markdown, includePrompt) : '';
  useEffect(() => { setFeedback(null); }, [text]);
  async function copy() {
    setFeedback(null);
    try { await copyContextPack(text); setFeedback({ error: false, text: '已复制当前预览内容，可以粘贴到你选择的 AI 或文档中。' }); }
    catch (error) { setFeedback({ error: true, text: (error as Error).message }); }
  }
  function download() {
    setFeedback(null);
    try { downloadContextPack(text, workspace.conversation.title); setFeedback({ error: false, text: '已发起 Markdown 下载，请在浏览器下载列表中查看。' }); }
    catch { setFeedback({ error: true, text: '无法发起下载。请尝试复制，或选中预览文本手动保存。' }); }
  }
  return <section id="context-pack" className="context-pack" aria-label="上下文包导出">
    <h3>带走所选内容</h3>
    <p className="hint">勾选节点只选择它本身。系统自动补充主线／支线祖先摘要；核心材料保留所选 Step 的摘要与原文。本次选择关闭后清空，组装和导出不调用模型。</p>
    {disabledReason ? <p className="hint">{disabledReason}</p> : !selectedIds.length ? <p className="empty-state">先在节点列表或详情中勾选“带走”。</p> : null}
    {result?.error && <p className="error" role="alert">{result.error}</p>}
    {result?.pack && <>
      <p className="selection-summary">核心材料：{result.pack.selected.map((node) => node.id).join('、')}（{result.pack.selected.reduce((count, node) => count + node.steps.length, 0)} 个 Step）</p>
      <p className="selection-summary">自动背景：{result.pack.background.map((node) => node.id).join('、') || '无'}（只带节点摘要）</p>
      <label className="node-select"><input type="checkbox" checked={includePrompt} onChange={(event) => { setIncludePrompt(event.target.checked); setFeedback(null); }} />附带默认续接提示词</label>
      <details className="handoff-prompt"><summary>查看默认提示词</summary><p className="source-text">{DEFAULT_HANDOFF_PROMPT}</p></details>
      <label htmlFor="context-pack-preview">导出预览 · {text.length.toLocaleString()} 字符（与复制、下载内容一致）</label>
      <textarea id="context-pack-preview" ref={preview} className="pack-preview" rows={12} readOnly value={text} />
      <p className="hint">保留全部所选材料，不自动截断；代码围栏和原文内容会一并带走。</p>
      <div className="workbench-actions"><button type="button" className="primary-button" onClick={() => void copy()}>复制 Context Pack</button>
        <button type="button" className="text-button" onClick={download}>下载 Markdown</button>
        <button type="button" className="text-button" onClick={() => { preview.current?.focus(); preview.current?.select(); }}>选中预览文本</button></div>
    </>}
    {selectedIds.length > 0 && !disabledReason && <button type="button" className="text-button" onClick={() => { onClear(); setFeedback(null); }}>清空本次选择</button>}
    {feedback && <p className={feedback.error ? 'error' : 'notice'} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
  </section>;
}
