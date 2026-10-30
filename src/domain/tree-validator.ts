import type { Timeline } from './conversation';
import type { NodeTree, NodeType, TreeIssue, TreeIssueCode, TreeNode, TreeResult } from './tree';

const nodeFields = ['id', 'title', 'summary', 'type', 'parentId', 'stepIds'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// 面向 AI Proposal / 用户 Draft 的同一个边界：先验形状，再验业务规则。
export function validateTree(input: unknown, timeline: Timeline): TreeResult<NodeTree> {
  const issues: TreeIssue[] = [];
  const add = (code: TreeIssueCode, path: string, message: string) => issues.push({ code, path, message });
  if (!isRecord(input) || !Array.isArray(input.nodes)) {
    return { ok: false, issues: [{ code: 'INVALID_SHAPE', path: 'nodes', message: '结构必须包含 nodes 节点数组。' }] };
  }
  for (const field of Object.keys(input)) {
    if (field !== 'nodes') add('INVALID_SHAPE', field, `不支持字段 ${field}；节点关系统一使用 parentId。`);
  }
  const nodes: TreeNode[] = [];
  input.nodes.forEach((value: unknown, index: number) => {
    const path = `nodes[${index}]`;
    if (!isRecord(value)) {
      add('INVALID_SHAPE', path, '节点必须是对象。');
      return;
    }
    const start = issues.length;
    for (const field of Object.keys(value)) {
      if (!nodeFields.includes(field)) add('INVALID_SHAPE', `${path}.${field}`, `不支持节点字段 ${field}。`);
    }
    for (const field of ['id', 'title']) {
      if (typeof value[field] !== 'string' || !(value[field] as string).trim()) {
        add('INVALID_SHAPE', `${path}.${field}`, `${field === 'id' ? '节点 ID' : '标题'}必须是非空文字。`);
      }
    }
    if (typeof value.summary !== 'string') add('INVALID_SHAPE', `${path}.summary`, '摘要必须是文字，可以暂时为空。');
    if (typeof value.type !== 'string' || !['main', 'branch', 'normal'].includes(value.type)) add('INVALID_SHAPE', `${path}.type`, '节点类型只能是 main、branch 或 normal。');
    if (value.parentId !== null && (typeof value.parentId !== 'string' || !value.parentId.trim())) {
      add('INVALID_SHAPE', `${path}.parentId`, '父节点只能是一个节点 ID 或 null，不能指定多个父节点。');
    }
    if (!Array.isArray(value.stepIds) || value.stepIds.some((id: unknown) => typeof id !== 'string' || !id.trim())) {
      add('INVALID_SHAPE', `${path}.stepIds`, 'Step 引用必须是 ID 数组。');
    }
    if (issues.length === start) {
      nodes.push({ id: value.id as string, title: value.title as string, summary: value.summary as string,
        type: value.type as NodeType, parentId: value.parentId as string | null, stepIds: [...value.stepIds as string[]] });
    }
  });
  if (issues.length) return { ok: false, issues };

  const byId = new Map<string, TreeNode>();
  for (const [index, node] of nodes.entries()) {
    if (byId.has(node.id)) add('DUPLICATE_NODE', `nodes[${index}].id`, `节点 ID ${node.id} 重复，请为节点使用不同 ID。`);
    byId.set(node.id, node);
  }
  if (issues.length) return { ok: false, issues };

  const stepPositions = new Map(timeline.steps.map((step) => [step.id, step.position]));
  const owners = new Map<string, string>();
  nodes.forEach((node, index) => {
    const path = `nodes[${index}]`;
    if (node.parentId !== null && !byId.has(node.parentId)) add('UNKNOWN_PARENT', `${path}.parentId`, `${node.id} 的父节点 ${node.parentId} 不存在，请重新选择父节点。`);
    if (node.type === 'main' && node.parentId !== null) add('MAIN_HAS_PARENT', `${path}.parentId`, `${node.id} 是主线开端，不能有父节点；请取消连接或修改类型。`);
    if (node.type === 'branch' && node.parentId === null) add('BRANCH_NEEDS_PARENT', `${path}.parentId`, `${node.id} 是支线开端，需要指定父节点。`);
    node.stepIds.forEach((id, stepIndex) => {
      const refPath = `${path}.stepIds[${stepIndex}]`;
      if (!stepPositions.has(id)) add('UNKNOWN_STEP', refPath, `${node.id} 引用了不存在的 ${id}，请使用当前时间线中的 Step。`);
      else if (owners.has(id)) add('DUPLICATE_STEP', refPath, `${id} 已归属 ${owners.get(id)}，不能重复分配给 ${node.id}。`);
      else owners.set(id, node.id);
    });
  });
  for (const step of timeline.steps) {
    if (!owners.has(step.id)) add('MISSING_STEP', 'nodes', `${step.id} 尚未归属任何节点，请先分配该 Step。`);
  }

  // 迭代遍历，检测自循环和多节点循环；不限制合法树的深度。
  const finished = new Set<string>();
  for (const node of nodes) {
    const path = new Set<string>();
    let current: TreeNode | undefined = node;
    while (current && !finished.has(current.id)) {
      if (path.has(current.id)) {
        add('CYCLE', `nodes[${nodes.indexOf(current)}].parentId`, `节点 ${current.id} 所在连接形成循环，请断开其中一条父节点连接。`);
        break;
      }
      path.add(current.id);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    for (const id of path) finished.add(id);
  }
  if (issues.length) return { ok: false, issues };

  // Step 顺序来自 Timeline position，与 Step ID、Node ID 或提议中的数组顺序无关。
  for (const node of nodes) node.stepIds.sort((a, b) => stepPositions.get(a)! - stepPositions.get(b)!);
  return { ok: true, value: { nodes } };
}
