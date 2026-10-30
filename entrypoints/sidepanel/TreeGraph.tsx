import { useEffect, useMemo, useState } from 'react';
import { Background, Controls, ReactFlow, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { NodeTree } from '../../src/domain/tree';
import { layoutTree } from '../../src/adapters/tree-view';

export default function TreeGraph({ tree, focusedId, selectedIds, backgroundIds, onNode }: {
  tree: NodeTree; focusedId: string | null; selectedIds: string[]; backgroundIds: string[]; onNode: (id: string) => void;
}) {
  const view = useMemo(() => layoutTree(tree), [tree]);
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => { if (flow) void flow.fitView({ padding: .15, maxZoom: 1, duration: 0 }); });
    return () => cancelAnimationFrame(frame);
  }, [flow, tree]);
  return <div className="tree-graph" aria-label="节点结构图">
    <ReactFlow nodes={view.nodes.map((node) => {
      const status = selectedIds.includes(node.id) ? '已选核心' : backgroundIds.includes(node.id) ? '自动背景' : '';
      return { ...node, selected: node.id === focusedId, data: { ...node.data, label: `${status ? `${status}\n` : ''}${node.data.label}` },
        ariaLabel: `${node.ariaLabel}${status ? `，${status}` : ''}` };
    })} edges={view.edges}
      onInit={setFlow} onNodeClick={(_, node) => onNode(node.id)} fitView minZoom={.12} maxZoom={2}
      nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null}
      connectOnClick={false} edgesFocusable={false} autoPanOnNodeFocus={false}
      ariaLabelConfig={{ 'controls.zoomIn.ariaLabel': '放大结构图', 'controls.zoomOut.ariaLabel': '缩小结构图', 'controls.fitView.ariaLabel': '查看完整结构图' }}>
      <Background /><Controls showInteractive={false} />
    </ReactFlow>
  </div>;
}
