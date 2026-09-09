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
	// maplibre-gl ships a web worker que l'optimiseur de deps de Vite ne sait pas pré-bundler.
	optimizeDeps: { exclude: ['maplibre-gl'] },
	// Le worker de MapLibre est chargé en `{ type: 'module' }` : on force Vite à
	// émettre un vrai module ES (défaut = iife) pour le worker empaqueté.
	worker: { format: 'es' }
});
