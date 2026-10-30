import { useState, type FormEvent } from 'react';
import { normalizeShareUrl } from '../../src/adapters/chatgpt-share';
import type { Message, Workspace } from '../../src/domain/conversation';
import { sourceSnippet } from '../../src/domain/source-snippet';
import { readableSourceText } from '../../src/domain/source-text';
import type { ImportShareRequest, ImportShareResult } from '../../src/shared/messages';
import SemanticPanel from './SemanticPanel';
import type { WorkspaceRestore } from '../../src/application/workspace-snapshot';
import type { StepLocation } from './TreeWorkbench';
import ContinueWorkspacePanel from './ContinueWorkspacePanel';

const roleNames = { user: '用户', assistant: 'AI', tool: '工具' };

export default function App() {
  const [url, setUrl] = useState('');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [restore, setRestore] = useState<WorkspaceRestore>({ status: 'new' });
  const [loading, setLoading] = useState(false);
  const [semanticBusy, setSemanticBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [treeAvailable, setTreeAvailable] = useState(false);
  const [location, setLocation] = useState<StepLocation>(null);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice(''); setWorkspace(null); setTreeAvailable(false); setLocation(null);
    try {
      const source = normalizeShareUrl(url);
      setLoading(true); setWorkspace(null);
      const request: ImportShareRequest = { type: 'bo/import-share', url: source.url };
      const result: ImportShareResult = await browser.runtime.sendMessage(request);
      if (!result.ok) throw new Error(result.error);
      setRestore(result.restore); setWorkspace(result.workspace); setUrl(source.url);
    } catch (error) {
      setError(error instanceof Error ? error.message : '读取失败，请重新打开插件后重试。');
    } finally { setLoading(false); }
  }

  async function copySnippet(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('原文片段已复制。分享页若将用户提问折叠为 Prompt，请先展开对应 Prompt，再按 Ctrl+F 粘贴查找。');
    } catch { setNotice('复制失败，请直接选中下方原文并手动复制。'); }
  }

  function renderMessage(message: Message) {
    return (
      <section className={`message message-${message.role}`} key={message.id}>
        <div className="message-heading"><span>{roleNames[message.role]} · {message.id}</span>
          {message.lookupText && <button className="text-button" onClick={() => copySnippet(sourceSnippet(message.lookupText))}>复制查找片段</button>}
        </div>
        <pre className="source-text">{readableSourceText(message.text)}</pre>
        {message.assets.length > 0 && <p className="hint">附件记录：{message.assets.map((asset) => asset.filename).join('、')}（未下载）</p>}
      </section>
    );
  }

  const byId = new Map(workspace?.conversation.messages.map((message) => [message.id, message]));
  return (
    <main className="shell">
      <header className="hero"><span className="eyebrow">Branch Organizer</span><h1>会话时间线</h1><p>读取一条 ChatGPT 公开分享会话，按用户提问顺序查看推进过程。</p></header>
      <form className="import-form" onSubmit={submit}>
        <label htmlFor="share-url">ChatGPT 分享链接</label>
        <input id="share-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://chatgpt.com/share/…" required disabled={loading || semanticBusy} aria-describedby="share-hint" />
        <p id="share-hint" className="hint">请使用公开 Share Link。读取时间线不调用模型；AI 整理由下方按钮单独启动。</p>
        <button className="primary-button" type="submit" disabled={loading || semanticBusy}>{loading ? '正在读取分享页…' : '读取并生成时间线'}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      <p className="notice" role="status">{loading ? '正在解析消息，请稍候。' : notice}</p>
      {workspace ? (
        <section aria-label="Step 时间线" aria-busy={loading}>
          <header className="timeline-heading"><h2>{workspace.conversation.title}</h2><p>{workspace.timeline.steps.length} 个 Step（含尾段） · {workspace.conversation.messages.length} 条消息</p><a href={workspace.conversation.shareUrl} target="_blank" rel="noreferrer">打开原始分享页 ↗</a></header>
          {'archiveWarning' in restore && restore.archiveWarning && <p className="error" role="alert">{restore.archiveWarning}</p>}
          {restore.status === 'candidates' ? <ContinueWorkspacePanel workspace={workspace} candidates={restore.candidates} onContinue={setRestore}
            onIndependent={() => setRestore({ status: 'new', archiveWarning: restore.archiveWarning })} onBusyChange={setSemanticBusy} /> :
          <SemanticPanel workspace={workspace} restore={restore} onBusyChange={setSemanticBusy} location={location} onTreeAvailable={setTreeAvailable} onStep={(id) => {
            const target = document.getElementById(`step-${id}`) as HTMLDetailsElement | null;
            if (target) { target.open = true; target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
          }} />}
          <p className="hint">回查用户提问时，分享页可能需要先展开对应的 Prompt 1 / 2…，再按 Ctrl+F 查找片段。</p>
          {workspace.timeline.leadingMessageIds.length > 0 && <details className="step"><summary>首条用户提问之前的消息</summary>{workspace.timeline.leadingMessageIds.map((id) => renderMessage(byId.get(id)!))}</details>}
          <ol className="timeline">
            {workspace.timeline.steps.map((step) => {
              const user = byId.get(step.userMessageId)!;
              const next = step.nextUserMessageId ? byId.get(step.nextUserMessageId) : null;
              return <li key={step.id}><details className="step" id={`step-${step.id}`} open={workspace.timeline.steps.length === 1}>
                <summary><span className="step-meta">{step.id} · {step.state === 'tail' ? '尾段 · 等待下一次提问' : '已闭合'}</span><span className="step-title">{readableSourceText(user.text) || '含附件的提问'}</span><span className="hint">{step.responseMessageIds.length} 条响应 · 展开查看原文</span></summary>
                {treeAvailable && <div className="step-tree-link"><button type="button" className="text-button" onClick={() => setLocation((previous) => ({ stepId: step.id, sequence: (previous?.sequence ?? 0) + 1 }))}>查看 {step.id} 所属节点</button></div>}
                {renderMessage(user)}{step.responseMessageIds.map((id) => renderMessage(byId.get(id)!))}
                {step.responseMessageIds.length === 0 && <p className="hint no-response">本段暂无 AI 最终回复。</p>}
                {next && <div className="boundary"><span className="label">下一次提问 · 闭合边界</span><pre className="source-text">{readableSourceText(next.text)}</pre></div>}
              </details></li>;
            })}
          </ol>
        </section>
      ) : !loading && !error && <section className="empty-state"><h2>从一条分享链接开始</h2><p>每次用户提问开启一个 Step；下一次提问到来时闭合，最后一段保留为 Tail。</p></section>}
    </main>
  );
}
