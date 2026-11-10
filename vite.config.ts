import { defineConfig } from 'vite';
export default defineConfig(({ command }) => ({
  plugins: [
    {
      name: 'production-csp',
      transformIndexHtml: (html) =>
        command === 'build'
          ? html.replace("connect-src 'self' ws://127.0.0.1:*", "connect-src 'none'")
          : html,
    },
  ],
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: false },
}));
