import type { Workspace, Message } from './conversation';
import type { StepDigest } from './semantic';
import type { NodeTree, TreeNode } from './tree';
import { readableSourceText } from './source-text';

export type PackNode = Pick<TreeNode, 'id' | 'title' | 'summary' | 'type' | 'parentId'>;
export interface PackStep {
  id: string;
  state: 'closed' | 'tail';
  digest: StepDigest;
  source: { id: string; role: Message['role']; text: string; assets: { type: 'image' | 'file'; filename: string }[] }[];
}
export interface ContextPack {
  conversation: { title: string; shareUrl: string };
  background: PackNode[];
  selected: (PackNode & { steps: PackStep[] })[];
}

// 输入来自已经通过统一 Validator 的 Current Tree；只沿 parent 查找，不递归选中后继。
export function backgroundNodeIds(tree: NodeTree, selectedIds: string[]): string[] {
  const byId = new Map(tree.nodes.map((node) => [node.id, node]));
  const selected = new Set(selectedIds);
  const background = new Set<string>();
  for (const id of selected) {
    let parentId = byId.get(id)?.parentId;
    while (parentId) {
      const parent = byId.get(parentId)!;
      if (parent.type !== 'normal' && !selected.has(parent.id)) background.add(parent.id);
      parentId = parent.parentId;
    }
  }
  return [...background];
}

export function buildContextPack(workspace: Workspace, tree: NodeTree, selectedIds: string[], digests: StepDigest[]): ContextPack {
  const byId = new Map(tree.nodes.map((node) => [node.id, node]));
  if (!selectedIds.length) throw new Error('请先勾选至少一个节点。');
  if (selectedIds.some((id) => !byId.has(id))) throw new Error('所选节点已不存在，请重新选择。');
  const steps = new Map(workspace.timeline.steps.map((step) => [step.id, step]));
  const messages = new Map(workspace.conversation.messages.map((message) => [message.id, message]));
  const byDigest = new Map(digests.map((digest) => [digest.stepId, digest]));
  const earliest = (node: TreeNode) => Math.min(...node.stepIds.map((id) => steps.get(id)?.position ?? Infinity));
  // 空节点排在有历史的节点之后；同位置保持 Current Tree 中的稳定顺序。
  const ordered = (ids: string[]) => {
    const included = new Set(ids);
    return tree.nodes.filter((node) => included.has(node.id)).sort((a, b) => earliest(a) - earliest(b));
  };
  const info = ({ id, title, summary, type, parentId }: TreeNode): PackNode => ({ id, title, summary, type, parentId });
  return {
    conversation: { title: workspace.conversation.title, shareUrl: workspace.conversation.shareUrl },
    background: ordered(backgroundNodeIds(tree, selectedIds)).map(info),
    selected: ordered(selectedIds).map((node) => ({ ...info(node), steps: node.stepIds.map((id) => {
      const step = steps.get(id);
      const digest = byDigest.get(id);
      if (!step || !digest) throw new Error(`${id} 的时间线或摘要缺失，请重新读取分享链接。`);
      const source = [step.userMessageId, ...step.responseMessageIds].map((messageId) => {
        const message = messages.get(messageId);
        if (!message) throw new Error(`${id} 的原文缺失，请重新读取分享链接后再导出。`);
        return message;
      }).sort((a, b) => a.order - b.order).map((message) => ({
        id: message.id, role: message.role, text: readableSourceText(message.text),
        assets: message.assets.map((asset) => ({ type: asset.assetType, filename: asset.filename })),
      }));
      return { id, state: step.state, digest: { ...digest }, source };
    }).sort((a, b) => steps.get(a.id)!.position - steps.get(b.id)!.position) })),
  };
}
