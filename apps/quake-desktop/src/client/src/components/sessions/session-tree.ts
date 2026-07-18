export type SessionNode = { session: any; children: SessionNode[] };

/** Build parent/child session tree from flat list via parentSessionPath. */
export function buildSessionTree(sessions: any[]): { roots: SessionNode[] } {
  const nodes = new Map<string, SessionNode>();
  for (const session of sessions) nodes.set(session.path, { session, children: [] });
  const roots: SessionNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.session.parentSessionPath ? nodes.get(node.session.parentSessionPath) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return { roots };
}

/** Max nesting depth (0 = flat roots only). */
export function measureSessionTreeDepth(nodes: SessionNode[], depth = 0): number {
  let max = depth;
  for (const node of nodes) {
    if (node.children.length) max = Math.max(max, measureSessionTreeDepth(node.children, depth + 1));
  }
  return max;
}

export function shouldDefaultExpandSessionNode(depth: number, maxTreeDepth: number): boolean {
  if (maxTreeDepth <= 1) return true;
  return depth < 1;
}

/**
 * Whether a node with children should render expanded.
 * - hideBranches forces collapse
 * - expandedState remembers user choice (sessionStorage map path → boolean)
 * - default: expand when tree is shallow (≤1 level) or node is a root (depth 0)
 */
export function isSessionTreeNodeExpanded(
  path: string,
  hasChildren: boolean,
  expandedState: Record<string, boolean>,
  hideBranches: boolean,
  depth: number,
  maxTreeDepth: number,
): boolean {
  if (!hasChildren || hideBranches) return false;
  if (Object.prototype.hasOwnProperty.call(expandedState, path)) return Boolean(expandedState[path]);
  return shouldDefaultExpandSessionNode(depth, maxTreeDepth);
}
