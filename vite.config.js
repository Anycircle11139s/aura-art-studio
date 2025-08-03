import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // To enable core Node.js modules for the browser, e.g., process, buffer.
      globals: true,
    }),
  ],
  build: {
    rollupOptions: {
      // Explicitly mark Firebase modules as external
      external: [
        'firebase/app',
        'firebase/auth',
        'firebase/firestore',
        // Add other firebase sub-modules if you encounter similar errors for them
        // e.g., 'firebase/storage', 'firebase/functions'
      ],
    },
  },
});