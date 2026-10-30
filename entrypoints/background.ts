import { importShare } from '../src/adapters/chatgpt-share';
import { DeepSeekProvider } from '../src/adapters/deepseek';
import { forgetDeepSeekKey, getDeepSeekKey, setDeepSeekKey } from '../src/adapters/session-credentials';
import { generateDigests, generateTree } from '../src/application/semantic-engine';
import { loadWorkspace, saveWorkspace, updateWorkspaceTree, loadAppendBase, saveAppend, continueWorkspace, prepareRegeneration, loadRegenerationBase, replaceWorkspace } from '../src/adapters/workspace-storage';
import { generateAppendBaseline, generateAppendDigests, generateAppendProposal } from '../src/application/incremental-engine';
import type { ImportShareResult, ProviderStatusResult, SemanticJob, SemanticJobResult, SemanticPortMessage } from '../src/shared/messages';

export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'bo/prepare-regeneration') {
      prepareRegeneration(message.workspace, message.expected).then(
        (revision) => sendResponse({ ok: true, revision }),
        (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : '无法核对本地结果，请重新读取后再试。' }),
      );
      return true;
    }
    if (message?.type === 'bo/replace-workspace') {
      replaceWorkspace(message.workspace, message.revision, message.digests, message.proposal).then(
        (snapshot) => sendResponse({ ok: true, snapshot }),
        (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : '保存新结果失败，请重试；旧存档未改动。' }),
      );
      return true;
    }
    if (message?.type === 'bo/continue-workspace') {
      continueWorkspace(message.workspace, message.source).then(
        (restore) => sendResponse({ ok: true, restore }),
        (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : '接续失败，请重新读取；旧存档未改动。' }),
      );
      return true;
    }
    if (message?.type === 'bo/save-append') {
      saveAppend(message.workspace, message.base, message.digests, message.proposal, message.baseline).then(
        (snapshot) => sendResponse({ ok: true, snapshot }),
        (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : '增量保存失败，旧存档未改动，请重试。' }),
      );
      return true;
    }
    if (message?.type === 'bo/update-tree') {
      if (!message.change || !['draft', 'baseline'].includes(message.change.type) || !Array.isArray(message.workspace?.timeline?.steps)) {
        sendResponse({ ok: false, error: '编辑请求不完整，请重新读取分享链接后重试。' });
        return;
      }
      updateWorkspaceTree(message.workspace, message.expectedTree, message.change).then(
        (treeState) => sendResponse({ ok: true, treeState }),
        (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : '保存修改失败，草稿已保留，请重试。' }),
      );
      return true;
    }
    if (message?.type === 'bo/save-workspace') {
      saveWorkspace(message.workspace, message.digests, message.treeState).then(
        () => sendResponse({ ok: true }),
        (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : '本地保存失败，请重试保存。' }),
      );
      return true;
    }
    if (['bo/provider-status', 'bo/set-provider-key', 'bo/forget-provider-key'].includes(message?.type)) {
      const configure = async (): Promise<ProviderStatusResult> => {
        if (message.type === 'bo/set-provider-key') {
          if (typeof message.key !== 'string') throw new Error('请输入 DeepSeek API Key。');
          await setDeepSeekKey(message.key);
        } else if (message.type === 'bo/forget-provider-key') await forgetDeepSeekKey();
        return { ok: true, configured: Boolean(await getDeepSeekKey()) };
      };
      configure().then(sendResponse, () => sendResponse({ ok: false, error: '密钥设置失败，请检查输入并重新打开插件后重试。' }));
      return true;
    }
    if (message?.type !== 'bo/import-share') return;
    const respond = (result: ImportShareResult) => sendResponse(result);
    if (typeof message.url !== 'string') {
      respond({ ok: false, error: '分享链接不能为空。' });
      return;
    }
    importShare(message.url).then(
      async (workspace) => respond({ ok: true, workspace, restore: await loadWorkspace(workspace) }),
      (error: unknown) => respond({ ok: false, error: error instanceof Error ? error.message : '读取失败，请重试。' }),
    );
    return true;
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'bo/semantic') return;
    const controller = new AbortController();
    let connected = true;
    let started = false;
    const send = (event: SemanticPortMessage) => { if (connected) port.postMessage(event); };
    port.onDisconnect.addListener(() => { connected = false; controller.abort(); });
    port.onMessage.addListener((job: SemanticJob | { type: 'ping' }) => {
      if (job.type === 'ping' || started) return;
      started = true;
      const run = async (): Promise<SemanticJobResult> => {
        if (!['digests', 'tree', 'regenerate-digests', 'regenerate-tree', 'append-digests', 'append-tree', 'append-baseline'].includes(job.type) || !Array.isArray(job.workspace?.timeline?.steps) || !Array.isArray(job.workspace?.conversation?.messages)) {
          throw new Error('会话材料不完整，请重新读取分享链接。');
        }
        if (job.type === 'regenerate-digests' || job.type === 'regenerate-tree') await loadRegenerationBase(job.workspace, job.revision);
        const key = await getDeepSeekKey();
        if (!key) throw new Error('请先设置 DeepSeek API Key。');
        const provider = new DeepSeekProvider(key);
        if (job.type === 'append-digests' || job.type === 'append-tree' || job.type === 'append-baseline') {
          const snapshot = await loadAppendBase(job.workspace, job.base);
          if (job.type === 'append-digests') return { stage: 'append-digests', ...await generateAppendDigests(job.workspace, snapshot, provider, (text) => send({ type: 'progress', text }), controller.signal) };
          if (job.type === 'append-tree') {
            send({ type: 'progress', text: '正在将新 Step 接入已有结构，旧节点字段与旧归属受保护…' });
            return { stage: 'append-tree', ...await generateAppendProposal(job.workspace, snapshot, job.digests, provider, controller.signal) };
          }
          send({ type: 'progress', text: '正在用已有和新增摘要刷新 AI 初始结构，当前人工结构保持独立…' });
          return { stage: 'append-baseline', ...await generateAppendBaseline(job.workspace, snapshot, job.digests, provider, controller.signal) };
        }
        if (job.type === 'digests' || job.type === 'regenerate-digests') return { stage: 'digests', ...await generateDigests(job.workspace, provider, (text) => send({ type: 'progress', text }), controller.signal) };
        send({ type: 'progress', text: '正在生成节点结构并检查合法性…' });
        return { stage: 'tree', ...await generateTree(job.workspace, job.digests, provider, controller.signal) };
      };
      run().then((result) => send({ type: 'result', result }), (error: unknown) => send({ type: 'error', error: error instanceof Error ? error.message : '生成失败，请重试本阶段。' }));
    });
  });
});

