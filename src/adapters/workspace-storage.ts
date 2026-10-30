import type { Workspace } from '../domain/conversation';
import type { StepDigest } from '../domain/semantic';
import type { NodeTree, TreeState } from '../domain/tree';
import { initializeTree, restoreBaseline, saveTreeDraft } from '../domain/tree-state';
import { createSnapshot, restoreSnapshot, snapshotRevision, type ContinuationCandidate, type SavedWorkspace, type WorkspaceRestore } from '../application/workspace-snapshot';
import { appendDigests, planAppend, type AppendBase } from '../application/incremental-engine';
import { applyAppendProposal } from '../domain/append-tree';
import { normalizeShareUrl } from './chatgpt-share';

const storageKey = (key: string) => `bo:workspace:${key}`;
let writes: Promise<unknown> = Promise.resolve();

export type TreeChange = { type: 'draft'; draft: unknown } | { type: 'baseline' };
export interface RegenerationContent { digests: StepDigest[]; treeState: TreeState; }

function enqueue<T>(write: () => Promise<T>): Promise<T> {
  const result = writes.then(write);
  writes = result.catch(() => {}); // 错误仍交给调用者；后续显式保存可以继续。
  return result;
}

export async function loadWorkspace(workspace: Workspace): Promise<WorkspaceRestore> {
  try {
    const key = storageKey(workspace.conversation.key);
    const data = await browser.storage.local.get(key);
    return data[key] === undefined ? await findContinuationCandidates(workspace) : await restoreSnapshot(data[key], workspace);
  } catch (error) {
    return { status: 'error', error: error instanceof Error && error.message.startsWith('本地')
      ? error.message : '读取本地结构失败。原记录未改动；请重新读取分享链接后再试。' };
  }
}

async function matchOtherShare(raw: unknown, sourceKey: string, workspace: Workspace) {
  if (!raw || typeof raw !== 'object' || !('shareUrl' in raw) || typeof raw.shareUrl !== 'string' || !('conversationKey' in raw)) throw new Error('旧存档身份不完整。');
  const identity = normalizeShareUrl(raw.shareUrl);
  if (identity.key !== sourceKey || raw.conversationKey !== sourceKey || raw.shareUrl !== identity.url) throw new Error('旧存档身份不一致。');
  // 只在用户确认接续时另存；匹配期间不改原对象，不写入旧存档。
  const matched = await restoreSnapshot({ ...raw, conversationKey: workspace.conversation.key, shareUrl: workspace.conversation.shareUrl }, workspace);
  if (matched.status === 'appended') planAppend(workspace, matched.snapshot);
  return matched;
}

async function findContinuationCandidates(workspace: Workspace): Promise<WorkspaceRestore> {
  const records = await browser.storage.local.get(null);
  const candidates: ContinuationCandidate[] = [];
  let invalid = 0;
  for (const [key, raw] of Object.entries(records)) {
    if (!key.startsWith('bo:workspace:')) continue;
    const sourceKey = key.slice('bo:workspace:'.length);
    if (sourceKey === workspace.conversation.key) continue;
    try {
      const matched = await matchOtherShare(raw, sourceKey, workspace);
      if (matched.status !== 'restored' && matched.status !== 'appended') continue;
      const snapshot = matched.snapshot;
      candidates.push({ sourceKey, shareUrl: (raw as SavedWorkspace).shareUrl, title: snapshot.title, savedAt: snapshot.savedAt,
        stepCount: snapshot.steps.length, versionFingerprint: snapshot.versionFingerprint, currentTree: snapshot.treeState.currentTree,
        tailSourceChanged: matched.status === 'appended' && Boolean(matched.tailSourceChanged) });
    } catch { invalid++; }
  }
  candidates.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const warning = invalid ? { archiveWarning: `${invalid} 份其他旧存档格式或对应关系异常，已跳过；原记录未改动。` } : {};
  return candidates.length ? { status: 'candidates', candidates, ...warning } : { status: 'new', ...warning };
}

export async function continueWorkspace(workspace: Workspace, source: ContinuationCandidate): Promise<WorkspaceRestore> {
  return enqueue(async () => {
    const targetKey = storageKey(workspace.conversation.key);
    const sourceStorageKey = storageKey(source.sourceKey);
    const records = await browser.storage.local.get([sourceStorageKey, targetKey]);
    if (records[targetKey] !== undefined) throw new Error('新链接已有存档，请重新读取；已避免覆盖。');
    const matched = await matchOtherShare(records[sourceStorageKey], source.sourceKey, workspace);
    if (matched.status !== 'restored' && matched.status !== 'appended') throw new Error('旧存档与新链接的已闭合历史不匹配，不能接续；原记录未改动。');
    const snapshot = matched.snapshot;
    if (snapshot.versionFingerprint !== source.versionFingerprint || JSON.stringify(snapshot.treeState.currentTree) !== JSON.stringify(source.currentTree)) {
      throw new Error('所选旧存档已被更新，请重新读取后再选择。');
    }
    try { await browser.storage.local.set({ [targetKey]: snapshot }); }
    catch { throw new Error('接续存档保存失败，请重试；旧存档未改动。'); }
    return matched;
  });
}

