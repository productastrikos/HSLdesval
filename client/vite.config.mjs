import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Migrated from Create React App. The source uses .js files that contain JSX, so
// esbuild is told to treat .js as JSX (dev transform + dependency pre-bundling).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Dev: forward API calls to the Express server (replaces CRA's "proxy" field)
      '/api': 'http://localhost:5001',
    },
  },
  build: {
    outDir: 'build',     // Express serves client/build in production
    sourcemap: false,
  },
  // Treat src/*.js as JSX (Vite/esbuild only does this for .jsx by default).
  esbuild: { loader: 'jsx', include: /src\/.*\.js$/, exclude: [] },
  optimizeDeps: { esbuildOptions: { loader: { '.js': 'jsx' } } },
});
