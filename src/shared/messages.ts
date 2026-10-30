import type { Workspace } from '../domain/conversation';
import type { DigestResult, StepDigest, TreeGenerationResult } from '../domain/semantic';
import type { NodeTree, TreeState } from '../domain/tree';
import type { ContinuationCandidate, SavedWorkspace, WorkspaceRestore } from '../application/workspace-snapshot';
import type { RegenerationContent, TreeChange } from '../adapters/workspace-storage';
import type { AppendBase, AppendBaselineResult, AppendProposalResult } from '../application/incremental-engine';

export interface ImportShareRequest { type: 'bo/import-share'; url: string; }
export type ImportShareResult = { ok: true; workspace: Workspace; restore: WorkspaceRestore } | { ok: false; error: string };
export type ContinueWorkspaceRequest = { type: 'bo/continue-workspace'; workspace: Workspace; source: ContinuationCandidate };
export type ContinueWorkspaceResult = { ok: true; restore: WorkspaceRestore } | { ok: false; error: string };
export type SaveWorkspaceRequest = { type: 'bo/save-workspace'; workspace: Workspace; digests: StepDigest[]; treeState: TreeState };
export type SaveWorkspaceResult = { ok: true } | { ok: false; error: string };
export type PrepareRegenerationRequest = { type: 'bo/prepare-regeneration'; workspace: Workspace; expected: RegenerationContent };
export type PrepareRegenerationResult = { ok: true; revision: string } | { ok: false; error: string };
export type ReplaceWorkspaceRequest = { type: 'bo/replace-workspace'; workspace: Workspace; revision: string; digests: StepDigest[]; proposal: NodeTree };
export type ReplaceWorkspaceResult = { ok: true; snapshot: SavedWorkspace } | { ok: false; error: string };
export type UpdateTreeRequest = { type: 'bo/update-tree'; workspace: Workspace; expectedTree: NodeTree; change: TreeChange };
export type UpdateTreeResult = { ok: true; treeState: TreeState } | { ok: false; error: string };
export type SaveAppendRequest = { type: 'bo/save-append'; workspace: Workspace; base: AppendBase; digests: StepDigest[]; proposal: unknown; baseline: NodeTree };
export type SaveAppendResult = { ok: true; snapshot: SavedWorkspace } | { ok: false; error: string };

export type ProviderRequest = { type: 'bo/provider-status' } | { type: 'bo/set-provider-key'; key: string } | { type: 'bo/forget-provider-key' };
export type ProviderStatusResult = { ok: true; configured: boolean } | { ok: false; error: string };

export type SemanticJob = { type: 'digests'; workspace: Workspace } | { type: 'tree'; workspace: Workspace; digests: StepDigest[] }
  | { type: 'regenerate-digests'; workspace: Workspace; revision: string }
  | { type: 'regenerate-tree'; workspace: Workspace; revision: string; digests: StepDigest[] }
  | { type: 'append-digests'; workspace: Workspace; base: AppendBase }
  | { type: 'append-tree' | 'append-baseline'; workspace: Workspace; base: AppendBase; digests: StepDigest[] };
export type SemanticJobResult = ({ stage: 'digests' | 'append-digests' } & DigestResult) | ({ stage: 'tree' } & TreeGenerationResult)
  | ({ stage: 'append-tree' } & AppendProposalResult) | ({ stage: 'append-baseline' } & AppendBaselineResult);
export type SemanticPortMessage = { type: 'progress'; text: string } | { type: 'result'; result: SemanticJobResult } | { type: 'error'; error: string };
