<script lang="ts">
	import { onMount } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import 'maplibre-gl/dist/maplibre-gl.css';
	// MapLibre v6 calcule l'URL de son worker au runtime (pas un `new URL()` littéral),
	// donc le bundler ne l'émet pas et le fichier est 404 en prod → carte noire.
	// On laisse Vite empaqueter le worker et on pointe MapLibre dessus explicitement.
	import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

	import SearchBar from '$lib/components/SearchBar.svelte';
	import RankList from '$lib/components/RankList.svelte';
	import RatingSheet from '$lib/components/RatingSheet.svelte';

	import { fetchPois, type Poi } from '$lib/overpass';
	import type { GeoResult } from '$lib/geocode';
	import { ratings, type Place, type Ranked } from '$lib/ratings.svelte';
	import { supabaseEnabled } from '$lib/supabase';
	import { theme } from '$lib/theme.svelte';
	import { net } from '$lib/net.svelte';
	import { colorFor, distM, fmtScore, iconFor } from '$lib/ui';

	// Rayon de requête Overpass, borné : au-delà c'est lent et trop dense.
	const QUERY_MIN = 450;
	const QUERY_MAX = 2000;
	// Si le demi-écran dépasse ça, on ne recharge pas tout seul (zoom trop large).
	const TOO_WIDE = 2800;

	const MAP_STYLE = {
		light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
		dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
	};

	type Target = { placeId: string | null; name: string; kind: string; lat: number; lon: number };

	let mapEl: HTMLDivElement;
	let maplibregl: typeof import('maplibre-gl');
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let map: any;

	let ready = $state(false);
	let loading = $state(false);
	let saving = $state(false);
	let loadedOnce = $state(false);
	let tooWide = $state(false);
	let message = $state<string | null>(null);
	let pois = $state<Poi[]>([]);

	let view = $state<'map' | 'list'>('map');
	let sortBy = $state<'distance' | 'rating'>('distance');
	let userPos = $state<{ lat: number; lon: number } | null>(null);
	let mapCenter = $state<{ lat: number; lon: number } | null>(null);

	let target = $state<Target | null>(null);
	let sheetSeq = $state(0);
	let sheet = $state<{ dismiss: () => void } | null>(null);

	// mode « pose le repère » (avant d'ouvrir la fiche pour un lieu ajouté à la main)
	let placing = $state(false);

	// centre + rayon de la dernière charge réussie, pour décider quand rafraîchir
	let lastLoad: { lat: number; lon: number; r: number } | null = null;
	let autoTimer: ReturnType<typeof setTimeout>;
	let firstLoadTimer: ReturnType<typeof setTimeout>;

	// Marqueurs indexés par clé, réutilisés d'une charge à l'autre pour éviter
	// que tout clignote quand la zone se rafraîchit toute seule.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let ratingPins = new Map<string, any>();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let poiPins = new Map<string, any>();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let userMarker: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let searchMarker: any = null;

	const origin = $derived(userPos ?? mapCenter);
	const existing = $derived(ratings.forPlace(target?.placeId ?? null));

	const ranked = $derived.by<Ranked[]>(() => {
		const list = ratings.summaries.map((s) => ({
			...s,
			dist: origin ? distM(origin, s) : null
		}));
		list.sort((a, b) =>
			sortBy === 'rating'
				? b.avg - a.avg || (a.dist ?? 0) - (b.dist ?? 0)
				: (a.dist ?? Infinity) - (b.dist ?? Infinity) || b.avg - a.avg
		);
		return list;
	});

	// ── carte ──────────────────────────────────────────────────
	onMount(() => {
		void init();
		return () => {
			clearTimeout(firstLoadTimer);
			clearTimeout(autoTimer);
			map?.remove();
		};
	});

	async function init() {
		theme.init();
		net.init();
		await ratings.init();
		if (ratings.error) toast(ratings.error);

		maplibregl = await import('maplibre-gl');
		maplibregl.setWorkerUrl(maplibreWorkerUrl);
		appliedDark = theme.isDark;

		map = new maplibregl.Map({
			container: mapEl,
			style: appliedDark ? MAP_STYLE.dark : MAP_STYLE.light,
			center: [2.3522, 48.8566],
			zoom: 12,
			attributionControl: { compact: true }
		});

		map.on('load', () => {
			ready = true;
			syncCenter();
			locate();
			// La zone se charge toute seule au démarrage (plus besoin de « Explorer
			// cette zone »). Filet de sécurité si la géoloc ne répond jamais.
			firstLoadTimer = setTimeout(firstLoad, 4500);
		});
		map.on('moveend', () => {
			syncCenter();
			if (loadedOnce) scheduleAutoLoad();
		});
	}

	function syncCenter() {
		const c = map.getCenter();
		mapCenter = { lat: c.lat, lon: c.lng };
	}

	/** Rayon en mètres du centre jusqu'au coin de l'écran. */
	function viewportRadius(): number {
		const b = map.getBounds();
		const c = b.getCenter();
		const ne = b.getNorthEast();
		return distM({ lat: c.lat, lon: c.lng }, { lat: ne.lat, lon: ne.lng });
	}

	/** Après un déplacement : recharge la zone si on a assez bougé/zoomé. */
	function scheduleAutoLoad() {
		clearTimeout(autoTimer);
		autoTimer = setTimeout(() => {
			if (loading || placing || !map) return;

			const r = viewportRadius();
			tooWide = r > TOO_WIDE;
			if (tooWide || !net.online) return;

			if (!lastLoad) return void loadArea();
			const moved = distM(mapCenter!, lastLoad);
			const zoomShift = Math.abs(r - lastLoad.r) / lastLoad.r;
			if (moved > Math.max(220, lastLoad.r * 0.4) || zoomShift > 0.45) {
				void loadArea();
			}
		}, 800);
	}

	// Le fond de carte suit le thème. Les marqueurs sont des éléments DOM,
	// ils survivent au changement de style.
	let appliedDark = false;
	$effect(() => {
		const wanted = theme.isDark;
		if (!map || wanted === appliedDark) return;
		appliedDark = wanted;
		map.setStyle(wanted ? MAP_STYLE.dark : MAP_STYLE.light);
	});

	/** Premier chargement de zone, automatique et une seule fois. */
	function firstLoad() {
		clearTimeout(firstLoadTimer);
		if (loadedOnce || loading || placing || !map) return;
		void loadArea();
	}

	function locate() {
		if (!navigator.geolocation) return firstLoad();
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				const { latitude, longitude } = pos.coords;
				userPos = { lat: latitude, lon: longitude };
				map.flyTo({ center: [longitude, latitude], zoom: 16, speed: 1.6 });
				userMarker?.remove();
				const el = document.createElement('div');
				el.className = 'me';
				el.innerHTML = '<i></i><b></b>';
				userMarker = new maplibregl.Marker({ element: el })
					.setLngLat([longitude, latitude])
					.addTo(map);
				// on charge la zone une fois arrivé sur la position
				if (!loadedOnce) map.once('moveend', firstLoad);
			},
			() => {
				toast('Position indisponible ici');
				firstLoad();
			},
			{ enableHighAccuracy: true, timeout: 10000 }
		);
	}

	// ── mode « pose le repère » ────────────────────────────────
	function startPlacing() {
		placing = true;
	}
	function cancelPlacing() {
		placing = false;
	}
	function confirmPlacing() {
		const c = map.getCenter();
		placing = false;
		openSheet({ placeId: null, name: '', kind: 'lieu', lat: c.lat, lon: c.lng });
	}

	let toastTimer: ReturnType<typeof setTimeout>;
	function toast(m: string) {
		message = m;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (message = null), 3400);
	}

	async function loadArea() {
		if (!net.online) return toast('Hors ligne — zone impossible à charger');
		clearTimeout(autoTimer);
		loading = true;
		tooWide = false;

		const c = map.getCenter();
		const r = Math.min(QUERY_MAX, Math.max(QUERY_MIN, Math.round(viewportRadius())));
		const auto = loadedOnce; // premier chargement = message si vide, sinon silencieux

		try {
			pois = await fetchPois(c.lat, c.lng, r);
			if (pois.length === 0 && !auto) toast('Aucun lieu répertorié dans cette zone');
		} catch {
			if (!auto) toast('Chargement des lieux impossible, réessaie');
		}
		await ratings.loadNear(c.lat, c.lng, Math.round(r * 1.6));
		if (ratings.error && !auto) toast(ratings.error);

		renderMarkers();
		lastLoad = { lat: c.lat, lon: c.lng, r: viewportRadius() };
		loading = false;
		loadedOnce = true;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function reconcile(store: Map<string, any>, wanted: Map<string, () => unknown>) {
		for (const [key, make] of wanted) {
			if (!store.has(key)) store.set(key, make());
		}
		for (const [key, marker] of store) {
			if (!wanted.has(key)) {
				marker.remove();
				store.delete(key);
			}
		}
	}

	function renderMarkers() {
		const rated = new Set(ratings.summaries.map((s) => s.placeId));

		const wantRatings = new Map<string, () => unknown>();
		for (const s of ratings.summaries) {
			// la clé inclut la note et le nom : si l'un change, le marqueur est recréé
			wantRatings.set(`${s.placeId}|${s.avg.toFixed(2)}|${s.name}`, () => {
				const el = document.createElement('button');
				el.className = 'pin';
				el.style.setProperty('--c', colorFor(s.avg));
				el.title = s.name;
				el.innerHTML = `<b>${fmtScore(s.avg)}</b>`;
				el.addEventListener('click', () =>
					openSheet({ placeId: s.placeId, name: s.name, kind: s.kind, lat: s.lat, lon: s.lon })
				);
				return new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(map);
			});
		}
		reconcile(ratingPins, wantRatings);

		const wantPois = new Map<string, () => unknown>();
		for (const p of pois) {
			if (rated.has(p.id)) continue;
			wantPois.set(p.id, () => {
				const el = document.createElement('button');
				el.className = 'spot';
				el.title = p.name;
				el.textContent = iconFor(p.kind);
				el.addEventListener('click', () =>
					openSheet({ placeId: p.id, name: p.name, kind: p.kind, lat: p.lat, lon: p.lon })
				);
				return new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map);
			});
		}
		reconcile(poiPins, wantPois);
	}

	// ── recherche ──────────────────────────────────────────────
	function onPick(r: GeoResult) {
		view = 'map';
		searchMarker?.remove();
		map.flyTo({ center: [r.lon, r.lat], zoom: r.isPlace ? 17 : 15.5, speed: 1.7 });

		const el = document.createElement('button');
		if (r.isPlace) {
			el.className = 'spot found';
			el.textContent = iconFor(r.kind);
			el.addEventListener('click', () =>
				openSheet({ placeId: r.id, name: r.label, kind: r.kind, lat: r.lat, lon: r.lon })
			);
			openSheet({ placeId: r.id, name: r.label, kind: r.kind, lat: r.lat, lon: r.lon });
		} else {
			el.className = 'drop-mark';
		}
		searchMarker = new maplibregl.Marker({ element: el }).setLngLat([r.lon, r.lat]).addTo(map);
	}

	// ── fiche ──────────────────────────────────────────────────
	function openSheet(t: Target) {
		target = t;
		sheetSeq += 1;
	}

	function openFromList(s: Ranked) {
		view = 'map';
		map.flyTo({ center: [s.lon, s.lat], zoom: 17, speed: 1.8 });
		openSheet({ placeId: s.placeId, name: s.name, kind: s.kind, lat: s.lat, lon: s.lon });
	}

	async function saveRating(v: {
		name: string;
		cleanliness: number;
		note: string;
		photo: Blob | null;
	}) {
		if (!target) return;
		if (!supabaseEnabled) return toast('Backend non configuré');

		saving = true;
		const place: Place = {
			id: target.placeId ?? `manual/${crypto.randomUUID()}`,
			name: (target.placeId ? target.name : v.name).trim() || 'Lieu sans nom',
			kind: target.kind,
			lat: target.lat,
			lon: target.lon
		};
		const ok = await ratings.add({
			place,
			cleanliness: v.cleanliness,
			note: v.note.trim(),
			photo: v.photo
		});
		saving = false;

		if (ok) {
			renderMarkers();
			sheet?.dismiss();
			toast('Merci — ta note est publiée');
		} else {
			toast(ratings.error ?? 'Échec de l’enregistrement');
		}
	}

	async function deleteRating(id: string) {
		await ratings.remove(id);
		if (ratings.error) toast(ratings.error);
		renderMarkers();
		if (!existing.length) sheet?.dismiss();
	}
