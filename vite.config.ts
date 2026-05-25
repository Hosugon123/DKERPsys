import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/** 每次 build 產生 buildId，供用戶端比對是否需重新載入 */
function dongshanBuildVersionPlugin(buildId: string): Plugin {
  return {
    name: 'dongshan-build-version',
    config() {
      return {
        define: {
          __APP_BUILD_ID__: JSON.stringify(buildId),
        },
      };
    },
    closeBundle() {
      const payload = JSON.stringify(
        { buildId, builtAt: new Date().toISOString() },
        null,
        2,
      );
      const distPath = path.resolve(__dirname, 'dist/build-version.json');
      fs.mkdirSync(path.dirname(distPath), { recursive: true });
      fs.writeFileSync(distPath, payload, 'utf8');
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const buildId =
    process.env.BUILD_ID?.trim() ||
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
    String(Date.now());
  return {
    plugins: [react(), tailwindcss(), dongshanBuildVersionPlugin(buildId)],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
