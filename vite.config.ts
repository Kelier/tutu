import { defineConfig, type Plugin } from 'vite';
import compression from 'compression';

// 线上预览：gzip（mediapipe wasm 13MB → 3.8MB）+ 长缓存
function servePlugin(): Plugin {
  return {
    name: 'crayon-serve',
    configurePreviewServer(server) {
      server.middlewares.use(compression({ filter: (req, res) => /wasm|tflite/.test(req.url ?? '') || compression.filter(req, res) }) as never);
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (url.startsWith('/assets/') || url.startsWith('/mediapipe/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else if (url.startsWith('/samples/') || url.endsWith('.svg')) res.setHeader('Cache-Control', 'public, max-age=86400');
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [servePlugin()],
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
