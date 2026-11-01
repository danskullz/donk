import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Runes only (ADR 0001, rule 2): Svelte 4 syntax fails the build.
    runes: true,
  },
};
