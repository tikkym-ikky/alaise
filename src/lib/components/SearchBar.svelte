<script lang="ts">
	import { fly } from 'svelte/transition';
	import { geocode, type GeoResult } from '$lib/geocode';
	import { iconFor } from '$lib/ui';
	import { theme, THEME_LABEL } from '$lib/theme.svelte';

	let {
		center = null,
		onpick,
		onfail
	}: {
		center?: { lat: number; lon: number } | null;
		onpick: (r: GeoResult) => void;
		onfail?: (msg: string) => void;
	} = $props();

	let q = $state('');
	let results = $state<GeoResult[]>([]);
	let searching = $state(false);
	let open = $state(false);
	let timer: ReturnType<typeof setTimeout>;

	function onInput() {
		clearTimeout(timer);
		const term = q;
		if (term.trim().length < 3) {
			results = [];
			return;
		}
		timer = setTimeout(async () => {
			searching = true;
			try {
				results = await geocode(term, center ?? undefined);
				open = true;
			} catch {
				onfail?.('Recherche indisponible');
			}
			searching = false;
		}, 320);
	}

	function clear() {
		q = '';
		results = [];
		open = false;
	}

	function pick(r: GeoResult) {
		open = false;
		results = [];
		q = r.label;
		onpick(r);
	}
</script>

<div class="wrap">
	<div class="bar" class:focused={open}>
		<svg class="mark" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
			<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6" />
			<circle cx="12" cy="12" r="3.4" fill="currentColor" />
		</svg>
		<input
			type="search"
			placeholder="Une rue, un café, une gare…"
			autocomplete="off"
			bind:value={q}
			oninput={onInput}
			onfocus={() => (open = true)}
			onblur={() => setTimeout(() => (open = false), 170)}
		/>
		{#if searching}
			<span class="spin" aria-label="Recherche en cours"></span>
		{:else if q}
			<button class="slot" onclick={clear} aria-label="Effacer">
				<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
					<path d="M6 6l12 12M18 6L6 18" />
				</svg>
			</button>
		{:else}
			<!-- le champ vide libère la place : on y loge le réglage de thème -->
			<button
				class="slot theme"
				onmousedown={(e) => e.preventDefault()}
				onclick={() => theme.cycle()}
				aria-label={THEME_LABEL[theme.value]}
				title={THEME_LABEL[theme.value]}
			>
				{#if theme.value === 'auto'}
					<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7">
						<circle cx="12" cy="12" r="8" />
						<path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none" />
					</svg>
				{:else if theme.value === 'light'}
					<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
						<circle cx="12" cy="12" r="4.2" />
						<path d="M12 2v2.4M12 19.6V22M22 12h-2.4M4.4 12H2M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7M19.1 19.1l-1.7-1.7M6.6 6.6L4.9 4.9" />
					</svg>
				{:else}
					<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
						<path d="M20.4 14.6A8.5 8.5 0 0 1 9.4 3.6a8.5 8.5 0 1 0 11 11z" />
					</svg>
				{/if}
			</button>
		{/if}
	</div>

	{#if open && results.length}
		<ul class="panel" transition:fly={{ y: -10, duration: 200 }}>
			{#each results as r, i (r.id)}
				<li style:--d="{i * 26}ms">
					<button onmousedown={(e) => e.preventDefault()} onclick={() => pick(r)}>
						<span class="tile">{r.isPlace ? iconFor(r.kind) : '↗'}</span>
						<span class="text">
							<strong>{r.label}</strong>
							{#if r.detail}<span>{r.detail}</span>{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.wrap {
		position: relative;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 52px;
		padding: 0 8px 0 16px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--surface) 90%, transparent);
		-webkit-backdrop-filter: blur(20px) saturate(1.4);
		backdrop-filter: blur(20px) saturate(1.4);
		border: 1px solid var(--hairline);
		box-shadow: var(--lift-2);
		transition: border-color 0.25s var(--ease), box-shadow 0.25s var(--ease);
	}
	.bar.focused {
		border-color: color-mix(in srgb, var(--glaze) 55%, transparent);
		box-shadow: var(--lift-2), 0 0 0 4px color-mix(in srgb, var(--glaze) 12%, transparent);
	}
	.mark {
		flex: none;
		color: var(--glaze);
	}
	input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: none;
		padding: 0;
		font-size: 15px;
		letter-spacing: -0.01em;
	}
	input::placeholder {
		color: var(--muted);
	}
	input:focus {
		outline: none;
	}
	input::-webkit-search-cancel-button {
		display: none;
	}

	.slot {
		flex: none;
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border: 0;
		border-radius: 50%;
		background: var(--surface-2);
		color: var(--muted);
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}
	.slot:active {
		background: var(--hairline);
	}
	.slot.theme:hover {
		color: var(--glaze);
	}

	.spin {
		flex: none;
		width: 16px;
		height: 16px;
		margin-right: 8px;
		border-radius: 50%;
		border: 2px solid color-mix(in srgb, var(--glaze) 25%, transparent);
		border-top-color: var(--glaze);
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.panel {
		list-style: none;
		margin: 10px 0 0;
		padding: 7px;
		background: var(--surface);
		border: 1px solid var(--hairline);
		border-radius: var(--r-lg);
		box-shadow: var(--lift-2);
	}
	.panel li {
		animation: rise 0.34s var(--ease) both;
		animation-delay: var(--d);
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}
	.panel li + li {
		border-top: 1px solid var(--hairline);
	}
	.panel button {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 11px 9px;
		border: 0;
		background: none;
		border-radius: var(--r-sm);
		text-align: left;
		cursor: pointer;
	}
	.panel button:active {
		background: var(--surface-2);
	}
	.tile {
		flex: none;
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: 11px;
		font-size: 16px;
		background: var(--surface-2);
		border: 1px solid var(--hairline);
		color: var(--muted);
	}
	.text {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.text strong {
		font-size: 14.5px;
		font-weight: 600;
		letter-spacing: -0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.text span {
		font-size: 12px;
		color: var(--muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
