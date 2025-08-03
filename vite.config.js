import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  // This is the crucial line for GitHub Pages deployment!
  // It should match your GitHub repository name.
  base: '/aura-art-studio/',
  plugins: [
    react(),
    // We're removing nodePolyfills here as it might conflict with externalizing Firebase.
    // If you encounter other Node.js polyfill issues later, we can re-evaluate.
  ],
  build: {
    rollupOptions: {
      // Explicitly mark Firebase modules as external
      // This tells Rollup (Vite's bundler) NOT to try and bundle these.
      external: [
        'firebase/app',
        'firebase/auth',
        'firebase/firestore',
        // Add other firebase sub-modules if you use them (e.g., 'firebase/storage', 'firebase/functions')
      ],
    },
    // We're also removing commonjsOptions as it might not be needed with externalization.
  },
  // We're also removing resolve and optimizeDeps sections for simplicity.
});
