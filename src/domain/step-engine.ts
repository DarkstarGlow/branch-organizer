import type { Message, SourceRef, Step, Timeline } from './conversation';
import { sourceSnippet } from './source-snippet';

function reference(message: Message): SourceRef {
  return { messageId: message.id, order: message.order, role: message.role, snippet: sourceSnippet(message.lookupText) };
}

export function buildTimeline(messages: Message[]): Timeline {
  const steps: Step[] = [];
  const leadingMessageIds: string[] = [];
  let current: Step | undefined;
  for (const message of messages) {
    if (message.role === 'user') {
      if (current) {
        current.state = 'closed';
        current.nextUserMessageId = message.id;
      }
      current = {
        id: `S${String(steps.length + 1).padStart(3, '0')}`,
        position: steps.length,
        state: 'tail',
        userMessageId: message.id,
        responseMessageIds: [],
        nextUserMessageId: null,
        sourceRefs: [reference(message)],
      };
      steps.push(current);
    } else if (current) {
      current.responseMessageIds.push(message.id);
      current.sourceRefs.push(reference(message));
    } else {
      leadingMessageIds.push(message.id);
    }
  }
  return { steps, leadingMessageIds };
}
