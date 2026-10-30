import { graphlib, layout } from '@dagrejs/dagre';
import { MarkerType, Position, type Edge, type Node } from '@xyflow/react';
import type { NodeTree } from '../domain/tree';

export const nodeTypeNames = { main: '主线开端', branch: '支线开端', normal: '普通阶段' };

// 图形数据完全由业务 Tree 推导；坐标、选中态和连线不写回领域对象。
export function layoutTree(tree: NodeTree): { nodes: Node[]; edges: Edge[] } {
  const graph = new graphlib.Graph().setGraph({ rankdir: 'TB', nodesep: 32, ranksep: 62 }).setDefaultEdgeLabel(() => ({}));
  for (const node of tree.nodes) graph.setNode(node.id, { width: 212, height: 90 });
  for (const node of tree.nodes) if (node.parentId !== null) graph.setEdge(node.parentId, node.id);
  layout(graph);
  return {
    nodes: tree.nodes.map((node) => {
      const point = graph.node(node.id);
      return { id: node.id, data: { label: `${node.id} · ${nodeTypeNames[node.type]}\n${node.title}` },
        position: { x: point.x - 106, y: point.y - 45 }, sourcePosition: Position.Bottom, targetPosition: Position.Top,
        className: `tree-node tree-node-${node.type}`, style: { width: 212, height: 90 },
        ariaLabel: `${node.title}，${nodeTypeNames[node.type]}，${node.stepIds.length} 个 Step` };
    }),
    edges: tree.nodes.filter((node) => node.parentId !== null).map((node) => ({
      id: `edge-${node.id}`, source: node.parentId!, target: node.id, type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed }, selectable: false,
    })),
  };
}
