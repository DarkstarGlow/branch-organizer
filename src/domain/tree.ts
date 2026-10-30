export type NodeType = 'main' | 'branch' | 'normal';

export interface TreeNode {
  id: string;
  title: string;
  summary: string;
  type: NodeType;
  // 单一关系来源；child 列表由 parentId 推导，不另存一份边。
  parentId: string | null;
  stepIds: string[];
}

export interface NodeTree {
  nodes: TreeNode[];
}

export interface TreeState {
  aiBaselineTree: NodeTree;
  currentTree: NodeTree;
}

export type TreeIssueCode =
  | 'INVALID_SHAPE'
  | 'DUPLICATE_NODE'
  | 'UNKNOWN_PARENT'
  | 'MAIN_HAS_PARENT'
  | 'BRANCH_NEEDS_PARENT'
  | 'CYCLE'
  | 'UNKNOWN_STEP'
  | 'DUPLICATE_STEP'
  | 'MISSING_STEP'
  | 'DELETE_NONEMPTY_NODE';

export interface TreeIssue {
  code: TreeIssueCode;
  path: string;
  message: string;
}

export type TreeResult<T> = { ok: true; value: T } | { ok: false; issues: TreeIssue[] };
