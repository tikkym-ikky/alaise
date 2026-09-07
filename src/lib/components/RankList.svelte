<script lang="ts">
	import type { Ranked } from '$lib/ratings.svelte';
	import { colorFor, cleanLabel, fmtDist, fmtScore, iconFor } from '$lib/ui';

	let {
		items,
		sortBy = $bindable('distance'),
		hasUserPos = false,
		onopen
	}: {
		items: Ranked[];
		sortBy: 'distance' | 'rating';
		hasUserPos?: boolean;
		onopen: (s: Ranked) => void;
	} = $props();
</script>

<section class="view grain">
	<header>
		<p class="eyebrow">À proximité</p>
		<h1>Où s’arrêter</h1>

		<div class="sort" role="group" aria-label="Trier">
			<span class="thumb" class:right={sortBy === 'rating'}></span>
			<button class:on={sortBy === 'distance'} onclick={() => (sortBy = 'distance')}>
				Au plus près
			</button>
			<button class:on={sortBy === 'rating'} onclick={() => (sortBy = 'rating')}>
				Au plus propre
			</button>
		</div>

		{#if !hasUserPos && items.length}
			<p class="note">Distances mesurées depuis le centre de la carte.</p>
		{/if}
	</header>

	{#if items.length === 0}
		<div class="empty">
			<svg viewBox="0 0 120 96" width="132" height="106" aria-hidden="true">
				<g fill="none" stroke="currentColor" stroke-width="1.2" opacity=".5">
					{#each [0, 1, 2, 3] as r (r)}
						{#each [0, 1, 2, 3, 4] as c (c)}
							<rect x={8 + c * 21} y={6 + r * 21} width="19" height="19" rx="4" />
						{/each}
					{/each}
				</g>
				<circle cx="60" cy="48" r="15" fill="var(--surface)" />
				<circle cx="60" cy="48" r="14" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".75" />
				<circle cx="60" cy="48" r="4.6" fill="currentColor" opacity=".75" />
			</svg>
			<h2>Rien de noté par ici</h2>
			<p>
				Reviens à la carte, charge une zone, puis raconte comment ça s’est passé.
				Le classement se remplira tout seul.
			</p>
		</div>
	{:else}
		<ol>
			{#each items as s, i (s.placeId)}
				<li style:--d="{Math.min(i, 12) * 34}ms">
					<button onclick={() => onopen(s)}>
						<span class="rank numeral" class:podium={i < 3}>{i + 1}</span>

						{#if s.photo_url}
							<img class="shot" src={s.photo_url} alt="" loading="lazy" />
						{:else}
							<span class="shot ph">{iconFor(s.kind)}</span>
						{/if}

						<span class="body">
							<strong>{s.name}</strong>
							<span class="meta">
								{#if s.dist !== null}<b>{fmtDist(s.dist)}</b> ·{/if}
								{cleanLabel(s.avg)} · {s.count} avis
							</span>
							{#if s.lastNote}<span class="quote">« {s.lastNote} »</span>{/if}
						</span>

						<span class="score numeral" style:--c={colorFor(s.avg)}>{fmtScore(s.avg)}</span>
					</button>
				</li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	.view {
		position: absolute;
		inset: 0;
		top: calc(env(safe-area-inset-top, 0px) + 74px);
		z-index: 6;
		background: var(--paper);
		background-image: var(--tile);
		border-radius: var(--r-xl) var(--r-xl) 0 0;
		box-shadow: var(--lift-3);
		overflow-y: auto;
		padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 104px);
	}

	header {
		position: relative;
		z-index: 1;
		padding: 26px 22px 16px;
	}
	h1 {
		margin: 6px 0 18px;
		font-family: var(--serif);
		font-weight: 600;
		font-size: 34px;
		line-height: 1.02;
		letter-spacing: -0.025em;
	}
	.note {
		margin: 12px 0 0;
		font-size: 12px;
		color: var(--muted);
	}

	/* segmenté avec pouce coulissant */
	.sort {
		position: relative;
		display: inline-flex;
		padding: 4px;
		border-radius: 999px;
		background: var(--surface);
		border: 1px solid var(--hairline);
		box-shadow: var(--inset);
	}
	.thumb {
		position: absolute;
		top: 4px;
		left: 4px;
		width: calc(50% - 4px);
		height: calc(100% - 8px);
		border-radius: 999px;
		background: var(--glaze);
		box-shadow: var(--lift-1);
		transition: transform 0.42s var(--spring);
	}
	.thumb.right {
		transform: translateX(100%);
	}
	.sort button {
		position: relative;
		z-index: 1;
		flex: 1;
		border: 0;
		background: none;
		padding: 8px 18px;
		border-radius: 999px;
		font-size: 13px;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--muted);
		cursor: pointer;
		white-space: nowrap;
		transition: color 0.25s var(--ease);
	}
	.sort button.on {
		color: var(--glaze-ink);
	}

	/* liste éditoriale : pas de cartes, des filets */
	ol {
		position: relative;
		z-index: 1;
		list-style: none;
		margin: 0;
		padding: 0 22px;
	}
	li {
		border-top: 1px solid var(--hairline);
		animation: rise 0.5s var(--ease) both;
		animation-delay: var(--d);
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
	}
	li button {
		display: flex;
		align-items: center;
		gap: 14px;
		width: 100%;
		padding: 15px 2px;
		border: 0;
		background: none;
		text-align: left;
		cursor: pointer;
		transition: opacity 0.15s;
	}
	li button:active {
		opacity: 0.55;
	}

	.rank {
		flex: none;
		width: 26px;
		font-size: 19px;
		color: var(--muted);
		text-align: right;
	}
	.rank.podium {
		font-size: 24px;
		color: var(--terracotta);
	}

	.shot {
		flex: none;
		width: 52px;
		height: 52px;
		border-radius: 15px;
		object-fit: cover;
		background: var(--surface-2);
		border: 1px solid var(--hairline);
	}
	.shot.ph {
		display: grid;
		place-items: center;
		font-size: 21px;
	}

	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.body strong {
		font-family: var(--serif);
		font-weight: 600;
		font-size: 17px;
		letter-spacing: -0.015em;
		line-height: 1.2;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta {
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta b {
		color: var(--ink-2);
		font-weight: 600;
	}
	.quote {
		font-size: 13px;
		color: var(--ink-2);
		font-style: italic;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.score {
		flex: none;
		font-size: 30px;
		color: var(--c);
	}

	/* vide */
	.empty {
		margin: 26px auto 0;
		max-width: 300px;
		padding: 0 24px;
		text-align: center;
		color: var(--muted);
	}
	.empty svg {
		color: var(--hairline-strong);
		margin-bottom: 14px;
	}
	.empty h2 {
		margin: 0 0 8px;
		font-family: var(--serif);
		font-weight: 600;
		font-size: 21px;
		letter-spacing: -0.02em;
		color: var(--ink);
	}
	.empty p {
		margin: 0;
		font-size: 14px;
		line-height: 1.6;
	}
</style>
