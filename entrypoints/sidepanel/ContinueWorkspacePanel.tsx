import { useState } from 'react';
import type { Workspace } from '../../src/domain/conversation';
import type { ContinuationCandidate, WorkspaceRestore } from '../../src/application/workspace-snapshot';
import type { ContinueWorkspaceRequest, ContinueWorkspaceResult } from '../../src/shared/messages';

export default function ContinueWorkspacePanel({ workspace, candidates, onContinue, onIndependent, onBusyChange }: {
  workspace: Workspace; candidates: ContinuationCandidate[]; onContinue: (restore: WorkspaceRestore) => void;
  onIndependent: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  async function resume(source: ContinuationCandidate) {
    setWorking(source.sourceKey); setError(''); onBusyChange(true);
    try {
      const request: ContinueWorkspaceRequest = { type: 'bo/continue-workspace', workspace, source };
      const result: ContinueWorkspaceResult = await browser.runtime.sendMessage(request);
      if (!result.ok) throw new Error(result.error);
      onContinue(result.restore);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '接续失败，请重新读取；旧存档未改动。'); }
    finally { setWorking(''); onBusyChange(false); }
  }
  return <section className="semantic-panel" aria-label="旧存档接续">
    <h2>找到可接续的旧结构</h2>
    <p className="hint">分享链接变了，但已闭合历史与以下存档匹配。请选择要沿用的人工结构；确认后复制到新链接下，旧链接存档保留，此后各自保存。相同历史也可能来自分叉会话，因此不会自动合并。</p>
    {candidates.map((source) => <article className="continuation-card" key={source.sourceKey}>
      <h3>{source.title}</h3>
      <p className="hint">{source.stepCount} 个 Step · {source.currentTree.nodes.length} 个节点<br />保存于 {new Date(source.savedAt).toLocaleString()}</p>
      <p className="hint">旧节点：{source.currentTree.nodes.slice(0, 3).map((node) => node.title).join('、')}{source.currentTree.nodes.length > 3 ? '…' : ''}</p>
      <a href={source.shareUrl} target="_blank" rel="noreferrer">查看旧分享 · {source.sourceKey.slice(-6)}</a>
      {source.tailSourceChanged && <p className="hint">旧尾段 AI 回复有变化，会重新整理该段摘要；此前已闭合历史保持匹配。</p>}
      <button type="button" className="primary-button" disabled={Boolean(working)} onClick={() => void resume(source)}>{working === source.sourceKey ? '正在接续…' : '接续这个旧结构'}</button>
    </article>)}
    <button type="button" className="text-button" disabled={Boolean(working)} onClick={onIndependent}>作为独立会话整理</button>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
