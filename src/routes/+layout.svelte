<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<title>loomap — noter les toilettes en vadrouille</title>
	<meta name="description" content="Note la propreté des toilettes des lieux où tu t'arrêtes." />
	<meta name="theme-color" content="#111827" />
	<meta name="mobile-web-app-capable" content="yes" />
	<link rel="icon" href={favicon} />
	<link rel="manifest" href="/manifest.webmanifest" />
</svelte:head>

{@render children()}
