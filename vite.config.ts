import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
			// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			// Pinned so builds work regardless of local Node; Vercel supports nodejs22.x.
			adapter: adapter({ runtime: 'nodejs22.x' })
		})
	],
	// maplibre-gl ships a web worker that Vite's dep optimizer can't pre-bundle.
	optimizeDeps: { exclude: ['maplibre-gl'] }
});
