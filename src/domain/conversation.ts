export type MessageRole = 'user' | 'assistant' | 'tool';

export interface SourceAsset {
  assetType: 'image' | 'file';
  url: string;
  filename: string;
  description: string | null;
  downloadable: boolean;
}

export interface Message {
  id: string;
  order: number;
  role: MessageRole;
  text: string;
  createdAt: number | null;
  assets: SourceAsset[];
  lookupText: string;
  sourceContent: Record<string, unknown>;
  sourceReferences: { citations: unknown[]; contentReferences: unknown[] };
}

export interface Conversation {
  key: string;
  shareUrl: string;
  title: string;
  messages: Message[];
}

export interface SourceRef {
  messageId: string;
  order: number;
  role: MessageRole;
  snippet: string;
}

export interface Step {
  id: string;
  position: number;
  state: 'closed' | 'tail';
  userMessageId: string;
  responseMessageIds: string[];
  // 结束边界也是下一 Step 的起点；单独引用，不复制为本 Step 的响应。
  nextUserMessageId: string | null;
  sourceRefs: SourceRef[];
}

export interface Timeline {
  steps: Step[];
  leadingMessageIds: string[];
}

export interface Workspace {
  conversation: Conversation;
  timeline: Timeline;
}
