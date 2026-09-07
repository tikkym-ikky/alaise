<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import type { Rating } from '$lib/ratings.svelte';
	import { labelFor } from '$lib/overpass';
	import { shrinkImage } from '$lib/image';
	import { SCALE, colorFor, cleanLabel, cleanBlurb, fmtDate, fmtScore, iconFor } from '$lib/ui';

	type Target = {
		placeId: string | null;
		name: string;
		kind: string;
		lat: number;
		lon: number;
	};

	let {
		place,
		existing,
		saving = false,
		onsave,
		onclose,
		ondelete,
		onfail
	}: {
		place: Target;
		existing: Rating[];
		saving?: boolean;
		onsave: (v: { name: string; cleanliness: number; note: string; photo: Blob | null }) => void;
		onclose: () => void;
		ondelete: (id: string) => void;
		onfail?: (msg: string) => void;
	} = $props();

	// Seulement pour un lieu ajouté à la main ; le composant est remonté à chaque ouverture.
	let name = $state('');
	let cleanliness = $state(0);
	let note = $state('');
	let photoBlob = $state<Blob | null>(null);
	let photoPreview = $state<string | null>(null);

	const avg = $derived(
		existing.length ? existing.reduce((s, r) => s + r.cleanliness, 0) / existing.length : null
	);
	/** Photo la plus récente du lieu, utilisée en bandeau. */
	const hero = $derived(existing.find((r) => r.photo_url)?.photo_url ?? null);

	async function onPhoto(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		try {
			if (photoPreview) URL.revokeObjectURL(photoPreview);
			const shrunk = await shrinkImage(file);
			photoBlob = shrunk.blob;
			photoPreview = shrunk.previewUrl;
		} catch {
			onfail?.('Photo illisible');
		}
	}

	function clearPhoto() {
		if (photoPreview) URL.revokeObjectURL(photoPreview);
		photoBlob = null;
		photoPreview = null;
	}

	function submit() {
		if (!cleanliness) return onfail?.('Choisis d’abord une note de propreté');
		onsave({ name, cleanliness, note, photo: photoBlob });
	}

	function close() {
		if (photoPreview) URL.revokeObjectURL(photoPreview);
		onclose();
	}
</script>

<div
	class="scrim"
	role="button"
	tabindex="-1"
	aria-label="Fermer"
	onclick={close}
	onkeydown={(e) => e.key === 'Escape' && close()}
	transition:fade={{ duration: 200 }}
></div>

