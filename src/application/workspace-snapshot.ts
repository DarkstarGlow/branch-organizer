import type { Timeline, Workspace } from '../domain/conversation';
import type { StepDigest } from '../domain/semantic';
import type { NodeTree, TreeState } from '../domain/tree';
import { validateTree } from '../domain/tree-validator';
import { validateDigests } from './semantic-engine';

type StepStructure = Omit<Timeline['steps'][number], 'sourceRefs'>;
export interface SavedWorkspace {
  schemaVersion: 1;
  conversationKey: string;
  shareUrl: string;
  title: string;
  savedAt: string;
  promptHashes: string[];
  messageHashes: string[];
  versionFingerprint: string;
  steps: StepStructure[];
  digests: StepDigest[];
  treeState: TreeState;
}

export interface ContinuationCandidate {
  sourceKey: string;
  shareUrl: string;
  title: string;
  savedAt: string;
  stepCount: number;
  versionFingerprint: string;
  currentTree: NodeTree;
  tailSourceChanged: boolean;
}
export type WorkspaceRestore =
  | { status: 'new'; archiveWarning?: string }
  | { status: 'candidates'; candidates: ContinuationCandidate[]; archiveWarning?: string }
  | { status: 'restored' | 'changed'; snapshot: SavedWorkspace }
  | { status: 'appended'; snapshot: SavedWorkspace; tailSourceChanged?: boolean }
  | { status: 'error'; error: string };

async function hash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// 生成期间只携带存档修订指纹；摘要、双树或保存时间改变都会使旧预览失效。
export function snapshotRevision(snapshot: SavedWorkspace): Promise<string> {
  return hash(snapshot);
}

// 只规范化换行；保留空白、代码和附件名称的差异。正文仅参与哈希，不写入快照。
export async function workspaceVersion(workspace: Workspace) {
  const normalized = workspace.conversation.messages.map((message) => ({ role: message.role,
    text: message.text.replace(/\r\n?/g, '\n'),
    assets: message.assets.map((asset) => ({ type: asset.assetType, filename: asset.filename })),
  }));
  const messageHashes = await Promise.all(normalized.map(hash));
  const promptHashes = messageHashes.filter((_, index) => normalized[index]!.role === 'user');
  return { promptHashes, messageHashes, versionFingerprint: await hash(messageHashes) };
}

function structuralSteps(timeline: Timeline): StepStructure[] {
  return timeline.steps.map((step) => ({ id: step.id, position: step.position, state: step.state,
    userMessageId: step.userMessageId, responseMessageIds: [...step.responseMessageIds], nextUserMessageId: step.nextUserMessageId }));
}

function checkedContent(digests: unknown, treeState: unknown, timeline: Timeline) {
  const checkedDigests = validateDigests({ digests }, timeline.steps.map((step) => step.id));
  const state = treeState as TreeState | null;
  const baseline = validateTree(state?.aiBaselineTree, timeline);
  const current = validateTree(state?.currentTree, timeline);
  if (!baseline.ok || !current.ok) throw new Error('本地节点结构未通过校验，已保留原记录。');
  return { digests: checkedDigests, treeState: { aiBaselineTree: baseline.value, currentTree: current.value } };
}

export async function createSnapshot(workspace: Workspace, digests: StepDigest[], treeState: TreeState): Promise<SavedWorkspace> {
  return { schemaVersion: 1, conversationKey: workspace.conversation.key, shareUrl: workspace.conversation.shareUrl,
    title: workspace.conversation.title, savedAt: new Date().toISOString(), ...await workspaceVersion(workspace),
    steps: structuralSteps(workspace.timeline), ...checkedContent(digests, treeState, workspace.timeline) };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const stringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const hashArray = (value: unknown): value is string[] => stringArray(value) && value.every((item) => /^[a-f0-9]{64}$/.test(item));

export async function restoreSnapshot(raw: unknown, workspace: Workspace): Promise<WorkspaceRestore> {
  if (!record(raw) || raw.schemaVersion !== 1) throw new Error('本地记录版本不受支持，已保留原记录，请勿覆盖。');
  if (raw.conversationKey !== workspace.conversation.key || raw.shareUrl !== workspace.conversation.shareUrl ||
      typeof raw.title !== 'string' || typeof raw.savedAt !== 'string' || !Number.isFinite(Date.parse(raw.savedAt)) ||
      !hashArray(raw.promptHashes) || !hashArray(raw.messageHashes) || typeof raw.versionFingerprint !== 'string' ||
      raw.versionFingerprint !== await hash(raw.messageHashes) || !Array.isArray(raw.steps) || !raw.steps.length) {
    throw new Error('本地匹配信息损坏，已保留原记录，请勿覆盖。');
  }
  const ids = new Set<string>();
  const steps = raw.steps.map((step: unknown, index: number) => {
    if (!record(step) || typeof step.id !== 'string' || !step.id || ids.has(step.id) || step.position !== index ||
      step.state !== (index === (raw.steps as unknown[]).length - 1 ? 'tail' : 'closed') ||
      typeof step.userMessageId !== 'string' || !stringArray(step.responseMessageIds) ||
      !(step.nextUserMessageId === null || typeof step.nextUserMessageId === 'string')) {
      throw new Error('本地 Step 结构损坏，已保留原记录。');
    }
    ids.add(step.id);
    return { id: step.id, position: index, state: step.state as 'closed' | 'tail', userMessageId: step.userMessageId,
      responseMessageIds: [...step.responseMessageIds], nextUserMessageId: step.nextUserMessageId as string | null, sourceRefs: [] };
  });
  if (raw.promptHashes.length !== steps.length) throw new Error('本地 Step 数量与版本信息不一致，已保留原记录。');
  const content = checkedContent(raw.digests, raw.treeState, { steps, leadingMessageIds: [] });
  // 显式构造允许保存的数据；不沿用未知字段，也不恢复旧原文片段。
  const snapshot: SavedWorkspace = { schemaVersion: 1, conversationKey: workspace.conversation.key,
    shareUrl: workspace.conversation.shareUrl, title: raw.title, savedAt: raw.savedAt,
    promptHashes: [...raw.promptHashes], messageHashes: [...raw.messageHashes], versionFingerprint: raw.versionFingerprint,
    steps: structuralSteps({ steps, leadingMessageIds: [] }), ...content };
  const current = await workspaceVersion(workspace);
  if (snapshot.versionFingerprint === current.versionFingerprint) {
    if (JSON.stringify(snapshot.steps) !== JSON.stringify(structuralSteps(workspace.timeline))) {
      throw new Error('本地 Step 与当前来源对应关系不一致，已保留原记录。');
    }
    return { status: 'restored', snapshot };
  }
  const prefix = (old: string[], next: string[]) => old.length <= next.length && old.every((value, index) => value === next[index]);
  const tail = snapshot.steps.at(-1)!;
  const tailUserIndex = workspace.conversation.messages.findIndex((message) => message.id === tail.userMessageId && message.role === 'user');
  // 已闭合历史与旧 Tail 的用户提问必须不变；最后一段 AI 回复允许更新，随后重做该 Tail 摘要。
  const stableClosedHistory = tailUserIndex >= 0 && snapshot.messageHashes[tailUserIndex] === snapshot.promptHashes.at(-1) &&
    prefix(snapshot.promptHashes, current.promptHashes) &&
    prefix(snapshot.messageHashes.slice(0, tailUserIndex + 1), current.messageHashes);
  if (!stableClosedHistory) return { status: 'changed', snapshot };
  return { status: 'appended', snapshot, tailSourceChanged: !prefix(snapshot.messageHashes, current.messageHashes) };
}
