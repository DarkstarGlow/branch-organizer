import { useEffect, useId, useRef, useState } from 'react';
import type { Workspace } from '../../src/domain/conversation';
import type { DigestResult, ModelUsage, TreeGenerationResult } from '../../src/domain/semantic';
import type { TreeState } from '../../src/domain/tree';
import type { SavedWorkspace } from '../../src/application/workspace-snapshot';
import type { PrepareRegenerationRequest, PrepareRegenerationResult, ReplaceWorkspaceRequest, ReplaceWorkspaceResult } from '../../src/shared/messages';
import { runSemanticJob } from '../../src/shared/semantic-client';
import { nodeTypeNames } from '../../src/adapters/tree-view';

export interface RegenerationUsage { digests: ModelUsage[]; tree: ModelUsage; }

export default function RegenerationPanel({ workspace, state, digests, configured, disabledReason, onPendingChange, onBusyChange, onComplete }: {
  workspace: Workspace; state: TreeState; digests: DigestResult['digests']; configured: boolean; disabledReason: string;
  onPendingChange: (pending: boolean) => void; onBusyChange: (busy: boolean) => void;
  onComplete: (snapshot: SavedWorkspace, usage: RegenerationUsage) => void;
}) {
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState<string | null>(null);
  const [draftDigests, setDraftDigests] = useState<DigestResult | null>(null);
  const [draftTree, setDraftTree] = useState<TreeGenerationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const active = useRef<AbortController | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const errors = useRef<HTMLDivElement>(null);
  const confirmId = useId();

  useEffect(() => { onPendingChange(open); return () => onPendingChange(false); }, [open, onPendingChange]);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => { if (open) (error || saveError ? errors.current : heading.current)?.focus(); }, [open, draftTree, error, saveError]);

  function discard() {
    if (busy || saving) return;
    setOpen(false); setRevision(null); setDraftDigests(null); setDraftTree(null);
    setConfirmed(false); setProgress(''); setError(''); setSaveError('');
    requestAnimationFrame(() => trigger.current?.focus());
  }

  async function generate() {
    if (busy || saving || !configured || disabledReason || draftTree) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); onBusyChange(true); setError('');
    let base = revision; let current = draftDigests;
    try {
      if (!base) {
        setProgress('正在核对当前存档…');
        const request: PrepareRegenerationRequest = { type: 'bo/prepare-regeneration', workspace, expected: { digests, treeState: state } };
        const result: PrepareRegenerationResult = await browser.runtime.sendMessage(request);
        controller.signal.throwIfAborted();
        if (!result.ok) throw new Error(result.error);
        base = result.revision; setRevision(base);
      }
      if (!current) {
        setProgress('第 1 步：重新整理全部 Step 摘要…');
        const result = await runSemanticJob({ type: 'regenerate-digests', workspace, revision: base }, setProgress, controller.signal);
        controller.signal.throwIfAborted();
        if (result.stage !== 'digests') throw new Error('摘要阶段不匹配，请放弃本次整理后重新读取。');
        current = { digests: result.digests, usage: result.usage }; setDraftDigests(current);
      }
      setProgress('第 2 步：根据新摘要生成节点结构…');
      const result = await runSemanticJob({ type: 'regenerate-tree', workspace, revision: base, digests: current.digests }, setProgress, controller.signal);
      controller.signal.throwIfAborted();
      if (result.stage !== 'tree') throw new Error('节点阶段不匹配，请放弃本次整理后重新读取。');
      setDraftTree(result); setProgress('新结果已生成并通过校验，尚未替换旧结果。');
    } catch (cause) {
      setError(controller.signal.aborted ? '已取消生成，旧结果未改动。' : cause instanceof Error ? cause.message : '重新整理失败，旧结果未改动，请重试。');
      setProgress('');
    } finally { active.current = null; setBusy(false); onBusyChange(false); }
  }

  async function adopt() {
    if (!confirmed || !draftTree || !draftDigests || !revision || busy || saving) return;
    setSaving(true); onBusyChange(true); setSaveError('');
    try {
      const request: ReplaceWorkspaceRequest = { type: 'bo/replace-workspace', workspace, revision, digests: draftDigests.digests, proposal: draftTree.treeState.currentTree };
      const result: ReplaceWorkspaceResult = await browser.runtime.sendMessage(request);
      if (!result.ok) throw new Error(result.error);
      onComplete(result.snapshot, { digests: draftDigests.usage, tree: draftTree.usage });
      setOpen(false); setRevision(null); setDraftDigests(null); setDraftTree(null); setConfirmed(false); setProgress('');
      requestAnimationFrame(() => trigger.current?.focus());
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : '保存新结果连接失败，预览已保留，请重试保存。'); }
    finally { setSaving(false); onBusyChange(false); }
  }

  return <section className="regeneration-panel" aria-label="重新整理摘要与节点">
    {!open ? <>
      <button ref={trigger} className="text-button" type="button" disabled={Boolean(disabledReason)} onClick={() => setOpen(true)}>重新整理摘要与节点</button>
      <p className="hint">重新生成后先预览，由你决定是否替换当前结果。</p>
      {disabledReason && <p className="hint">{disabledReason}</p>}
    </> : <>
      <span className="label">{draftTree ? '待采用的新结果' : '重新整理'}</span>
      <h3 ref={heading} tabIndex={-1}>{draftTree ? '预览新摘要与节点' : '重新整理摘要与节点'}</h3>
      <p className="hint">重新处理全部原文和摘要，通常调用模型两次，长会话可能分批，按 DeepSeek API 用量计费。当前保存的结果会保留到你确认采用为止。</p>
      <ol className="regeneration-stages" aria-label="整理进度">
        <li aria-current={!draftDigests ? 'step' : undefined}>重新整理摘要{draftDigests ? ' · 已完成' : ''}</li>
        <li aria-current={draftDigests && !draftTree ? 'step' : undefined}>生成节点结构{draftTree ? ' · 已完成' : ''}</li>
        <li aria-current={draftTree ? 'step' : undefined}>预览并确认采用</li>
      </ol>
      <p className="notice" role="status">{progress}</p>
      {(error || saveError) && <div className="error" role="alert" tabIndex={-1} ref={errors}>{saveError || error}</div>}
      {!draftTree && <>
        {!configured && <p className="hint">请先在上方设置 DeepSeek API Key。已完成的摘要会保留在本页。</p>}
        {draftDigests && !busy && <p className="hint">已保留本次新摘要，继续时只重试节点阶段。</p>}
        <div className="workbench-actions">
          <button type="button" className="primary-button" disabled={!configured || busy || Boolean(disabledReason)} onClick={() => void generate()}>{busy ? '正在重新整理…' : draftDigests ? '重试节点生成' : '开始重新整理'}</button>
          {busy && <button type="button" className="text-button" onClick={() => active.current?.abort()}>取消生成</button>}
        </div>
      </>}
      {draftTree && draftDigests && <>
        <p className="regeneration-count">{draftTree.treeState.currentTree.nodes.length} 个节点 · {draftDigests.digests.length} 个 Step · 尚未保存</p>
        <ol className="regeneration-nodes" aria-label="新节点预览">{draftTree.treeState.currentTree.nodes.map(node => <li className="node-card" key={node.id}>
          <span className="step-meta">{node.id} · {nodeTypeNames[node.type]}</span>
          <h4>{node.title}</h4><p className="source-text">{node.summary || '暂无节点摘要'}</p>
          <p className="hint">上级：{draftTree.treeState.currentTree.nodes.find(parent => parent.id === node.parentId)?.title ?? '无，独立开端'}</p>
          <details className="digest-details"><summary>查看所属 Step 与新摘要 · {node.stepIds.length}</summary>
            {node.stepIds.map(id => {
              const digest = draftDigests.digests.find(item => item.stepId === id)!;
              return <article className="digest" key={id}><strong>{id}</strong>
                <p>用户推进：{digest.userResponse}</p><p>AI 动作：{digest.aiAction}</p>
                <p>过程结果：{digest.progress}</p>{digest.nextReason && <p>为何继续：{digest.nextReason}</p>}
              </article>;
            })}
          </details>
        </li>)}</ol>
        <div className="regeneration-confirm" role="group" aria-label="确认替换旧结果">
          <p>采用后将一起替换摘要、当前结构和 AI 初始结构，包括现有人工修改。旧版本不保留，没有撤销历史。</p>
          <label htmlFor={confirmId}><input id={confirmId} type="checkbox" checked={confirmed} disabled={saving} onChange={event => setConfirmed(event.target.checked)} />我确认替换旧结果</label>
          <button className="primary-button" type="button" disabled={!confirmed || saving} onClick={() => void adopt()}>{saving ? '正在保存新结果…' : saveError ? '重试保存新结果' : '采用新结果'}</button>
        </div>
      </>}
      <button className="text-button" type="button" disabled={busy || saving} onClick={discard}>放弃本次整理</button>
      <p className="hint">关闭侧栏会丢弃本次未采用的结果。</p>
    </>}
  </section>;
}
