import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Branch Organizer',
    description: '把长 AI 会话整理为可浏览、可修正、可导出的推进结构。',
    permissions: ['sidePanel', 'storage', 'clipboardWrite'],
    host_permissions: ['https://chatgpt.com/*', 'https://api.deepseek.com/*'],
    action: {
      default_title: '打开 Branch Organizer',
    },
  },
});

