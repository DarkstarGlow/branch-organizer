import type { Timeline } from './conversation';
import type { TreeIssue, TreeResult, TreeState } from './tree';
import { validateTree } from './tree-validator';

export function initializeTree(proposal: unknown, timeline: Timeline): TreeResult<TreeState> {
  const result = validateTree(proposal, timeline);
  if (!result.ok) return result;
  return { ok: true, value: { aiBaselineTree: result.value, currentTree: structuredClone(result.value) } };
}

export function saveTreeDraft(state: TreeState, draft: unknown, timeline: Timeline): TreeResult<TreeState> {
  const result = validateTree(draft, timeline);
  if (!result.ok) return result;
  const retainedIds = new Set(result.value.nodes.map((node) => node.id));
  const parents = new Set(state.currentTree.nodes.map((node) => node.parentId));
  const issues: TreeIssue[] = [];
  for (const node of state.currentTree.nodes) {
    if (!retainedIds.has(node.id) && (node.stepIds.length > 0 || parents.has(node.id))) {
      issues.push({ code: 'DELETE_NONEMPTY_NODE', path: 'nodes', message: `${node.id} 仍有 Step 或子节点，请先保存其归属调整，再删除这个空叶节点。` });
    }
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: { aiBaselineTree: structuredClone(state.aiBaselineTree), currentTree: result.value } };
}

export function restoreBaseline(state: TreeState, timeline: Timeline): TreeResult<TreeState> {
  // 恢复也经过同一校验器，避免用旧版本 Baseline 覆盖新增 Step 后的结构。
  return initializeTree(state.aiBaselineTree, timeline);
}
