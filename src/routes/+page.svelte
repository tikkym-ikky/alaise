<script lang="ts">
	import { onMount } from 'svelte';
	import { fly, fade, scale } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { fetchPois, labelFor, type Poi } from '$lib/overpass';
	import { geocode, type GeoResult } from '$lib/geocode';
	import { ratings, type Place } from '$lib/ratings.svelte';
	import { shrinkImage } from '$lib/image';
	import { supabaseEnabled } from '$lib/supabase';

	let mapEl: HTMLDivElement;
	let maplibregl: typeof import('maplibre-gl');
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let map: any;

	let ready = $state(false);
	let loading = $state(false);
	let saving = $state(false);
	let movedSinceLoad = $state(false);
	let loadedOnce = $state(false);
	let message = $state<string | null>(null);
	let pois = $state<Poi[]>([]);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let poiMarkers: any[] = [];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let ratingMarkers: any[] = [];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let userMarker: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let searchMarker: any = null;

	// search
	let q = $state('');
	let results = $state<GeoResult[]>([]);
	let searching = $state(false);
	let searchOpen = $state(false);
	let searchTimer: ReturnType<typeof setTimeout>;

	// list view
	let view = $state<'map' | 'list'>('map');
	let sortBy = $state<'distance' | 'rating'>('distance');
	let userPos = $state<{ lat: number; lon: number } | null>(null);

	type FormState = {
		placeId: string | null; // set when the spot comes from OSM or an existing rating
		name: string;
		kind: string;
		lat: number;
		lon: number;
		cleanliness: number;
		note: string;
		photoBlob: Blob | null;
		photoPreview: string | null;
	};
	let sheetOpen = $state(false);
	let form = $state<FormState>(blankForm());

	function blankForm(): FormState {
		return {
			placeId: null,
			name: '',
			kind: 'lieu',
			lat: 0,
			lon: 0,
			cleanliness: 0,
			note: '',
			photoBlob: null,
			photoPreview: null
		};
	}

	const existing = $derived(ratings.forPlace(form.placeId));
	const avg = $derived(
		existing.length
			? existing.reduce((s, r) => s + r.cleanliness, 0) / existing.length
			: null
	);

	const SCALE = [
		{ label: 'Insalubre', color: '#e11d48' },
		{ label: 'Sale', color: '#f97316' },
		{ label: 'Passable', color: '#eab308' },
		{ label: 'Propre', color: '#84cc16' },
		{ label: 'Impeccable', color: '#10b981' }
	];
	function colorFor(n: number) {
		return SCALE[Math.min(4, Math.max(0, Math.round(n) - 1))].color;
	}
	function cleanLabel(n: number) {
		return SCALE[Math.min(4, Math.max(0, Math.round(n) - 1))].label;
	}

	function distM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
		const R = 6371000;
		const rad = (d: number) => (d * Math.PI) / 180;
		const dLat = rad(b.lat - a.lat);
		const dLon = rad(b.lon - a.lon);
		const s =
			Math.sin(dLat / 2) ** 2 +
			Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
		return 2 * R * Math.asin(Math.sqrt(s));
	}
	function fmtDist(m: number) {
		return m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
	}

	// reference point for distances: real position, else map centre
	let mapCenter = $state<{ lat: number; lon: number } | null>(null);
	const origin = $derived(userPos ?? mapCenter);

	const ranked = $derived.by(() => {
		const list = ratings.summaries.map((s) => ({
			...s,
			dist: origin ? distM(origin, s) : null
		}));
		list.sort((a, b) => {
			if (sortBy === 'rating') return b.avg - a.avg || (a.dist ?? 0) - (b.dist ?? 0);
			return (a.dist ?? Infinity) - (b.dist ?? Infinity) || b.avg - a.avg;
		});
		return list;
	});

	onMount(() => {
		void init();
		return () => map?.remove();
	});

	async function init() {
		await ratings.init();
		if (ratings.error) message = ratings.error;

		maplibregl = await import('maplibre-gl');
		const dark =
			typeof window !== 'undefined' &&
			window.matchMedia?.('(prefers-color-scheme: dark)').matches;

		map = new maplibregl.Map({
			container: mapEl,
			style: dark
				? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
				: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
			center: [2.3522, 48.8566],
			zoom: 12,
			attributionControl: { compact: true }
		});
		map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

		map.on('load', () => {
			ready = true;
			const c = map.getCenter();
			mapCenter = { lat: c.lat, lon: c.lng };
			locate();
		});
		map.on('moveend', () => {
			const c = map.getCenter();
			mapCenter = { lat: c.lat, lon: c.lng };
			if (loadedOnce) movedSinceLoad = true;
		});
	}

	function locate() {
		if (!navigator.geolocation) {
			toast('Géolocalisation non disponible');
			return;
		}
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				const { latitude, longitude } = pos.coords;
				userPos = { lat: latitude, lon: longitude };
				map.flyTo({ center: [longitude, latitude], zoom: 16, speed: 1.6 });
				userMarker?.remove();
				const el = document.createElement('div');
				el.className = 'me-marker';
				el.innerHTML = '<span class="me-dot"></span><span class="me-pulse"></span>';
				userMarker = new maplibregl.Marker({ element: el })
					.setLngLat([longitude, latitude])
					.addTo(map);
			},
			() => toast('Localisation indisponible ici'),
			{ enableHighAccuracy: true, timeout: 10000 }
		);
	}

	let toastTimer: ReturnType<typeof setTimeout>;
	function toast(m: string) {
		message = m;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (message = null), 3200);
	}

	function onSearchInput() {
		clearTimeout(searchTimer);
		const term = q;
		if (term.trim().length < 3) {
			results = [];
			return;
		}
		searchTimer = setTimeout(async () => {
			searching = true;
			try {
				const c = map?.getCenter();
				results = await geocode(term, c ? { lat: c.lat, lon: c.lng } : undefined);
				searchOpen = true;
			} catch {
				toast('Recherche indisponible');
			}
			searching = false;
		}, 320);
	}

	function clearSearch() {
		q = '';
		results = [];
		searchOpen = false;
		searchMarker?.remove();
		searchMarker = null;
	}

	function pickResult(r: GeoResult) {
		searchOpen = false;
		results = [];
		q = r.label;
		view = 'map';
		searchMarker?.remove();
		map.flyTo({ center: [r.lon, r.lat], zoom: r.isPlace ? 17 : 15.5, speed: 1.6 });

		if (r.isPlace) {
			const el = document.createElement('button');
			el.className = 'poi-marker found';
			el.textContent = iconFor(r.kind);
			el.addEventListener('click', () =>
				openSheet({ placeId: r.id, name: r.label, kind: r.kind, lat: r.lat, lon: r.lon })
			);
			searchMarker = new maplibregl.Marker({ element: el })
				.setLngLat([r.lon, r.lat])
				.addTo(map);
			openSheet({ placeId: r.id, name: r.label, kind: r.kind, lat: r.lat, lon: r.lon });
		} else {
			const el = document.createElement('div');
			el.className = 'search-pin';
			searchMarker = new maplibregl.Marker({ element: el })
				.setLngLat([r.lon, r.lat])
				.addTo(map);
		}
	}

	async function loadArea() {
		loading = true;
		message = null;
		const c = map.getCenter();
		try {
			pois = await fetchPois(c.lat, c.lng, 900);
			renderPoiMarkers();
			if (pois.length === 0) toast('Aucun lieu dans cette zone');
		} catch {
			toast('Chargement des lieux impossible, réessaie');
		}
		await ratings.loadNear(c.lat, c.lng, 1500);
		if (ratings.error) toast(ratings.error);
		renderRatingMarkers();
		loading = false;
		loadedOnce = true;
		movedSinceLoad = false;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function clearMarkers(arr: any[]) {
		for (const m of arr) m.remove();
		arr.length = 0;
	}

	function renderPoiMarkers() {
		clearMarkers(poiMarkers);
		for (const p of pois) {
			const rated = ratings.items.some((r) => r.place_id === p.id);
			if (rated) continue; // a rating pin already covers it
			const el = document.createElement('button');
			el.className = 'poi-marker';
			el.title = p.name;
			el.textContent = iconFor(p.kind);
			el.addEventListener('click', () =>
				openSheet({ placeId: p.id, name: p.name, kind: p.kind, lat: p.lat, lon: p.lon })
			);
			poiMarkers.push(
				new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map)
			);
		}
	}

	function renderRatingMarkers() {
		clearMarkers(ratingMarkers);
		for (const s of ratings.summaries) {
			const el = document.createElement('button');
			el.className = 'rating-marker';
			el.style.setProperty('--c', colorFor(s.avg));
			el.innerHTML = `<span>${s.avg.toFixed(1).replace('.0', '')}</span>`;
			el.addEventListener('click', () =>
				openSheet({ placeId: s.placeId, name: s.name, kind: s.kind, lat: s.lat, lon: s.lon })
			);
			ratingMarkers.push(
				new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(map)
			);
		}
		if (poiMarkers.length) renderPoiMarkers();
	}

	function openFromList(s: { placeId: string; name: string; kind: string; lat: number; lon: number }) {
		view = 'map';
		map.flyTo({ center: [s.lon, s.lat], zoom: 17, speed: 1.8 });
		openSheet(s);
	}

	function openSheet(base: {
		placeId: string | null;
		name: string;
		kind: string;
		lat: number;
		lon: number;
	}) {
		if (form.photoPreview) URL.revokeObjectURL(form.photoPreview);
		form = { ...blankForm(), ...base };
		sheetOpen = true;
	}

	function closeSheet() {
		if (form.photoPreview) URL.revokeObjectURL(form.photoPreview);
		sheetOpen = false;
	}

	function addHere() {
		const c = map.getCenter();
		openSheet({ placeId: null, name: '', kind: 'lieu', lat: c.lat, lon: c.lng });
	}

	async function onPhoto(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		try {
			if (form.photoPreview) URL.revokeObjectURL(form.photoPreview);
			const shrunk = await shrinkImage(file);
			form.photoBlob = shrunk.blob;
			form.photoPreview = shrunk.previewUrl;
		} catch {
			toast('Photo illisible');
		}
	}

	function clearPhoto() {
		if (form.photoPreview) URL.revokeObjectURL(form.photoPreview);
		form.photoBlob = null;
		form.photoPreview = null;
	}

	async function save() {
		if (!supabaseEnabled) return toast('Backend non configuré');
		if (!form.cleanliness) return toast('Choisis une note de propreté');
		saving = true;
		message = null;
		const place: Place = {
			id: form.placeId ?? `manual/${crypto.randomUUID()}`,
			name: form.name.trim() || 'Lieu sans nom',
			kind: form.kind,
			lat: form.lat,
			lon: form.lon
		};
		const ok = await ratings.add({
			place,
			cleanliness: form.cleanliness,
			note: form.note.trim(),
			photo: form.photoBlob
		});
		saving = false;
		if (ok) {
			renderRatingMarkers();
			closeSheet();
			toast('Note enregistrée ✓');
		} else {
			toast(ratings.error ?? 'Échec de l’enregistrement');
		}
	}

	async function deleteRating(id: string) {
		await ratings.remove(id);
		if (ratings.error) toast(ratings.error);
		renderRatingMarkers();
		if (!existing.length) closeSheet();
	}

	function iconFor(kind: string): string {
		const m: Record<string, string> = {
			restaurant: '🍽️',
			cafe: '☕',
			fast_food: '🍔',
			bar: '🍸',
			pub: '🍺',
			fuel: '⛽',
			toilets: '🚻',
			library: '📚',
			cinema: '🎬',
			community_centre: '🏛️',
			station: '🚉',
			mall: '🛍️',
			department_store: '🛍️'
		};
		return m[kind] ?? '📍';
	}

	function fmtDate(ts: string) {
		return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
	}
