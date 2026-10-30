// 仅 Background 使用；不把密钥返回给 Side Panel，不写 local / sync / 构建环境变量。
const keyName = 'bo:deepseek-api-key';

export async function getDeepSeekKey(): Promise<string> {
  const data = await browser.storage.session.get(keyName);
  return typeof data[keyName] === 'string' ? data[keyName] : '';
}

export async function setDeepSeekKey(key: string): Promise<void> {
  if (!key.trim() || /[\r\n]/.test(key)) throw new Error('请输入单行的 DeepSeek API Key。');
  await browser.storage.session.set({ [keyName]: key.trim() });
}

export async function forgetDeepSeekKey(): Promise<void> {
  await browser.storage.session.remove(keyName);
}
