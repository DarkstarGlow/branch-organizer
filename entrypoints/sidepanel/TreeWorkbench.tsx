import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Workspace } from '../../src/domain/conversation';
import type { StepDigest } from '../../src/domain/semantic';
import type { NodeTree, TreeIssue, TreeNode, TreeState } from '../../src/domain/tree';
import { saveTreeDraft } from '../../src/domain/tree-state';
import { nodeTypeNames } from '../../src/adapters/tree-view';
import type { TreeChange } from '../../src/adapters/workspace-storage';
import type { UpdateTreeRequest, UpdateTreeResult } from '../../src/shared/messages';
import TreeGraph from './TreeGraph';
import ContextPackPanel from './ContextPackPanel';
import { backgroundNodeIds } from '../../src/domain/context-pack';

export type StepLocation = { stepId: string; sequence: number } | null;
interface Props {
  workspace: Workspace;
  state: TreeState;
  digests: StepDigest[];
  canEdit: boolean;
  blockedReason?: string;
  sourceChanged: boolean;
  location: StepLocation;
  onChange: (state: TreeState) => void;
  onBusyChange: (busy: boolean) => void;
  onStep: (id: string) => void;
}

export default function TreeWorkbench({ workspace, state, digests, canEdit, blockedReason, sourceChanged, location, onChange, onBusyChange, onStep }: Props) {
  const tree = state.currentTree;
  const [view, setView] = useState<'list' | 'graph'>('list');
  const [focusedId, setFocusedId] = useState<string | null>(tree.nodes[0]?.id ?? null);
  const [draft, setDraft] = useState<NodeTree | null>(null);
  const [editingId, setEditingId] = useState('');
  const [issues, setIssues] = useState<TreeIssue[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const backgroundIds = backgroundNodeIds(tree, selectedIds);
  const selectionDisabled = sourceChanged || Boolean(draft) || saving;
  const errors = useRef<HTMLDivElement>(null);
  const editorTitle = useRef<HTMLInputElement>(null);
  const detail = useRef<HTMLElement>(null);
  const focused = tree.nodes.find((node) => node.id === focusedId) ?? tree.nodes[0];
  const editingIndex = draft?.nodes.findIndex((node) => node.id === editingId) ?? -1;
  const editing = draft?.nodes[editingIndex];
  const byStep = new Map(digests.map((digest) => [digest.stepId, digest]));

  useEffect(() => { onBusyChange(Boolean(draft) || saving || confirmReset); return () => onBusyChange(false); }, [draft !== null, saving, confirmReset, onBusyChange]);
  useEffect(() => { if (issues.length || error) errors.current?.focus(); }, [issues, error]);
  useEffect(() => {
    if (!location) return;
    const owner = tree.nodes.find((node) => node.stepIds.includes(location.stepId));
    if (owner) { setFocusedId(owner.id); document.getElementById('tree-workbench')?.scrollIntoView({ block: 'start' }); }
  }, [location, tree]);

  function browse(id: string) { setFocusedId(id); }
  function startEdit() {
    setDraft(structuredClone(tree)); setEditingId(focused?.id ?? tree.nodes[0]!.id);
    setNotice(''); setIssues([]); setError(''); setConfirmReset(false);
    requestAnimationFrame(() => editorTitle.current?.focus());
  }
  function changeDraft(next: NodeTree) { setDraft(next); setIssues([]); setError(''); }
  function patchNode(patch: Partial<TreeNode>) {
    changeDraft({ nodes: draft!.nodes.map((node) => node.id === editingId ? { ...node, ...patch } : node) });
  }
  function createNode() {
    const next = structuredClone(draft!);
    let number = 1;
    while (next.nodes.some((node) => node.id === `N${String(number).padStart(3, '0')}`)) number++;
    const id = `N${String(number).padStart(3, '0')}`;
    next.nodes.push({ id, title: '新节点', summary: '', type: 'normal', parentId: null, stepIds: [] });
    changeDraft(next); setEditingId(id); editorTitle.current?.focus();
  }
  function moveStep(stepId: string, target: string) {
    changeDraft({ nodes: draft!.nodes.map((node) => ({ ...node,
      stepIds: node.id === target ? [...node.stepIds.filter((id) => id !== stepId), stepId] : node.stepIds.filter((id) => id !== stepId),
    })) });
  }
  const original = tree.nodes.find((node) => node.id === editingId);
  const wasNonempty = Boolean(original && (original.stepIds.length || tree.nodes.some((node) => node.parentId === editingId)));
  const isNonempty = Boolean(editing && (editing.stepIds.length || draft!.nodes.some((node) => node.parentId === editingId)));
  const deleteReason = isNonempty ? '这个节点仍有 Step 或子节点。请先调整归属并保存。'
    : wasNonempty ? '归属调整尚未保存。请先保存修改，再编辑并删除这个空叶节点。' : '';
  function deleteNode() {
    if (deleteReason) return;
    const next = { nodes: draft!.nodes.filter((node) => node.id !== editingId) };
    changeDraft(next); setEditingId(next.nodes[0]?.id ?? '');
  }
  async function commit(change: TreeChange) {
    setSaving(true); setError(''); setIssues([]); setNotice('');
    try {
      const request: UpdateTreeRequest = { type: 'bo/update-tree', workspace, expectedTree: tree, change };
      const result: UpdateTreeResult = await browser.runtime.sendMessage(request);
      if (!result.ok) throw new Error(result.error);
      onChange(result.treeState); setDraft(null); setConfirmReset(false);
      setSelectedIds((ids) => change.type === 'baseline' ? [] : ids.filter((id) => result.treeState.currentTree.nodes.some((node) => node.id === id)));
      setFocusedId(result.treeState.currentTree.nodes.find((node) => node.id === editingId)?.id ?? result.treeState.currentTree.nodes[0]?.id ?? null);
      setNotice(change.type === 'baseline' ? '已恢复 AI 初始结构，并保存到本地。' : '修改已通过校验并保存到本地。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存连接失败，草稿已保留，请重试。'); }
    finally { setSaving(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const result = saveTreeDraft(state, draft, workspace.timeline);
    if (!result.ok) { setIssues(result.issues); setError(''); return; }
    void commit({ type: 'draft', draft: result.value.currentTree });
  }
  function fieldError(field: string) { return issues.filter((issue) => issue.path === `nodes[${editingIndex}].${field}`); }
  function issueTarget(issue: TreeIssue) {
    const match = issue.path.match(/^nodes\[(\d+)\]\.(title|summary|type|parentId)/);
    if (match) return { id: draft?.nodes[Number(match[1])]?.id, field: match[2] };
    return { id: undefined, field: 'step-owners' };
  }
  function selectionControl(node: TreeNode) {
    return <label className="node-select" onClick={(event) => event.stopPropagation()}>
      <input type="checkbox" aria-label={`带走 ${node.id} · ${node.title}`} checked={selectedIds.includes(node.id)} disabled={selectionDisabled}
        onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, node.id] : ids.filter((id) => id !== node.id))} />带走
      {selectedIds.includes(node.id) ? <span className="selection-badge">已选核心</span> : backgroundIds.includes(node.id) ? <span className="background-badge">自动背景</span> : null}
    </label>;
  }

  function renderBranch(parentId: string | null) {
    return <ul className="tree-list">{tree.nodes.filter((node) => node.parentId === parentId).map((node) => {
      const children = tree.nodes.some((child) => child.parentId === node.id);
      const button = <button type="button" className={`tree-list-item ${focused?.id === node.id ? 'is-focused' : ''}`}
        aria-current={focused?.id === node.id ? 'true' : undefined} onClick={() => browse(node.id)}>
        <span className="step-meta">{node.id} · {nodeTypeNames[node.type]}</span><span>{node.title}</span><small>{node.stepIds.length} 个 Step</small>
      </button>;
      const row = <div className="tree-list-choice">{selectionControl(node)}{button}</div>;
      return <li key={node.id}>{children ? <details open><summary>{row}</summary>{renderBranch(node.id)}</details> : row}</li>;
    })}</ul>;
  }

  return <section id="tree-workbench" className="tree-workbench" aria-label="结构浏览与编辑">
    <h3>{sourceChanged ? '上次保存的结构' : '当前结构'} · {tree.nodes.length} 个节点</h3>
    <div className="workbench-actions" aria-label="结构视图">
      <button type="button" className="text-button" aria-pressed={view === 'list'} onClick={() => setView('list')}>节点列表</button>
      <button type="button" className="text-button" aria-pressed={view === 'graph'} onClick={() => setView('graph')}>结构图</button>
      <button type="button" className="text-button" onClick={() => detail.current?.scrollIntoView({ block: 'start' })}>查看节点详情</button>
    </div>
    <p className="hint">{view === 'graph' ? '点击节点查看详情；拖动画布移动视野，使用左下角按钮缩放或查看全图。' : '点击节点查看详情；有子节点的分支可展开或收起。'}</p>
    <p className="selection-summary" role="status">已选 {selectedIds.length} 个核心节点 · 自动补充 {backgroundIds.length} 个背景节点 <a href="#context-pack">查看导出预览</a></p>
    {view === 'graph' ? <TreeGraph tree={tree} focusedId={focused?.id ?? null} selectedIds={selectedIds} backgroundIds={backgroundIds} onNode={browse} /> : renderBranch(null)}

    {focused && <section className="node-detail" ref={detail} aria-label="节点详情">
      <span className="step-meta">{focused.id} · {nodeTypeNames[focused.type]}</span>
      <h4>{focused.title}</h4><p className="source-text">{focused.summary || '暂无摘要'}</p>
      {selectionControl(focused)}
      <p className="hint">上级节点：{tree.nodes.find((node) => node.id === focused.parentId)?.title ?? '无，独立开端'}</p>
      <h4>所属 Step · {focused.stepIds.length}</h4>
      {focused.stepIds.map((id) => {
        const digest = byStep.get(id)!;
        return <details className="digest-details" key={id}><summary>{id} · {digest.progress || digest.userResponse}</summary>
          <div className="digest"><p><strong>用户推进：</strong>{digest.userResponse}</p><p><strong>AI 动作：</strong>{digest.aiAction}</p>
            <p><strong>过程结果：</strong>{digest.progress}</p>{digest.nextReason && <p><strong>为何继续：</strong>{digest.nextReason}</p>}
            <button type="button" className="text-button" disabled={sourceChanged} onClick={() => onStep(id)}>{id} · 查看原文</button></div>
        </details>;
      })}
      {!focused.stepIds.length && <p className="hint">空节点，可以继续分配 Step。</p>}
    </section>}

    {!draft && <div className="workbench-actions">
      <button type="button" className="primary-button" disabled={!canEdit || saving} onClick={startEdit}>编辑结构</button>
      <button type="button" className="text-button" disabled={!canEdit || saving} onClick={() => setConfirmReset(true)}>恢复 AI 初始结构</button>
    </div>}
    {!canEdit && <p className="hint">{blockedReason || (sourceChanged ? '来源版本变化，当前只浏览旧结构；重新匹配前不能编辑或恢复初始结构。' : '请先完成本地保存，再编辑结构。')}</p>}
    {confirmReset && <div className="reset-confirm" role="group" aria-label="确认恢复初始结构">
      <p>恢复后，当前人工修改会被 AI 初始结构替换并保存。此操作没有撤销历史。</p>
      <div className="workbench-actions"><button type="button" className="text-button" disabled={saving} onClick={() => void commit({ type: 'baseline' })}>确认恢复</button>
        <button type="button" className="text-button" disabled={saving} onClick={() => setConfirmReset(false)}>取消恢复</button></div>
    </div>}
    {(error || issues.length > 0) && <div className="error" role="alert" tabIndex={-1} ref={errors}>
      <strong>未保存修改</strong>{error && <p className="source-text">{error}</p>}
      {issues.length > 0 && <ul>{issues.map((issue, index) => {
        const target = issueTarget(issue);
        return <li key={index}><a href={`#edit-${target.field}`} onClick={() => { if (target.id) setEditingId(target.id); }}>{issue.message}</a></li>;
      })}</ul>}
    </div>}
    {draft && <form className="tree-editor" onSubmit={submit} noValidate>
      <h4>编辑草稿</h4><p className="hint">上方仍显示已保存结构。修改完成后统一保存；关闭侧边栏会丢弃未保存草稿。保存或取消后才能读取其他会话。</p>
      <fieldset disabled={saving}>
        <label htmlFor="edit-node">选择要编辑的节点</label>
        <select id="edit-node" value={editingId} onChange={(event) => setEditingId(event.target.value)}>{draft.nodes.map((node) => <option key={node.id} value={node.id}>{node.id} · {node.title || '未命名'}</option>)}</select>
        <button type="button" className="text-button" onClick={createNode}>新建节点</button>
        {editing && <>
          <label htmlFor="edit-title">节点标题</label><input id="edit-title" ref={editorTitle} value={editing.title} aria-invalid={fieldError('title').length > 0} aria-describedby="title-errors" onChange={(event) => patchNode({ title: event.target.value })} />
          <span id="title-errors" className="field-error">{fieldError('title').map((issue) => issue.message).join('；')}</span>
          <label htmlFor="edit-summary">节点摘要</label><textarea id="edit-summary" rows={4} value={editing.summary} onChange={(event) => patchNode({ summary: event.target.value })} />
          <label htmlFor="edit-type">节点类型</label><select id="edit-type" value={editing.type} aria-invalid={fieldError('type').length > 0} onChange={(event) => patchNode({ type: event.target.value as TreeNode['type'] })}>
            {Object.entries(nodeTypeNames).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select>
          <label htmlFor="edit-parentId">上级节点</label><select id="edit-parentId" value={editing.parentId ?? ''} aria-invalid={fieldError('parentId').length > 0} aria-describedby="parent-errors" onChange={(event) => patchNode({ parentId: event.target.value || null })}>
            <option value="">无，独立开端</option>{draft.nodes.filter((node) => node.id !== editing.id).map((node) => <option key={node.id} value={node.id}>{node.id} · {node.title}</option>)}</select>
          <span id="parent-errors" className="field-error">{fieldError('parentId').map((issue) => issue.message).join('；')}</span>
          <p className="hint">主线开端不能有上级；支线开端必须有上级；普通阶段可以独立。类型与上级需由你分别选择。</p>
          <button type="button" className="text-button danger-button" disabled={Boolean(deleteReason)} onClick={deleteNode}>删除这个空叶节点</button>
          {deleteReason && <p className="hint">{deleteReason}</p>}
        </>}
        <h4 id="edit-step-owners" tabIndex={-1}>Step 归属</h4><p className="hint">每个 Step 只能属于一个节点。可将任意 Step 移到新建或已有节点；原文和时间线顺序不会改变。</p>
        <div className="step-owners">{workspace.timeline.steps.map((step) => <div className="step-owner" key={step.id}>
          <label htmlFor={`owner-${step.id}`}>{step.id} · {byStep.get(step.id)?.progress || '推进片段'}</label>
          <select id={`owner-${step.id}`} value={draft.nodes.find((node) => node.stepIds.includes(step.id))?.id ?? ''} onChange={(event) => moveStep(step.id, event.target.value)}>
            {draft.nodes.map((node) => <option key={node.id} value={node.id}>{node.id} · {node.title || '未命名'}</option>)}</select>
        </div>)}</div>
        <div className="workbench-actions"><button type="submit" className="primary-button">{saving ? '正在保存…' : '保存修改'}</button>
          <button type="button" className="text-button" onClick={() => { setDraft(null); setIssues([]); setError(''); }}>取消编辑</button></div>
      </fieldset>
    </form>}
    <p className="notice" role="status">{notice}</p>
    <ContextPackPanel workspace={workspace} tree={tree} digests={digests} selectedIds={selectedIds}
      disabledReason={sourceChanged ? '分享内容与旧结构不匹配，暂不能组装原文。请先处理来源版本变化。' : draft ? '请先保存或取消编辑，再选择和导出当前结构。' : saving ? '正在保存，请稍候再导出。' : ''}
      onClear={() => setSelectedIds([])} />
  </section>;
}
