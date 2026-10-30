import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Workspace } from '../../src/domain/conversation';
import type { DigestResult, ModelUsage } from '../../src/domain/semantic';
import type { TreeState } from '../../src/domain/tree';
import type { ProviderRequest, ProviderStatusResult, SaveWorkspaceRequest, SaveWorkspaceResult } from '../../src/shared/messages';
import type { SavedWorkspace, WorkspaceRestore } from '../../src/application/workspace-snapshot';
import { runSemanticJob } from '../../src/shared/semantic-client';
import TreeWorkbench, { type StepLocation } from './TreeWorkbench';
import IncrementalPanel, { type AppendUsage } from './IncrementalPanel';
import RegenerationPanel from './RegenerationPanel';

const tokens = (value: number | null) => value === null ? '未返回' : value.toLocaleString();

function Usage({ value }: { value: ModelUsage }) {
  return <span>输入 {tokens(value.inputTokens)} · 缓存输入 {tokens(value.cachedInputTokens)} · 输出 {tokens(value.outputTokens)} tokens</span>;
}

export default function SemanticPanel({ workspace, restore, onBusyChange, onStep, location, onTreeAvailable }: {
  workspace: Workspace; restore: WorkspaceRestore; onBusyChange: (busy: boolean) => void; onStep: (id: string) => void;
  location: StepLocation; onTreeAvailable: (available: boolean) => void;
}) {
  const [updatedSnapshot, setUpdatedSnapshot] = useState<SavedWorkspace | null>(null);
  const [appendUsage, setAppendUsage] = useState<AppendUsage[]>([]);
  const snapshot = updatedSnapshot ?? ('snapshot' in restore ? restore.snapshot : null);
  const sourceChanged = !updatedSnapshot && (restore.status === 'appended' || restore.status === 'changed');
  const [configured, setConfigured] = useState(false);
  const [key, setKey] = useState('');
  const [settingKey, setSettingKey] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [digestResult, setDigestResult] = useState<DigestResult | null>(snapshot ? { digests: snapshot.digests, usage: [] } : null);
  const [treeState, setTreeState] = useState<TreeState | null>(snapshot?.treeState ?? null);
  const [treeUsage, setTreeUsage] = useState<ModelUsage | null>(null);
  const [saved, setSaved] = useState(Boolean(snapshot));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [workbenchBusy, setWorkbenchBusy] = useState(false);
  const [regenerationPending, setRegenerationPending] = useState(false);
  const [regenerationBusy, setRegenerationBusy] = useState(false);
  const [replacement, setReplacement] = useState(0);
  const [updateNotice, setUpdateNotice] = useState('');
  const activeJob = useRef<AbortController | null>(null);

  useEffect(() => { onBusyChange(busy || saving || settingKey || workbenchBusy || regenerationPending); }, [busy, saving, settingKey, workbenchBusy, regenerationPending, onBusyChange]);
  useEffect(() => { onTreeAvailable(Boolean(treeState) && !sourceChanged); }, [treeState, sourceChanged, onTreeAvailable]);

  useEffect(() => {
    let mounted = true;
    const request: ProviderRequest = { type: 'bo/provider-status' };
    browser.runtime.sendMessage(request).then((result: ProviderStatusResult) => {
      if (!mounted) return;
      if (result.ok) setConfigured(result.configured);
      else setError(result.error);
    }, () => { if (mounted) setError('无法读取密钥设置，请重新打开侧边栏。'); });
    return () => { mounted = false; activeJob.current?.abort(); };
  }, []);

  async function configure(event?: FormEvent) {
    event?.preventDefault();
    setError(''); setSettingKey(true);
    try {
      const request: ProviderRequest = event ? { type: 'bo/set-provider-key', key } : { type: 'bo/forget-provider-key' };
      const result: ProviderStatusResult = await browser.runtime.sendMessage(request);
      if (!result.ok) throw new Error(result.error);
      setConfigured(result.configured); setKey('');
    } catch (error) { setError(error instanceof Error ? error.message : '密钥设置失败，请重试。'); }
    finally { setSettingKey(false); }
  }

  async function generate() {
    if (busy || treeState || !configured || restore.status === 'error') return;
    const controller = new AbortController();
    activeJob.current = controller;
    setBusy(true); setError('');
    let current = digestResult;
    try {
      if (!current) {
        setProgress('正在整理 Step 过程…');
        const result = await runSemanticJob({ type: 'digests', workspace }, setProgress, controller.signal);
        if (result.stage !== 'digests') throw new Error('后台阶段不匹配，请重新打开插件后重试。');
        current = { digests: result.digests, usage: result.usage };
        setDigestResult(current);
      }
      setProgress('正在生成节点结构并检查合法性…');
      const result = await runSemanticJob({ type: 'tree', workspace, digests: current.digests }, setProgress, controller.signal);
      if (result.stage !== 'tree') throw new Error('后台阶段不匹配，请重新打开插件后重试。');
      setTreeState(result.treeState); setTreeUsage(result.usage);
      setProgress('探索结构已生成，全部 Step 已通过归属与关系校验。');
      await persist(current.digests, result.treeState);
    } catch (error) {
      setError(error instanceof Error ? error.message : '生成失败，请重试本阶段。');
      setProgress('');
    } finally { activeJob.current = null; setBusy(false); }
  }

  async function persist(digests: DigestResult['digests'], state: TreeState) {
    setSaving(true); setSaveError('');
    try {
      const request: SaveWorkspaceRequest = { type: 'bo/save-workspace', workspace, digests, treeState: state };
      const result: SaveWorkspaceResult = await browser.runtime.sendMessage(request);
      if (!result.ok) throw new Error(result.error);
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '本地保存连接失败。结果仍在页面内，请重试保存。');
    } finally { setSaving(false); }
  }

  return <section className="semantic-panel" aria-label="AI 探索结构">
    <h2>生成探索结构</h2>
    {restore.status === 'restored' && !updatedSnapshot && <p className="notice" role="status">已从本地恢复 {snapshot!.steps.length} 个 Step 的结构与摘要，恢复过程未调用模型。原文来自刚重新读取的分享页。</p>}
    {sourceChanged && <p className="error" role="status">{restore.status === 'appended' ? '分享尾部有新增或变化。旧结构已保留，可在下方增量接入。' : '分享历史发生改写，已停止自动匹配和覆盖；请使用新的分享链接作为独立会话整理，旧存档不会被覆盖。'} 下方显示上次保存的结构；当前原文时间线单独保留，接入前旧节点暂不跳转原文。</p>}
    {updateNotice && <p className="notice" role="status">{updateNotice}</p>}
    {restore.status === 'error' && <p className="error" role="alert">{restore.error} 仍可查看当前时间线；重新读取成功前不会生成或覆盖结构。</p>}
    <p className="hint">使用 DeepSeek Flash。先整理每段推进，再归纳主线与支线；普通会话通常调用两次。点击生成会将本会话文字发送给 DeepSeek，按其 API 用量计费，附件内容不上传。</p>
    <form className="key-form" onSubmit={configure}>
      <label htmlFor="deepseek-key">DeepSeek API Key{configured ? '（本浏览器会话已设置）' : ''}</label>
      <input id="deepseek-key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(event) => setKey(event.target.value)} placeholder={configured ? '输入新密钥可替换' : '在此输入密钥，请勿发到聊天里'} required disabled={busy || settingKey || regenerationBusy} />
      <div className="key-actions"><button className="text-button" disabled={busy || settingKey || regenerationBusy || !key.trim()} type="submit">{settingKey ? '正在设置…' : '保存至本次浏览器会话'}</button>
        {configured && <button className="text-button" type="button" disabled={busy || settingKey || regenerationBusy} onClick={() => void configure()}>清除密钥</button>}</div>
      <p className="hint">密钥仅存于浏览器会话内存，浏览器重启后需要重新输入，不会写入插件包或长期本地存储。</p>
    </form>
    <div className="generate-actions"><button className="primary-button" type="button" disabled={!configured || busy || saving || settingKey || Boolean(treeState) || restore.status === 'error'} onClick={() => void generate()}>{treeState ? '已生成探索结构' : busy ? '正在生成…' : digestResult ? '重试节点结构生成' : '生成探索结构'}</button>
      {busy && activeJob.current && !saving && <button className="text-button" type="button" onClick={() => activeJob.current?.abort()}>取消</button>}</div>
    {treeState && !sourceChanged && <p className="notice" role="status">{saving ? '正在保存到本地…' : saved ? '结构和摘要已保存在本地。重开后输入同一分享链接即可恢复。' : '当前结果尚未保存，请保持页面打开。'}</p>}
    {saveError && <div role="alert"><p className="error">{saveError}</p><button type="button" className="text-button" disabled={saving} onClick={() => void persist(digestResult!.digests, treeState!)}>重试保存</button></div>}
    {error && <p className="error" role="alert">{error}</p>}
    <p className="notice" role="status">{progress}</p>
    {digestResult && !treeState && !busy && <p className="hint">已保留 {digestResult.digests.length} 个 Step 的整理结果；重试只调用节点结构阶段。</p>}
    {restore.status === 'appended' && !updatedSnapshot && <IncrementalPanel workspace={workspace} snapshot={restore.snapshot} configured={configured} tailSourceChanged={restore.tailSourceChanged}
      onBusyChange={setBusy} onComplete={(next, usage) => {
        setUpdatedSnapshot(next); setDigestResult({ digests: next.digests, usage: [] }); setTreeState(next.treeState); setSaved(true); setAppendUsage([...usage]);
        setUpdateNotice(`增量接入已保存，当前共 ${next.steps.length} 个 Step。旧人工结构已保留，AI 初始结构也已更新到当前版本。`);
      }} />}
    {treeState && digestResult && <>
      {saved && !sourceChanged && <RegenerationPanel workspace={workspace} state={treeState} digests={digestResult.digests} configured={configured}
        disabledReason={workbenchBusy ? '请先完成当前编辑或恢复确认，再重新整理。' : busy || saving || settingKey ? '请先等待当前操作完成。' : ''}
        onPendingChange={setRegenerationPending} onBusyChange={setRegenerationBusy} onComplete={(next, usage) => {
          setUpdatedSnapshot(next); setDigestResult({ digests: next.digests, usage: usage.digests }); setTreeState(next.treeState); setTreeUsage(usage.tree);
          setSaved(true); setAppendUsage([]); setReplacement(value => value + 1); setProgress('');
          setUpdateNotice('已采用新结果，摘要、当前结构和 AI 初始结构已一起保存在本地。');
        }} />}
      <TreeWorkbench key={`${snapshot?.versionFingerprint ?? 'generated'}:${replacement}`} workspace={workspace} state={treeState} digests={digestResult.digests}
        canEdit={saved && !saving && !sourceChanged && !busy && !regenerationPending} sourceChanged={sourceChanged} location={location}
        blockedReason={regenerationPending ? '正在重新整理，当前显示旧结果；请先采用或放弃本次整理，再编辑结构。' : ''}
        onChange={setTreeState} onBusyChange={setWorkbenchBusy} onStep={onStep} />
    </>}
    {appendUsage.length > 0 && <details className="usage"><summary>本次增量的模型用量</summary>
      {appendUsage.map((item, index) => <p key={index}>{item.phase}：<Usage value={item.value} /></p>)}
      <p className="hint">仅列出成功阶段返回的用量；失败或取消请求也可能计费，以 DeepSeek 账户记录为准。</p>
    </details>}
    {digestResult && digestResult.usage.length > 0 && <details className="usage"><summary>DeepSeek 返回的用量</summary>
      {digestResult.usage.map((value, index) => <p key={index}>Step 整理 {index + 1}：<Usage value={value} /></p>)}
      {treeUsage && <p>节点结构：<Usage value={treeUsage} /></p>}
      <p className="hint">这里只列出成功阶段返回的用量；失败或取消的请求也可能产生用量，以 DeepSeek 账户记录为准。</p>
    </details>}
  </section>;
}
