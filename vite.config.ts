import { defineConfig } from 'vite';

// Relative asset paths so the build works from any sub-path (e.g. GitHub Pages
// serves this repo at https://<user>.github.io/powerchord/).
export default defineConfig({
  base: './',
});