</script>

<div class="app">
	<div class="map" bind:this={mapEl}></div>

	<header class="topbar" transition:fly={{ y: -20, duration: 300 }}>
		<div class="searchbar" class:active={searchOpen}>
			<span class="s-logo">◍</span>
			<input
				type="search"
				placeholder="Rechercher une rue, un commerce…"
				autocomplete="off"
				bind:value={q}
				oninput={onSearchInput}
				onfocus={() => (searchOpen = true)}
				onblur={() => setTimeout(() => (searchOpen = false), 160)}
			/>
			{#if searching}
				<span class="spinner"></span>
			{:else if q}
				<button class="s-clear" onclick={clearSearch} aria-label="Effacer">✕</button>
			{/if}
		</div>

		{#if searchOpen && results.length}
			<ul class="results" transition:fly={{ y: -8, duration: 160 }}>
				{#each results as r (r.id)}
					<li>
						<button onclick={() => pickResult(r)}>
							<span class="r-ico">{r.isPlace ? iconFor(r.kind) : '🧭'}</span>
							<span class="r-text">
								<strong>{r.label}</strong>
								{#if r.detail}<span>{r.detail}</span>{/if}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</header>

	{#if view === 'map' && ready && (!loadedOnce || movedSinceLoad)}
		<button
			class="rescan"
			onclick={loadArea}
			disabled={loading}
			transition:fly={{ y: -12, duration: 220 }}
		>
			{#if loading}
				<span class="spinner"></span> Chargement…
			{:else}
				<span class="rescan-ico">⟳</span>
				{loadedOnce ? 'Chercher dans cette zone' : 'Charger les lieux ici'}
			{/if}
		</button>
	{/if}

	{#if message}
		<div class="toast" role="status" transition:fly={{ y: 16, duration: 200 }}>{message}</div>
	{/if}

	{#if view === 'map'}
		<div class="fabs">
			<button class="fab ghost" onclick={locate} disabled={!ready} aria-label="Ma position">
				<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="12" cy="12" r="3.5" />
					<path d="M12 2v3M12 19v3M22 12h-3M5 12H2" stroke-linecap="round" />
				</svg>
			</button>
			<button class="fab primary" onclick={addHere} disabled={!ready} aria-label="Noter ce lieu">
				<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
					<path d="M12 5v14M5 12h14" />
				</svg>
			</button>
		</div>

		{#if !loadedOnce && ready}
			<div class="hint" transition:fade>
				Place la carte sur un quartier puis <strong>charge les lieux</strong>, ou touche
				<span class="chip">＋</span> pour noter l’endroit au centre.
			</div>
		{/if}
	{/if}

	{#if ready}
		<div class="switch">
			<button class:on={view === 'map'} onclick={() => (view = 'map')}>Carte</button>
			<button class:on={view === 'list'} onclick={() => (view = 'list')}>
				Classement{#if ratings.summaries.length}<em>{ratings.summaries.length}</em>{/if}
			</button>
		</div>
	{/if}

	{#if view === 'list'}
		<section class="listview" transition:fly={{ y: 24, duration: 240, easing: quintOut }}>
			<div class="list-head">
				<h1>Les plus proches &amp; les mieux notés</h1>
				<div class="sort">
					<button class:on={sortBy === 'distance'} onclick={() => (sortBy = 'distance')}>
						Distance
					</button>
					<button class:on={sortBy === 'rating'} onclick={() => (sortBy = 'rating')}>
						Propreté
					</button>
				</div>
				{#if !userPos}
					<p class="list-note">Distances depuis le centre de la carte (position non disponible)</p>
				{/if}
			</div>

			{#if ranked.length === 0}
				<div class="list-empty">
					Aucun lieu noté pour l’instant.<br />
					Reviens à la carte, charge une zone et ajoute ta première note.
				</div>
			{:else}
				<ol class="list">
					{#each ranked as s, i (s.placeId)}
						<li>
							<button onclick={() => openFromList(s)}>
								<span class="rk">{i + 1}</span>
								<span class="li-ico">{iconFor(s.kind)}</span>
								<span class="li-main">
									<strong>{s.name}</strong>
									<span class="li-sub">
										{#if s.dist !== null}{fmtDist(s.dist)} ·{/if}
										{s.count} avis{#if s.lastNote} · {s.lastNote}{/if}
									</span>
								</span>
								{#if s.photo_url}<img class="li-thumb" src={s.photo_url} alt="" loading="lazy" />{/if}
								<span class="li-score" style:--c={colorFor(s.avg)}>
									{s.avg.toFixed(1).replace('.0', '')}
								</span>
							</button>
						</li>
					{/each}
				</ol>
			{/if}
		</section>
	{/if}

	{#if sheetOpen}
		<div
			class="scrim"
			role="button"
			tabindex="-1"
			onclick={closeSheet}
			onkeydown={(e) => e.key === 'Escape' && closeSheet()}
			transition:fade={{ duration: 180 }}
		></div>
		<section class="sheet" transition:fly={{ y: 400, duration: 320, easing: quintOut }}>
			<div class="grip"></div>

			<div class="sheet-head">
				<div class="sheet-title">
					<span class="sheet-ico">{form.placeId ? iconFor(form.kind) : '📍'}</span>
					<div>
						{#if form.placeId}
							<h2>{form.name}</h2>
							<p>{labelFor(form.kind)}</p>
						{:else}
							<h2>Nouveau lieu</h2>
							<p>Position au centre de la carte</p>
						{/if}
					</div>
				</div>
				{#if avg !== null}
					<span class="avg" style:--c={colorFor(avg)}>
						{avg.toFixed(1).replace('.0', '')}
						<span>{existing.length} avis</span>
					</span>
				{/if}
			</div>

			{#if !form.placeId}
				<label class="field">
					<span>Nom du lieu</span>
					<input type="text" bind:value={form.name} placeholder="ex. Café de la Gare" />
				</label>
			{/if}

			<div class="field">
				<span>Propreté {form.cleanliness ? `· ${cleanLabel(form.cleanliness)}` : ''}</span>
				<div class="scale">
					{#each SCALE as s, i (i)}
						<button
							class="notch"
							class:on={form.cleanliness === i + 1}
							style:--c={s.color}
							onclick={() => (form.cleanliness = i + 1)}
							aria-label={s.label}
						>
							{i + 1}
						</button>
					{/each}
				</div>
			</div>

			<label class="field">
				<span>Remarque <em>facultatif</em></span>
				<textarea bind:value={form.note} rows="2" placeholder="Papier, odeur, code d’accès, PMR…"
				></textarea>
			</label>

			<div class="field">
				<span>Photo <em>facultatif</em></span>
				{#if form.photoPreview}
					<div class="photo-preview">
						<img src={form.photoPreview} alt="aperçu" />
						<button class="photo-x" onclick={clearPhoto} aria-label="Retirer la photo">✕</button>
					</div>
				{:else}
					<label class="dropzone">
						<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8">
							<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.2l1-1.6A1 1 0 0 1 9.5 4h5a1 1 0 0 1 .85.4L16.3 6h2.2A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" />
							<circle cx="12" cy="12.5" r="3.2" />
						</svg>
						Ajouter une photo
						<input type="file" accept="image/*" capture="environment" onchange={onPhoto} hidden />
					</label>
				{/if}
			</div>

			<button class="save" onclick={save} disabled={saving}>
				{#if saving}<span class="spinner light"></span> Enregistrement…{:else}Enregistrer{/if}
			</button>

			{#if existing.length}
				<div class="history">
					<h3>Avis sur ce lieu</h3>
					{#each existing as r (r.id)}
						<div class="rev">
							<span class="rev-score" style:--c={colorFor(r.cleanliness)}>{r.cleanliness}</span>
							<div class="rev-body">
								<div class="rev-meta">
									<strong>{cleanLabel(r.cleanliness)}</strong>
									<span>{fmtDate(r.created_at)}</span>
								</div>
								{#if r.note}<p>{r.note}</p>{/if}
							</div>
							{#if r.photo_url}
								<img class="rev-thumb" src={r.photo_url} alt="" loading="lazy" />
							{/if}
							<button class="rev-del" onclick={() => deleteRating(r.id)} aria-label="Supprimer">
								✕
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	:global(html, body) {
		height: 100%;
		margin: 0;
		overscroll-behavior: none;
	}
	:root {
		--bg: #f7f7f5;
		--surface: #ffffff;
		--text: #16181d;
		--muted: #6b7280;
		--line: #e7e7e4;
		--accent: #0f766e;
		--accent-bright: #14b8a6;
		--shadow: 0 6px 24px -6px rgba(20, 24, 30, 0.18), 0 2px 6px -2px rgba(20, 24, 30, 0.12);
		--radius: 18px;
	}
	@media (prefers-color-scheme: dark) {
		:root {
			--bg: #101214;
			--surface: #1b1e22;
			--text: #f2f3f5;
			--muted: #9aa1ab;
			--line: #2c3037;
			--accent: #2dd4bf;
			--accent-bright: #5eead4;
			--shadow: 0 8px 28px -6px rgba(0, 0, 0, 0.55), 0 2px 8px -2px rgba(0, 0, 0, 0.4);
		}
	}

	.app {
		position: fixed;
		inset: 0;
		color: var(--text);
		font: 15px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif;
		-webkit-tap-highlight-color: transparent;
	}
	.map {
		position: absolute;
		inset: 0;
	}
	.map :global(.maplibregl-ctrl-bottom-right) {
		bottom: 210px;
	}
	.map :global(.maplibregl-ctrl-group) {
		border-radius: 12px;
		overflow: hidden;
		box-shadow: var(--shadow);
	}

	/* top bar / search */
	.topbar {
		position: absolute;
		top: calc(env(safe-area-inset-top, 0px) + 10px);
		left: 12px;
		right: 12px;
		z-index: 7;
	}
	.searchbar {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 0 12px;
		height: 48px;
		background: color-mix(in srgb, var(--surface) 88%, transparent);
		-webkit-backdrop-filter: blur(14px);
		backdrop-filter: blur(14px);
		border: 1px solid color-mix(in srgb, var(--line) 75%, transparent);
		border-radius: 15px;
		box-shadow: var(--shadow);
		transition: border-color 0.15s ease;
	}
	.searchbar.active {
		border-color: var(--accent);
	}
	.s-logo {
		color: var(--accent);
		font-size: 19px;
		line-height: 1;
		flex: none;
	}
	.searchbar input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 15px;
		color: var(--text);
		padding: 0;
	}
	.searchbar input:focus {
		outline: none;
	}
	.searchbar input::-webkit-search-cancel-button {
		display: none;
	}
	.s-clear {
		flex: none;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: 0;
		background: var(--line);
		color: var(--muted);
		font-size: 11px;
		cursor: pointer;
	}
	.results {
		list-style: none;
		margin: 8px 0 0;
		padding: 6px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 15px;
		box-shadow: var(--shadow);
		overflow: hidden;
	}
	.results li + li {
		border-top: 1px solid var(--line);
	}
	.results button {
		display: flex;
		align-items: center;
		gap: 11px;
		width: 100%;
		border: 0;
		background: none;
		padding: 10px 8px;
		text-align: left;
		cursor: pointer;
		border-radius: 10px;
		color: var(--text);
	}
	.results button:active {
		background: var(--bg);
	}
	.r-ico {
		flex: none;
		width: 30px;
		height: 30px;
		border-radius: 9px;
		display: grid;
		place-items: center;
		font-size: 15px;
		background: var(--bg);
		border: 1px solid var(--line);
	}
	.r-text {
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.r-text strong {
		font-size: 14px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.r-text span {
		font-size: 12px;
		color: var(--muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* map / list switch */
	.switch {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		bottom: calc(env(safe-area-inset-bottom, 0px) + 24px);
		z-index: 8;
		display: flex;
		gap: 3px;
		padding: 4px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--surface) 90%, transparent);
		-webkit-backdrop-filter: blur(12px);
		backdrop-filter: blur(12px);
		border: 1px solid var(--line);
		box-shadow: var(--shadow);
	}
	.switch button {
		display: flex;
		align-items: center;
		gap: 6px;
		border: 0;
		background: none;
		padding: 8px 18px;
		border-radius: 999px;
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		color: var(--muted);
		cursor: pointer;
	}
	.switch button.on {
		background: var(--accent);
		color: #fff;
	}
	.switch em {
		font-style: normal;
		font-size: 11px;
		background: color-mix(in srgb, currentColor 22%, transparent);
		border-radius: 999px;
		padding: 1px 6px;
	}

	/* list view */
	.listview {
		position: absolute;
		inset: 0;
		top: calc(env(safe-area-inset-top, 0px) + 68px);
		z-index: 6;
		background: var(--bg);
		border-radius: 20px 20px 0 0;
		box-shadow: var(--shadow);
		overflow-y: auto;
		padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 92px);
	}
	.list-head {
		padding: 20px 18px 12px;
		position: sticky;
		top: 0;
		background: linear-gradient(var(--bg) 78%, transparent);
	}
	.list-head h1 {
		margin: 0 0 12px;
		font-size: 19px;
		font-weight: 800;
		letter-spacing: -0.02em;
	}
	.sort {
		display: inline-flex;
		gap: 3px;
		padding: 3px;
		border-radius: 11px;
		background: var(--surface);
		border: 1px solid var(--line);
	}
	.sort button {
		border: 0;
		background: none;
		padding: 7px 16px;
		border-radius: 9px;
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		color: var(--muted);
		cursor: pointer;
	}
	.sort button.on {
		background: var(--accent);
		color: #fff;
	}
	.list-note {
		margin: 10px 0 0;
		font-size: 12px;
		color: var(--muted);
	}
	.list-empty {
		margin: 40px 24px;
		text-align: center;
		color: var(--muted);
		font-size: 14px;
		line-height: 1.6;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 4px 12px 0;
		counter-reset: none;
	}
	.list li + li {
		margin-top: 8px;
	}
	.list button {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		border: 1px solid var(--line);
		background: var(--surface);
		border-radius: 15px;
		padding: 12px;
		text-align: left;
		cursor: pointer;
		color: var(--text);
	}
	.list button:active {
		transform: scale(0.99);
	}
	.rk {
		flex: none;
		width: 20px;
		text-align: center;
		font-size: 13px;
		font-weight: 800;
		color: var(--muted);
	}
	.li-ico {
		flex: none;
		width: 38px;
		height: 38px;
		border-radius: 11px;
		display: grid;
		place-items: center;
		font-size: 18px;
		background: var(--bg);
		border: 1px solid var(--line);
	}
	.li-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.li-main strong {
		font-size: 14px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.li-sub {
		font-size: 12px;
		color: var(--muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.li-thumb {
		flex: none;
		width: 40px;
		height: 40px;
		object-fit: cover;
		border-radius: 10px;
	}
	.li-score {
		flex: none;
		width: 40px;
		height: 40px;
		border-radius: 12px;
		display: grid;
		place-items: center;
		font-size: 16px;
		font-weight: 800;
		color: #fff;
		background: var(--c);
	}

	/* rescan pill */
	.rescan {
		position: absolute;
		top: calc(env(safe-area-inset-top, 0px) + 66px);
		left: 50%;
		transform: translateX(-50%);
		z-index: 6;
		display: inline-flex;
		align-items: center;
		gap: 7px;
		border: 0;
		padding: 10px 18px;
		border-radius: 999px;
		background: var(--accent);
		color: #fff;
		font: inherit;
		font-weight: 600;
		font-size: 14px;
		box-shadow: 0 8px 20px -6px color-mix(in srgb, var(--accent) 60%, transparent);
		cursor: pointer;
	}
	.rescan:disabled {
		opacity: 0.75;
	}
	.rescan-ico {
		font-size: 16px;
	}

	/* fabs */
	.fabs {
		position: absolute;
		right: 16px;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 86px);
		z-index: 6;
		display: flex;
		flex-direction: column;
		gap: 12px;
		align-items: center;
	}
	.fab {
		display: grid;
		place-items: center;
		border: 0;
		cursor: pointer;
		box-shadow: var(--shadow);
		transition: transform 0.12s ease;
	}
	.fab:active {
		transform: scale(0.92);
	}
	.fab.ghost {
		width: 44px;
		height: 44px;
		border-radius: 14px;
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--line);
	}
	.fab.primary {
		width: 58px;
		height: 58px;
		border-radius: 19px;
		background: var(--accent);
		color: #fff;
		box-shadow: 0 10px 24px -6px color-mix(in srgb, var(--accent) 55%, transparent);
	}
	.fab:disabled {
		opacity: 0.5;
	}

	/* hint */
	.hint {
		position: absolute;
		left: 16px;
		right: 16px;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 156px);
		z-index: 5;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 12px 14px;
		font-size: 13px;
		color: var(--muted);
		box-shadow: var(--shadow);
	}
	.hint strong {
		color: var(--text);
	}
	.chip {
		display: inline-grid;
		place-items: center;
		width: 18px;
		height: 18px;
		border-radius: 6px;
		background: var(--accent);
		color: #fff;
		font-size: 12px;
		vertical-align: -3px;
	}

	/* toast */
	.toast {
		position: absolute;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 96px);
		left: 50%;
		transform: translateX(-50%);
		z-index: 20;
		background: #16181d;
		color: #fff;
		padding: 10px 16px;
		border-radius: 12px;
		font-size: 13px;
		font-weight: 500;
		max-width: 86vw;
		text-align: center;
		box-shadow: var(--shadow);
	}

	/* bottom sheet */
	.scrim {
		position: absolute;
		inset: 0;
		background: rgba(10, 12, 15, 0.4);
		z-index: 30;
	}
	.sheet {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 31;
		background: var(--surface);
		border-radius: 26px 26px 0 0;
		padding: 8px 18px calc(20px + env(safe-area-inset-bottom, 0px));
		max-height: 88vh;
		overflow-y: auto;
		box-shadow: 0 -12px 40px -8px rgba(10, 12, 15, 0.3);
	}
	.grip {
		width: 38px;
		height: 4px;
		border-radius: 999px;
		background: var(--line);
		margin: 6px auto 14px;
	}
	.sheet-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 18px;
	}
	.sheet-title {
		display: flex;
		gap: 12px;
		align-items: center;
		min-width: 0;
	}
	.sheet-ico {
		flex: none;
		width: 44px;
		height: 44px;
		border-radius: 13px;
		display: grid;
		place-items: center;
		font-size: 21px;
		background: var(--bg);
		border: 1px solid var(--line);
	}
	.sheet-head h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 700;
		letter-spacing: -0.02em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sheet-head p {
		margin: 2px 0 0;
		font-size: 13px;
		color: var(--muted);
	}
	.avg {
		flex: none;
		display: grid;
		justify-items: center;
		padding: 6px 12px;
		border-radius: 12px;
		font-size: 20px;
		font-weight: 800;
		line-height: 1;
		color: #fff;
		background: var(--c);
	}
	.avg span {
		font-size: 10px;
		font-weight: 600;
		opacity: 0.9;
		margin-top: 3px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 7px;
		margin-bottom: 16px;
	}
	.field > span {
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
	}
	.field em {
		font-style: normal;
		font-weight: 500;
		color: var(--muted);
	}
	input[type='text'],
	textarea {
		width: 100%;
		box-sizing: border-box;
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 12px;
		font: inherit;
		color: var(--text);
		background: var(--bg);
		resize: none;
	}
	input[type='text']:focus,
	textarea:focus {
		outline: 2px solid color-mix(in srgb, var(--accent) 45%, transparent);
		outline-offset: 0;
		border-color: var(--accent);
	}

	.scale {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 8px;
	}
	.notch {
		height: 52px;
		border: 1px solid var(--line);
		border-radius: 13px;
		background: var(--bg);
		color: var(--muted);
		font-size: 16px;
		font-weight: 700;
		cursor: pointer;
		transition:
			transform 0.1s ease,
			background 0.12s ease,
			color 0.12s ease;
	}
	.notch:active {
		transform: scale(0.94);
	}
	.notch.on {
		background: var(--c);
		border-color: var(--c);
		color: #fff;
		box-shadow: 0 6px 16px -4px color-mix(in srgb, var(--c) 60%, transparent);
	}

	.dropzone {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		height: 56px;
		border: 1.5px dashed color-mix(in srgb, var(--accent) 45%, var(--line));
		border-radius: 13px;
		color: var(--accent);
		font-weight: 600;
		font-size: 14px;
		cursor: pointer;
		background: color-mix(in srgb, var(--accent) 6%, transparent);
	}
	.photo-preview {
		position: relative;
		width: fit-content;
	}
	.photo-preview img {
		max-height: 180px;
		border-radius: 13px;
		display: block;
	}
	.photo-x {
		position: absolute;
		top: 8px;
		right: 8px;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 0;
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		font-size: 13px;
		cursor: pointer;
	}

	.save {
		width: 100%;
		border: 0;
		background: var(--accent);
		color: #fff;
		padding: 15px;
		border-radius: 14px;
		font: inherit;
		font-size: 16px;
		font-weight: 700;
		cursor: pointer;
		margin-top: 2px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		box-shadow: 0 10px 22px -8px color-mix(in srgb, var(--accent) 55%, transparent);
	}
	.save:disabled {
		opacity: 0.7;
	}

	.history {
		margin-top: 22px;
		border-top: 1px solid var(--line);
		padding-top: 16px;
	}
	.history h3 {
		margin: 0 0 12px;
		font-size: 13px;
		font-weight: 700;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.rev {
		display: flex;
		align-items: flex-start;
		gap: 11px;
		padding: 11px 0;
		border-bottom: 1px solid var(--line);
	}
	.rev:last-child {
		border-bottom: 0;
	}
	.rev-score {
		flex: none;
		width: 30px;
		height: 30px;
		border-radius: 9px;
		display: grid;
		place-items: center;
		font-size: 14px;
		font-weight: 800;
		color: #fff;
		background: var(--c);
	}
	.rev-body {
		flex: 1;
		min-width: 0;
	}
	.rev-meta {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.rev-meta strong {
		font-size: 14px;
	}
	.rev-meta span {
		font-size: 12px;
		color: var(--muted);
	}
	.rev-body p {
		margin: 3px 0 0;
		font-size: 14px;
		color: var(--text);
	}
	.rev-thumb {
		flex: none;
		width: 46px;
		height: 46px;
		object-fit: cover;
		border-radius: 10px;
	}
	.rev-del {
		flex: none;
		border: 0;
		background: none;
		color: var(--muted);
		font-size: 13px;
		cursor: pointer;
		padding: 4px;
	}

	/* spinner */
	.spinner {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 2px solid color-mix(in srgb, var(--accent) 30%, transparent);
		border-top-color: var(--accent);
		animation: spin 0.7s linear infinite;
		display: inline-block;
	}
	.spinner.light {
		border-color: rgba(255, 255, 255, 0.4);
		border-top-color: #fff;
	}
	.rescan .spinner {
		border-color: rgba(255, 255, 255, 0.45);
		border-top-color: #fff;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* markers */
	:global(.me-marker) {
		position: relative;
		width: 18px;
		height: 18px;
	}
	:global(.me-dot) {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: #2563eb;
		border: 3px solid #fff;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	}
	:global(.me-pulse) {
		position: absolute;
		inset: -6px;
		border-radius: 50%;
		background: #2563eb;
		opacity: 0.25;
		animation: pulse 2s ease-out infinite;
	}
	@keyframes pulse {
		0% {
			transform: scale(0.6);
			opacity: 0.35;
		}
		100% {
			transform: scale(1.8);
			opacity: 0;
		}
	}
	:global(.poi-marker) {
		width: 30px;
		height: 30px;
		border-radius: 50% 50% 50% 4px;
		border: 2px solid #fff;
		background: #fff;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
		font-size: 15px;
		cursor: pointer;
		display: grid;
		place-items: center;
		padding: 0;
		transition: transform 0.12s ease;
	}
	:global(.poi-marker:hover) {
		transform: scale(1.12);
	}
	:global(.poi-marker.found) {
		border-color: var(--accent-bright, #14b8a6);
		box-shadow:
			0 0 0 3px color-mix(in srgb, #14b8a6 40%, transparent),
			0 2px 8px rgba(0, 0, 0, 0.28);
	}
	:global(.search-pin) {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: #14b8a6;
		border: 3px solid #fff;
		box-shadow:
			0 0 0 4px color-mix(in srgb, #14b8a6 30%, transparent),
			0 2px 6px rgba(0, 0, 0, 0.3);
	}
	:global(.rating-marker) {
		border: 0;
		background: none;
		padding: 0;
		cursor: pointer;
		filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.35));
		transition: transform 0.12s ease;
	}
	:global(.rating-marker:hover) {
		transform: scale(1.1);
	}
	:global(.rating-marker span) {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: 50% 50% 50% 4px;
		background: var(--c);
		border: 2.5px solid #fff;
		color: #fff;
		font-size: 14px;
		font-weight: 800;
	}
</style>
