import type { TreeState } from './tree';

export interface StepDigest {
  stepId: string;
  userResponse: string;
  aiAction: string;
  progress: string;
  nextReason: string;
}

export interface ModelUsage {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
}

export interface JsonRequest {
  system: string;
  input: unknown;
}

export interface JsonCompletion {
  data: unknown;
  usage: ModelUsage;
}

export interface SemanticProvider {
  completeJson(request: JsonRequest, signal?: AbortSignal): Promise<JsonCompletion>;
}

export interface DigestResult {
  digests: StepDigest[];
  usage: ModelUsage[];
}

export interface TreeGenerationResult {
  treeState: TreeState;
  usage: ModelUsage;
}