</script>

<div class="app">
	<div class="map" class:night={theme.isDark} bind:this={mapEl}></div>

	<div class="top" class:hidden={placing}>
		<SearchBar center={mapCenter} onpick={onPick} onfail={toast} />
		{#if !net.online}
			<p class="wire offline" transition:fly={{ y: -8, duration: 200 }}>
				Hors ligne — carte et notes en cache
			</p>
		{:else if view === 'map' && loadedOnce && tooWide}
			<p class="wire" transition:fly={{ y: -8, duration: 200 }}>Zoome pour explorer une zone</p>
		{:else if view === 'map' && loadedOnce && loading}
			<p class="wire loading" transition:fly={{ y: -8, duration: 200 }}>
				<span class="spinner"></span> Mise à jour de la zone…
			</p>
		{/if}
	</div>

	{#if view === 'map' && ready && !loadedOnce && !placing}
		<button class="rescan" onclick={loadArea} disabled={loading} transition:fly={{ y: -14, duration: 260 }}>
			<svg class:spinning={loading} viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
				<path d="M20 11a8 8 0 1 0-2.3 5.7" />
				<path d="M20 5.5V11h-5.5" />
			</svg>
			{loading ? 'Exploration…' : 'Explorer cette zone'}
		</button>
	{/if}

	{#if placing}
		<!-- le repère reste au centre de l'écran, on déplace la carte dessous -->
		<div class="crosshair" aria-hidden="true">
			<span class="ch-pin"></span>
			<span class="ch-stem"></span>
			<span class="ch-shadow"></span>
		</div>
		<div class="place-bar" transition:fly={{ y: 24, duration: 260 }}>
			<p>Amène le repère sur l’entrée des toilettes</p>
			<div class="place-actions">
				<button class="ghost-btn" onclick={cancelPlacing}>Annuler</button>
				<button class="glaze-btn" onclick={confirmPlacing}>Poser ici</button>
			</div>
		</div>
	{/if}

	{#if view === 'map' && !placing}
		<div class="fabs">
			<button class="fab ghost" onclick={locate} disabled={!ready} aria-label="Ma position">
				<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9">
					<circle cx="12" cy="12" r="3.4" />
					<circle cx="12" cy="12" r="8" opacity=".45" />
					<path d="M12 1.6v3M12 19.4v3M22.4 12h-3M4.6 12h-3" stroke-linecap="round" />
				</svg>
			</button>
			<button class="fab primary" onclick={startPlacing} disabled={!ready} aria-label="Noter un endroit">
				<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
					<path d="M12 5.5v13M5.5 12h13" />
				</svg>
			</button>
		</div>

		{#if !loadedOnce && ready}
			<p class="hint" transition:fade>
				Cadre un quartier, puis <strong>explore la zone</strong> — ou pose une note avec ＋.
			</p>
		{/if}
	{/if}

	{#if ready && !placing}
		<nav class="switch">
			<span class="thumb" class:right={view === 'list'}></span>
			<button class:on={view === 'map'} onclick={() => (view = 'map')}>Carte</button>
			<button class:on={view === 'list'} onclick={() => (view = 'list')}>
				Classement
				{#if ranked.length}<em>{ranked.length}</em>{/if}
			</button>
		</nav>
	{/if}

	{#if view === 'list'}
		<RankList items={ranked} bind:sortBy hasUserPos={!!userPos} onopen={openFromList} />
	{/if}

	{#if target}
		{#key sheetSeq}
			<RatingSheet
				bind:this={sheet}
				place={target}
				{existing}
				{saving}
				onsave={saveRating}
				onclose={() => (target = null)}
				ondelete={deleteRating}
				onfail={toast}
			/>
		{/key}
	{/if}

	{#if message}
		<output class="toast" transition:fly={{ y: 18, duration: 240 }}>{message}</output>
	{/if}
</div>

<style>
	.app {
		position: fixed;
		inset: 0;
		background: var(--paper);
	}
	.map {
		position: absolute;
		inset: 0;
	}
	/* on réchauffe le fond de carte pour qu'il tienne avec la palette porcelaine */
	.map :global(.maplibregl-canvas) {
		filter: sepia(0.16) saturate(0.84) brightness(1.02);
	}
	.map.night :global(.maplibregl-canvas) {
		filter: saturate(0.78) brightness(0.94);
	}
	/* attribution en bas à gauche : le coin droit est pris par les boutons flottants */
	.map :global(.maplibregl-ctrl-bottom-right) {
		right: auto;
		left: 0;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 6px);
	}
	.map :global(.maplibregl-ctrl-attrib) {
		background: color-mix(in srgb, var(--surface) 70%, transparent);
		border-radius: 0 999px 999px 0;
		font-family: var(--sans);
		font-size: 10px;
	}
	.map :global(.maplibregl-ctrl-attrib a) {
		color: var(--muted);
	}

	.top {
		position: absolute;
		top: calc(env(safe-area-inset-top, 0px) + 12px);
		left: 14px;
		right: 14px;
		z-index: 10;
		transition: opacity 0.2s var(--ease), transform 0.2s var(--ease);
	}
	.top.hidden {
		opacity: 0;
		transform: translateY(-12px);
		pointer-events: none;
	}

	/* bandeau d'état sous la recherche (hors-ligne, mise à jour, zoom) */
	.wire {
		margin: 8px auto 0;
		width: fit-content;
		max-width: 100%;
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 7px 14px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--surface) 92%, transparent);
		-webkit-backdrop-filter: blur(12px);
		backdrop-filter: blur(12px);
		border: 1px solid var(--hairline);
		box-shadow: var(--lift-1);
		font-size: 12px;
		font-weight: 600;
		color: var(--muted);
	}
	.wire.offline {
		color: var(--terracotta);
		border-color: color-mix(in srgb, var(--terracotta) 40%, var(--hairline));
	}
	.wire .spinner {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid color-mix(in srgb, var(--glaze) 25%, transparent);
		border-top-color: var(--glaze);
		animation: spin 0.7s linear infinite;
	}

	/* ── pastille « explorer » ─────────────────────────────── */
	.rescan {
		position: absolute;
		top: calc(env(safe-area-inset-top, 0px) + 78px);
		left: 50%;
		transform: translateX(-50%);
		z-index: 6;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		border: 0;
		padding: 11px 20px;
		border-radius: 999px;
		background: var(--glaze);
		color: var(--glaze-ink);
		font-size: 13.5px;
		font-weight: 600;
		letter-spacing: -0.01em;
		white-space: nowrap;
		cursor: pointer;
		box-shadow: 0 10px 26px -10px color-mix(in srgb, var(--glaze) 85%, transparent), var(--lift-1);
	}
	.rescan:disabled {
		opacity: 0.8;
	}
	.spinning {
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ── boutons flottants ─────────────────────────────────── */
	.fabs {
		position: absolute;
		right: 16px;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 92px);
		z-index: 6;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
	}
	.fab {
		display: grid;
		place-items: center;
		border: 0;
		cursor: pointer;
		transition: transform 0.3s var(--spring);
	}
	.fab:active {
		transform: scale(0.9);
	}
	.fab.ghost {
		width: 46px;
		height: 46px;
		border-radius: 15px;
		background: color-mix(in srgb, var(--surface) 92%, transparent);
		-webkit-backdrop-filter: blur(14px);
		backdrop-filter: blur(14px);
		border: 1px solid var(--hairline);
		color: var(--ink-2);
		box-shadow: var(--lift-1);
	}
	.fab.primary {
		width: 60px;
		height: 60px;
		border-radius: 21px;
		background: var(--glaze);
		color: var(--glaze-ink);
		box-shadow: 0 12px 28px -10px color-mix(in srgb, var(--glaze) 85%, transparent), var(--lift-1);
	}
	.fab:disabled {
		opacity: 0.45;
	}

	.hint {
		position: absolute;
		left: 18px;
		right: 18px;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 168px);
		z-index: 5;
		margin: 0;
		padding: 13px 16px;
		border-radius: var(--r-md);
		background: color-mix(in srgb, var(--surface) 90%, transparent);
		-webkit-backdrop-filter: blur(14px);
		backdrop-filter: blur(14px);
		border: 1px solid var(--hairline);
		box-shadow: var(--lift-1);
		font-size: 13px;
		line-height: 1.5;
		color: var(--muted);
	}
	.hint strong {
		color: var(--ink);
		font-weight: 600;
	}

	/* ── mode « pose le repère » ───────────────────────────── */
	.crosshair {
		position: absolute;
		left: 50%;
		top: 50%;
		z-index: 7;
		pointer-events: none;
		transform: translate(-50%, -100%);
		animation: drop 0.32s var(--spring);
	}
	@keyframes drop {
		from {
			transform: translate(-50%, -160%);
			opacity: 0;
		}
	}
	.ch-pin {
		display: block;
		width: 26px;
		height: 26px;
		border-radius: 50% 50% 50% 4px;
		background: var(--glaze);
		border: 3px solid var(--surface);
		box-shadow: var(--lift-2);
		transform: rotate(45deg);
	}
	.ch-pin::after {
		content: '';
		position: absolute;
		inset: 7px;
		border-radius: 50%;
		background: var(--surface);
	}
	.ch-stem {
		position: absolute;
		left: 50%;
		top: 100%;
		width: 2px;
		height: 14px;
		margin-left: -1px;
		background: color-mix(in srgb, var(--ink) 45%, transparent);
	}
	.ch-shadow {
		position: absolute;
		left: 50%;
		top: calc(100% + 14px);
		width: 12px;
		height: 4px;
		margin-left: -6px;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.25);
		filter: blur(1px);
	}

	.place-bar {
		position: absolute;
		left: 14px;
		right: 14px;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 20px);
		z-index: 9;
		padding: 16px;
		border-radius: var(--r-lg);
		background: var(--surface);
		border: 1px solid var(--hairline);
		box-shadow: var(--lift-2);
	}
	.place-bar p {
		margin: 0 0 12px;
		text-align: center;
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.place-actions {
		display: grid;
		grid-template-columns: 1fr 1.6fr;
		gap: 9px;
	}
	.ghost-btn,
	.glaze-btn {
		border: 0;
		border-radius: var(--r-md);
		padding: 13px;
		font: inherit;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
	}
	.ghost-btn {
		background: var(--surface-2);
		color: var(--ink-2);
	}
	.glaze-btn {
		background: var(--glaze);
		color: var(--glaze-ink);
		box-shadow: 0 8px 20px -8px color-mix(in srgb, var(--glaze) 70%, transparent);
	}
	.ghost-btn:active,
	.glaze-btn:active {
		transform: scale(0.97);
	}

	/* ── bascule carte / classement ────────────────────────── */
	.switch {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		bottom: calc(env(safe-area-inset-bottom, 0px) + 22px);
		z-index: 9;
		display: flex;
		padding: 4px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--surface) 92%, transparent);
		-webkit-backdrop-filter: blur(18px) saturate(1.4);
		backdrop-filter: blur(18px) saturate(1.4);
		border: 1px solid var(--hairline);
		box-shadow: var(--lift-2);
	}
	.switch .thumb {
		position: absolute;
		top: 4px;
		left: 4px;
		width: calc(50% - 4px);
		height: calc(100% - 8px);
		border-radius: 999px;
		background: var(--glaze);
		box-shadow: var(--lift-1);
		transition: transform 0.44s var(--spring);
	}
	.switch .thumb.right {
		transform: translateX(100%);
	}
	.switch button {
		position: relative;
		z-index: 1;
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		border: 0;
		background: none;
		padding: 9px 20px;
		border-radius: 999px;
		font-size: 13.5px;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--muted);
		white-space: nowrap;
		cursor: pointer;
		transition: color 0.28s var(--ease);
	}
	.switch button.on {
		color: var(--glaze-ink);
	}
	.switch em {
		font-style: normal;
		font-family: var(--serif);
		font-weight: 600;
		font-size: 11.5px;
		padding: 1px 7px;
		border-radius: 999px;
		background: color-mix(in srgb, currentColor 20%, transparent);
	}

	/* ── toast ─────────────────────────────────────────────── */
	.toast {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		bottom: calc(env(safe-area-inset-bottom, 0px) + 84px);
		z-index: 40;
		max-width: 86vw;
		padding: 11px 18px;
		border-radius: 999px;
		background: var(--ink);
		color: var(--paper);
		font-size: 13px;
		font-weight: 500;
		text-align: center;
		box-shadow: var(--lift-2);
	}

	/* ── marqueurs ─────────────────────────────────────────── */
	:global(.pin) {
		position: relative;
		width: 40px;
		height: 40px;
		padding: 0;
		border: 2.5px solid var(--surface);
		border-radius: 15px 15px 15px 5px;
		background: var(--c);
		cursor: pointer;
		overflow: hidden;
		box-shadow: var(--lift-2);
		animation: pop 0.42s var(--spring) both;
		transition: transform 0.25s var(--spring);
	}
	:global(.pin::before) {
		content: '';
		position: absolute;
		inset: 0 0 auto;
		height: 55%;
		background: linear-gradient(rgba(255, 255, 255, 0.34), rgba(255, 255, 255, 0));
	}
	:global(.pin b) {
		position: relative;
		font-family: var(--serif);
		font-weight: 700;
		font-size: 16px;
		font-variant-numeric: tabular-nums;
		color: #fff;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
	}
	:global(.pin:hover) {
		transform: scale(1.1);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: scale(0.4) translateY(6px);
		}
	}

	:global(.spot) {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 1px solid var(--hairline);
		border-radius: 50%;
		background: var(--surface);
		font-size: 15px;
		cursor: pointer;
		box-shadow: var(--lift-1);
		transition: transform 0.25s var(--spring);
	}
	:global(.spot:hover) {
		transform: scale(1.14);
	}
	:global(.spot.found) {
		border-color: var(--glaze);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--glaze) 22%, transparent), var(--lift-1);
	}

	:global(.drop-mark) {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--glaze);
		border: 3px solid var(--surface);
		box-shadow: 0 0 0 5px color-mix(in srgb, var(--glaze) 20%, transparent);
	}

	:global(.me) {
		position: relative;
		width: 18px;
		height: 18px;
	}
	:global(.me i) {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: var(--glaze);
		border: 3px solid var(--surface);
		box-shadow: var(--lift-1);
	}
	:global(.me b) {
		position: absolute;
		inset: -7px;
		border-radius: 50%;
		background: var(--glaze);
		opacity: 0.22;
		animation: halo 2.4s var(--ease) infinite;
	}
	@keyframes halo {
		0% {
			transform: scale(0.55);
			opacity: 0.32;
		}
		100% {
			transform: scale(1.9);
			opacity: 0;
		}
	}
</style>
