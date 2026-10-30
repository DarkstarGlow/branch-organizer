import type { Timeline } from './conversation';
import type { NodeTree, TreeResult } from './tree';
import { validateTree } from './tree-validator';

// Proposal 没有“修改旧节点”的入口，只能追加新 Step 的归属或新节点。
export function applyAppendProposal(current: NodeTree, proposal: unknown, newStepIds: string[], timeline: Timeline): TreeResult<NodeTree> {
  const fail = (message: string): TreeResult<NodeTree> => ({ ok: false, issues: [{ code: 'INVALID_SHAPE', path: 'append', message }] });
  const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (!record(proposal) || Object.keys(proposal).some((key) => !['nodes', 'assignments'].includes(key)) || !Array.isArray(proposal.nodes) || !Array.isArray(proposal.assignments)) {
    return fail('增量提议只能包含新 nodes 和 assignments，不能改写旧结构。');
  }
  const next = structuredClone(current);
  const byId = new Map(next.nodes.map((node) => [node.id, node]));
  const allowed = new Set(newStepIds);
  for (const assignment of proposal.assignments) {
    if (!record(assignment) || Object.keys(assignment).some((key) => !['stepId', 'nodeId'].includes(key)) || typeof assignment.stepId !== 'string' || typeof assignment.nodeId !== 'string') return fail('新增归属格式不正确。');
    const target = byId.get(assignment.nodeId);
    if (!target || !allowed.has(assignment.stepId)) return fail('归属追加只能把新 Step 放入已有节点，不能移动旧 Step。');
    target.stepIds.push(assignment.stepId);
  }
  for (const node of proposal.nodes) {
    if (!record(node) || typeof node.id !== 'string' || byId.has(node.id) || !Array.isArray(node.stepIds) || node.stepIds.some((id) => typeof id !== 'string' || !allowed.has(id))) {
      return fail('新节点不能复用旧节点 ID，也不能接管旧 Step。');
    }
  }
  // 同一个 Validator 负责覆盖、重复归属、字段、父子关系与循环检查。
  return validateTree({ nodes: [...next.nodes, ...proposal.nodes] }, timeline);
}
