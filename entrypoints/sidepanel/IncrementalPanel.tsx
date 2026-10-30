import { useEffect, useMemo, useRef, useState } from 'react';
import type { Workspace } from '../../src/domain/conversation';
import type { DigestResult, ModelUsage } from '../../src/domain/semantic';
import type { SavedWorkspace } from '../../src/application/workspace-snapshot';
import { planAppend, type AppendBaselineResult, type AppendProposalResult } from '../../src/application/incremental-engine';
import { runSemanticJob } from '../../src/shared/semantic-client';
import type { SaveAppendRequest, SaveAppendResult } from '../../src/shared/messages';

export interface AppendUsage { phase: string; value: ModelUsage; }
export default function IncrementalPanel({ workspace, snapshot, configured, tailSourceChanged, onBusyChange, onComplete }: {
  workspace: Workspace; snapshot: SavedWorkspace; configured: boolean; tailSourceChanged?: boolean;
  onBusyChange: (busy: boolean) => void; onComplete: (snapshot: SavedWorkspace, usage: AppendUsage[]) => void;
}) {
  const plan = useMemo(() => { try { return { value: planAppend(workspace, snapshot), error: '' }; }
    catch (cause) { return { value: null, error: (cause as Error).message }; } }, [workspace, snapshot]);
  const [digests, setDigests] = useState<DigestResult | null>(null);
  const [proposal, setProposal] = useState<AppendProposalResult | null>(null);
  const [baseline, setBaseline] = useState<AppendBaselineResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const active = useRef<AbortController | null>(null);
  const usage = useRef<AppendUsage[]>([]);
  useEffect(() => () => active.current?.abort(), []);

  async function update() {
    if (busy || !plan.value) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); onBusyChange(true); setError('');
    const base = { versionFingerprint: snapshot.versionFingerprint, currentTree: snapshot.treeState.currentTree };
    let currentDigests = digests; let currentProposal = proposal; let currentBaseline = baseline;
    try {
      if (!currentDigests) {
        const result = await runSemanticJob({ type: 'append-digests', workspace, base }, setProgress, controller.signal);
        if (result.stage !== 'append-digests') throw new Error('增量摘要阶段不匹配，请重新读取分享链接。');
        currentDigests = { digests: result.digests, usage: result.usage }; setDigests(currentDigests);
        usage.current.push(...result.usage.map((value, index) => ({ phase: `增量摘要 ${index + 1}`, value })));
      }
      if (!currentProposal) {
        if (!plan.value.newStepIds.length) currentProposal = { proposal: { nodes: [], assignments: [] }, usage: null };
        else {
          const result = await runSemanticJob({ type: 'append-tree', workspace, base, digests: currentDigests.digests }, setProgress, controller.signal);
          if (result.stage !== 'append-tree') throw new Error('增量接入阶段不匹配，请重新读取分享链接。');
          currentProposal = { proposal: result.proposal, usage: result.usage };
          if (result.usage) usage.current.push({ phase: '增量接入', value: result.usage });
        }
        setProposal(currentProposal);
      }
      if (!currentBaseline) {
        const result = await runSemanticJob({ type: 'append-baseline', workspace, base, digests: currentDigests.digests }, setProgress, controller.signal);
        if (result.stage !== 'append-baseline') throw new Error('初始结构刷新阶段不匹配，请重新读取分享链接。');
        currentBaseline = { baseline: result.baseline, usage: result.usage }; setBaseline(currentBaseline);
        usage.current.push({ phase: '新版 AI 初始结构', value: result.usage });
      }
      controller.signal.throwIfAborted();
      setSaving(true); setProgress('正在核对旧存档并保存完整增量结果…');
      const request: SaveAppendRequest = { type: 'bo/save-append', workspace, base, digests: currentDigests.digests, proposal: currentProposal.proposal, baseline: currentBaseline.baseline };
      const result: SaveAppendResult = await browser.runtime.sendMessage(request);
      if (!result.ok) throw new Error(result.error);
      onComplete(result.snapshot, usage.current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '增量整理失败，请重试；旧存档未改动。'); setProgress(''); }
    finally { active.current = null; setBusy(false); setSaving(false); onBusyChange(false); }
  }

  return <section className="incremental-panel" aria-label="尾部增量整理">
    <h3>接入尾部新增内容</h3>
    {tailSourceChanged && <p className="hint">旧尾段 AI 回复有变化，将重新整理该段摘要；此前已闭合历史保持匹配。</p>}
    {plan.value && <p className="hint">新增 {plan.value.newStepIds.length} 个 Step，旧尾段变化 {plan.value.changedStepIds.length} 个。只整理这些片段，其余摘要复用；保留旧节点字段和旧 Step 归属。通常 {plan.value.newStepIds.length ? '三' : '两'} 次模型调用（摘要、{plan.value.newStepIds.length ? '增量接入、' : ''}新版 AI 初始结构），按 DeepSeek API 用量计费。</p>}
    {!configured && !baseline && <p className="hint">请先在上方设置本次浏览器会话的 DeepSeek API Key。</p>}
    <div className="workbench-actions"><button type="button" className="primary-button" disabled={busy || !plan.value || (!configured && !baseline)} onClick={() => void update()}>{saving ? '正在保存增量…' : busy ? '正在增量整理…' : baseline ? '重试保存增量结果' : digests ? '继续增量整理' : '只整理新增与变化内容'}</button>
      {busy && !saving && <button type="button" className="text-button" onClick={() => active.current?.abort()}>取消增量整理</button>}</div>
    {digests && !busy && <p className="hint">已保留增量摘要{proposal ? '和接入结果' : ''}{baseline ? '及新版初始结构' : ''}；重试从未完成阶段继续。关闭侧栏将丢弃尚未保存的结果。</p>}
    {(plan.error || error) && <p className="error" role="alert">{plan.error || error}</p>}
    <p className="notice" role="status">{progress}</p>
  </section>;
}
