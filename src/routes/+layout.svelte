<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<title>À l'aise — les toilettes où on est bien</title>
	<meta name="description" content="Note la propreté des toilettes des lieux où tu t'arrêtes." />
	<meta name="theme-color" content="#f2efe9" media="(prefers-color-scheme: light)" />
	<meta name="theme-color" content="#131511" media="(prefers-color-scheme: dark)" />
	<meta name="mobile-web-app-capable" content="yes" />
	<link rel="icon" href={favicon} />
	<link rel="manifest" href="/manifest.webmanifest" />
</svelte:head>

{@render children()}
