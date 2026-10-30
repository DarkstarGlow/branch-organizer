import type { SemanticJob, SemanticJobResult, SemanticPortMessage } from './messages';

export function runSemanticJob(job: SemanticJob, onProgress: (text: string) => void, signal: AbortSignal): Promise<SemanticJobResult> {
  if (signal.aborted) return Promise.reject(new Error('生成已取消。'));
  return new Promise((resolve, reject) => {
    const port = browser.runtime.connect({ name: 'bo/semantic' });
    // 仅生成期间保活；Chrome MV3 的后台空闲计时为 30 秒。
    const heartbeat = setInterval(() => port.postMessage({ type: 'ping' }), 20_000);
    const cleanup = () => {
      clearInterval(heartbeat);
      signal.removeEventListener('abort', cancel);
      port.onMessage.removeListener(message);
      port.onDisconnect.removeListener(disconnected);
      port.disconnect();
    };
    const cancel = () => { cleanup(); reject(new Error('生成已取消。')); };
    const disconnected = () => {
      void browser.runtime.lastError;
      cleanup();
      reject(new Error('与插件后台的连接已中断，请重新打开侧边栏后重试。'));
    };
    const message = (event: SemanticPortMessage) => {
      if (event.type === 'progress') { onProgress(event.text); return; }
      cleanup();
      if (event.type === 'error') reject(new Error(event.error));
      else resolve(event.result);
    };
    port.onMessage.addListener(message);
    port.onDisconnect.addListener(disconnected);
    signal.addEventListener('abort', cancel, { once: true });
    port.postMessage(job);
  });
}