export async function saveWorkspace(workspace: Workspace, digests: StepDigest[], treeState: TreeState): Promise<void> {
  const save = async () => {
    const snapshot = await createSnapshot(workspace, digests, treeState);
    const key = storageKey(workspace.conversation.key);
    const data = await browser.storage.local.get(key);
    // 首次生成不覆盖已有结构；编辑通过下方受控入口提交。
    if (data[key] !== undefined) throw new Error('本地已有该会话结构，已避免覆盖。请重新读取分享链接以恢复已有结果。');
    try { await browser.storage.local.set({ [key]: snapshot }); }
    catch { throw new Error('保存本地结构失败，可能是存储空间不足。当前结果仍在页面内，可点击“重试保存”，无需再次调用模型。'); }
  };
  return enqueue(save);
}

export async function prepareRegeneration(workspace: Workspace, expected: RegenerationContent): Promise<string> {
  const restored = await loadWorkspace(workspace);
  if (restored.status !== 'restored') throw new Error('当前来源与本地存档不一致，请重新读取并处理来源变化后再重新整理；旧结果未改动。');
  const snapshot = restored.snapshot;
  if (JSON.stringify(expected?.digests) !== JSON.stringify(snapshot.digests) ||
      JSON.stringify(expected?.treeState) !== JSON.stringify(snapshot.treeState)) {
    throw new Error('本地结果已被其他页面更新，请重新读取后再重新整理；旧结果未改动。');
  }
  return snapshotRevision(snapshot);
}

export async function loadRegenerationBase(workspace: Workspace, revision: string): Promise<SavedWorkspace> {
  const restored = await loadWorkspace(workspace);
  if (restored.status !== 'restored') throw new Error('当前来源与本地存档不一致，请重新读取并处理来源变化；旧结果未改动。');
  if (await snapshotRevision(restored.snapshot) !== revision) {
    throw new Error('本地结果已被其他页面更新，本次结果不能覆盖新修改。请放弃本次整理，重新读取后再试。');
  }
  return restored.snapshot;
}

export async function replaceWorkspace(workspace: Workspace, revision: string, digests: StepDigest[], proposal: unknown): Promise<SavedWorkspace> {
  return enqueue(async () => {
    await loadRegenerationBase(workspace, revision);
    const result = initializeTree(proposal, workspace.timeline);
    if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join('\n'));
    const snapshot = await createSnapshot(workspace, digests, result.value);
    try { await browser.storage.local.set({ [storageKey(workspace.conversation.key)]: snapshot }); }
    catch { throw new Error('保存新结果失败，旧存档未改动。预览仍在本页，可重试保存，无需再次调用模型。'); }
    return snapshot;
  });
}

// 在后台串行校验并保存，确认来源与用户开始编辑时的 Current Tree 都未变化。
export async function updateWorkspaceTree(workspace: Workspace, expectedTree: NodeTree, change: TreeChange): Promise<TreeState> {
  return enqueue(async () => {
    const key = storageKey(workspace.conversation.key);
    const data = await browser.storage.local.get(key);
    if (data[key] === undefined) throw new Error('本地存档不存在，请重新读取分享链接后再编辑。');
    const restored = await restoreSnapshot(data[key], workspace);
    if (restored.status !== 'restored') throw new Error('分享内容与存档不一致，请重新读取；旧结构未改动。');
    const snapshot = restored.snapshot;
    if (JSON.stringify(expectedTree) !== JSON.stringify(snapshot.treeState.currentTree)) {
      throw new Error('结构已被其他页面更新。草稿仍在当前页面；请先保留需要的修改，再重新读取分享链接。');
    }
    const result = change.type === 'baseline'
      ? restoreBaseline(snapshot.treeState, workspace.timeline)
      : saveTreeDraft(snapshot.treeState, change.draft, workspace.timeline);
    if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join('\n'));
    const next = await createSnapshot(workspace, snapshot.digests, result.value);
    try { await browser.storage.local.set({ [key]: next }); }
    catch { throw new Error('保存修改失败，当前结构未更新，草稿已保留。请重试保存；若空间不足，需先处理浏览器存储空间。'); }
    return result.value;
  });
}

export async function loadAppendBase(workspace: Workspace, expected: AppendBase): Promise<SavedWorkspace> {
  const restored = await loadWorkspace(workspace);
  if (restored.status !== 'appended') throw new Error('当前来源不是可接入的尾部追加，请重新读取分享链接；旧存档未改动。');
  const snapshot = restored.snapshot;
  if (snapshot.versionFingerprint !== expected.versionFingerprint || JSON.stringify(snapshot.treeState.currentTree) !== JSON.stringify(expected.currentTree)) {
    throw new Error('存档已被其他页面更新，请重新读取后再做增量；当前结果未覆盖存档。');
  }
  planAppend(workspace, snapshot);
  return snapshot;
}

export async function saveAppend(workspace: Workspace, expected: AppendBase, changed: StepDigest[], proposal: unknown, baseline: NodeTree): Promise<SavedWorkspace> {
  return enqueue(async () => {
    const snapshot = await loadAppendBase(workspace, expected);
    const digests = appendDigests(workspace, snapshot, changed);
    const result = applyAppendProposal(snapshot.treeState.currentTree, proposal, planAppend(workspace, snapshot).newStepIds, workspace.timeline);
    if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join('\n'));
    const next = await createSnapshot(workspace, digests, { currentTree: result.value, aiBaselineTree: baseline });
    try { await browser.storage.local.set({ [storageKey(workspace.conversation.key)]: next }); }
    catch { throw new Error('保存增量失败，旧存档未改动。结果仍在本页，可重试保存，无需再次调用模型。'); }
    return next;
  });
}