<section class="sheet grain" transition:fly={{ y: 460, duration: 420, easing: quintOut }}>
	<div class="grip"></div>

	<div class="hero" class:shot={hero}>
		{#if hero}<img src={hero} alt="" />{/if}
		<div class="hero-in">
			<div class="who">
				<p class="eyebrow">
					{place.placeId ? labelFor(place.kind) : 'Nouvelle adresse'}
				</p>
				<h2>{place.placeId ? place.name : name.trim() || 'Sans nom'}</h2>
			</div>
			{#if avg !== null}
				<div class="avg">
					<span class="numeral" style:--c={hero ? '#fff' : colorFor(avg)}>{fmtScore(avg)}</span>
					<span class="avg-sub">{existing.length} avis</span>
				</div>
			{:else}
				<span class="ghost">{iconFor(place.kind)}</span>
			{/if}
		</div>
	</div>

	<div class="body">
		{#if !place.placeId}
			<label class="field">
				<span class="eyebrow">Nom du lieu</span>
				<input type="text" bind:value={name} placeholder="Café de la Gare" />
			</label>
		{/if}

		<div class="field">
			<span class="eyebrow">Propreté</span>
			<div class="chips">
				{#each SCALE as g, i (i)}
					<button
						class="chip glossy"
						class:on={cleanliness === i + 1}
						style:--c={g.color}
						onclick={() => (cleanliness = i + 1)}
						aria-label={g.label}
						aria-pressed={cleanliness === i + 1}
					>
						<span class="numeral">{i + 1}</span>
					</button>
				{/each}
			</div>
			<div class="verdict">
				{#if cleanliness}
					{#key cleanliness}
						<span in:fly={{ y: 8, duration: 260 }}>
							<strong style:color={colorFor(cleanliness)}>{cleanLabel(cleanliness)}</strong>
							<em>{cleanBlurb(cleanliness)}</em>
						</span>
					{/key}
				{:else}
					<span class="pending">De 1 (à fuir) à 5 (la référence)</span>
				{/if}
			</div>
		</div>

		<label class="field">
			<span class="eyebrow">Remarque <i>facultatif</i></span>
			<textarea bind:value={note} rows="2" placeholder="Papier, odeur, code d’accès, accès PMR…"
			></textarea>
		</label>

		<div class="field">
			<span class="eyebrow">Photo <i>facultatif</i></span>
			{#if photoPreview}
				<div class="preview">
					<img src={photoPreview} alt="aperçu" />
					<button class="x" onclick={clearPhoto} aria-label="Retirer la photo">
						<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
							<path d="M6 6l12 12M18 6L6 18" />
						</svg>
					</button>
				</div>
			{:else}
				<label class="drop">
					<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7">
						<path d="M3 8.7A2.5 2.5 0 0 1 5.5 6.2h1.3l.9-1.6a1 1 0 0 1 .87-.5h6.86a1 1 0 0 1 .87.5l.9 1.6h1.3A2.5 2.5 0 0 1 21 8.7v8.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
						<circle cx="12" cy="12.6" r="3.3" />
					</svg>
					Prendre une photo
					<input type="file" accept="image/*" capture="environment" onchange={onPhoto} hidden />
				</label>
			{/if}
		</div>

		<button class="save" onclick={submit} disabled={saving}>
			{#if saving}<span class="spin"></span> Enregistrement…{:else}Publier ma note{/if}
		</button>

		{#if existing.length}
			<div class="reviews">
				<p class="eyebrow">Ce qu’on en dit</p>
				{#each existing as r (r.id)}
					<div class="rev">
						<span
							class="dot numeral"
							style:--c={colorFor(r.cleanliness)}
							aria-label="{r.cleanliness} sur 5">{r.cleanliness}</span
						>
						<div class="rev-body">
							<p class="rev-top">
								<strong>{cleanLabel(r.cleanliness)}</strong>
								<span>{fmtDate(r.created_at)}</span>
							</p>
							{#if r.note}<p class="rev-note">{r.note}</p>{/if}
						</div>
						{#if r.photo_url}<img class="rev-shot" src={r.photo_url} alt="" loading="lazy" />{/if}
						<button class="rev-x" onclick={() => ondelete(r.id)} aria-label="Supprimer cet avis">
							<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
								<path d="M6 6l12 12M18 6L6 18" />
							</svg>
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</section>

<style>
	.scrim {
		position: absolute;
		inset: 0;
		z-index: 30;
		background: rgba(20, 17, 12, 0.42);
		-webkit-backdrop-filter: blur(2px);
		backdrop-filter: blur(2px);
	}
	.sheet {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 31;
		max-height: 90vh;
		overflow-y: auto;
		background: var(--surface);
		border-radius: var(--r-xl) var(--r-xl) 0 0;
		box-shadow: var(--lift-3);
	}
	.grip {
		position: absolute;
		top: 9px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 2;
		width: 38px;
		height: 4px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.6);
		mix-blend-mode: difference;
	}

	/* ── bandeau ───────────────────────────────────────────── */
	.hero {
		position: relative;
		border-radius: var(--r-xl) var(--r-xl) 0 0;
		overflow: hidden;
		background: var(--surface-2);
		background-image: var(--tile);
	}
	.hero img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.hero.shot::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(rgba(16, 14, 10, 0.15) 20%, rgba(16, 14, 10, 0.78));
	}
	.hero-in {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 14px;
		min-height: 108px;
		padding: 30px 22px 18px;
	}
	.hero.shot .hero-in {
		min-height: 148px;
	}
	.who {
		min-width: 0;
	}
	.hero.shot :global(.eyebrow) {
		color: rgba(255, 255, 255, 0.8);
	}
	.hero h2 {
		margin: 5px 0 0;
		font-family: var(--serif);
		font-weight: 600;
		font-size: 26px;
		line-height: 1.08;
		letter-spacing: -0.025em;
		overflow-wrap: anywhere;
	}
	.hero.shot h2 {
		color: #fff;
		text-shadow: 0 1px 12px rgba(0, 0, 0, 0.4);
	}
	.avg {
		flex: none;
		display: grid;
		justify-items: end;
		gap: 2px;
	}
	.avg .numeral {
		font-size: 44px;
		color: var(--c);
	}
	.avg-sub {
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.hero.shot .avg-sub {
		color: rgba(255, 255, 255, 0.78);
	}
	.ghost {
		flex: none;
		font-size: 44px;
		opacity: 0.22;
		line-height: 1;
	}

	/* ── corps ─────────────────────────────────────────────── */
	.body {
		position: relative;
		z-index: 1;
		padding: 22px 22px calc(24px + env(safe-area-inset-bottom, 0px));
	}
	.field {
		display: block;
		margin-bottom: 22px;
	}
	.field > :global(.eyebrow) {
		display: block;
		margin-bottom: 9px;
	}
	.field i {
		font-style: normal;
		letter-spacing: 0.08em;
		color: var(--hairline-strong);
	}

	input[type='text'],
	textarea {
		width: 100%;
		box-sizing: border-box;
		border: 1px solid transparent;
		border-radius: var(--r-md);
		padding: 13px 14px;
		font-size: 15px;
		background: var(--surface-2);
		box-shadow: var(--inset);
		resize: none;
		transition: border-color 0.2s var(--ease), box-shadow 0.2s var(--ease);
	}
	input[type='text']::placeholder,
	textarea::placeholder {
		color: var(--muted);
	}
	input[type='text']:focus,
	textarea:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--glaze) 60%, transparent);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--glaze) 13%, transparent);
	}

	/* pastilles d'émail */
	.chips {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 9px;
	}
	.chip {
		height: 62px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface-2);
		box-shadow: var(--inset);
		color: var(--muted);
		cursor: pointer;
		display: grid;
		place-items: center;
		transition:
			transform 0.32s var(--spring),
			background 0.2s var(--ease),
			color 0.2s var(--ease),
			box-shadow 0.32s var(--ease);
	}
	.chip .numeral {
		font-size: 22px;
	}
	.chip:active {
		transform: scale(0.94);
	}
	.chip.on {
		background: var(--c);
		border-color: color-mix(in srgb, var(--c) 70%, #000);
		color: #fff;
		transform: translateY(-3px) scale(1.04);
		box-shadow:
			0 8px 18px -6px color-mix(in srgb, var(--c) 65%, transparent),
			var(--lift-1);
	}
	.verdict {
		height: 22px;
		margin-top: 11px;
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
	}
	.verdict span {
		display: flex;
		gap: 8px;
		align-items: baseline;
	}
	.verdict strong {
		font-family: var(--serif);
		font-weight: 600;
		font-size: 17px;
		letter-spacing: -0.015em;
	}
	.verdict em {
		font-style: normal;
		font-size: 13px;
		color: var(--muted);
	}
	.verdict .pending {
		font-size: 13px;
		color: var(--muted);
	}

	/* photo */
	.drop {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 9px;
		height: 62px;
		border: 1.5px dashed color-mix(in srgb, var(--glaze) 40%, var(--hairline));
		border-radius: var(--r-md);
		background: color-mix(in srgb, var(--glaze) 6%, transparent);
		color: var(--glaze);
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s;
	}
	.drop:active {
		background: color-mix(in srgb, var(--glaze) 12%, transparent);
	}
	.preview {
		position: relative;
		width: fit-content;
	}
	.preview img {
		display: block;
		max-height: 200px;
		border-radius: var(--r-md);
		border: 1px solid var(--hairline);
	}
	.x {
		position: absolute;
		top: 9px;
		right: 9px;
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: 0;
		border-radius: 50%;
		background: rgba(20, 17, 12, 0.62);
		-webkit-backdrop-filter: blur(6px);
		backdrop-filter: blur(6px);
		color: #fff;
		cursor: pointer;
	}

	.save {
		width: 100%;
		border: 0;
		border-radius: var(--r-md);
		padding: 16px;
		background: var(--glaze);
		color: var(--glaze-ink);
		font-size: 16px;
		font-weight: 600;
		letter-spacing: -0.01em;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 9px;
		box-shadow: 0 10px 24px -10px color-mix(in srgb, var(--glaze) 75%, transparent);
		transition: transform 0.2s var(--spring);
	}
	.save:active {
		transform: scale(0.985);
	}
	.save:disabled {
		opacity: 0.65;
	}

	/* avis */
	.reviews {
		margin-top: 28px;
		padding-top: 18px;
		border-top: 1px solid var(--hairline);
	}
	.reviews > :global(.eyebrow) {
		display: block;
		margin-bottom: 8px;
	}
	.rev {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 13px 0;
		border-bottom: 1px solid var(--hairline);
	}
	.rev:last-child {
		border-bottom: 0;
		padding-bottom: 0;
	}
	.dot {
		flex: none;
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		font-size: 15px;
		color: var(--c);
		background: color-mix(in srgb, var(--c) 13%, transparent);
		border: 1px solid color-mix(in srgb, var(--c) 28%, transparent);
	}
	.rev-body {
		flex: 1;
		min-width: 0;
	}
	.rev-top {
		margin: 3px 0 0;
		display: flex;
		align-items: baseline;
		gap: 9px;
	}
	.rev-top strong {
		font-family: var(--serif);
		font-weight: 600;
		font-size: 15px;
	}
	.rev-top span {
		font-size: 11px;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.rev-note {
		margin: 3px 0 0;
		font-size: 14px;
		color: var(--ink-2);
	}
	.rev-shot {
		flex: none;
		width: 48px;
		height: 48px;
		object-fit: cover;
		border-radius: var(--r-sm);
		border: 1px solid var(--hairline);
	}
	.rev-x {
		flex: none;
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border: 0;
		border-radius: 50%;
		background: none;
		color: var(--hairline-strong);
		cursor: pointer;
	}
	.rev-x:active {
		background: var(--surface-2);
		color: var(--terracotta);
	}

	.spin {
		width: 15px;
		height: 15px;
		border-radius: 50%;
		border: 2px solid rgba(255, 255, 255, 0.35);
		border-top-color: currentColor;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
