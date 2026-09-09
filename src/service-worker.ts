/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const SHELL = `alaise-shell-${version}`;
// v2 : purge les entrées de l'ancien cache (certaines pouvaient laisser la carte grise).
const RUNTIME = 'alaise-runtime-v2';
const RUNTIME_MAX = 320; // tuiles + polices + photos gardées hors-ligne
const SHELL_URL = '/'; // coquille HTML, mise en cache à la première visite

/** Ressources de l'app (noms hashés → sûres à mettre en cache fort). */
const PRECACHE = new Set([...build, ...files]);

/**
 * Fond de carte + polices : on en garde une copie pour l'usage hors-ligne, mais
 * en « réseau d'abord » — en ligne on sert toujours la version fraîche, jamais
 * une entrée de cache qui aurait mal tourné (ce qui laissait la carte grise).
 * `fonts.googleapis.com` (la feuille CSS) n'est PAS interceptée : la requête d'un
 * <link> distant est `no-cors`, la réponse opaque servie par le SW casse la
 * feuille. On laisse le navigateur la charger, et on ne met en cache que les
 * fichiers de police (fonts.gstatic.com, requête CORS donc sûre).
 */
function isMapAsset(url: URL): boolean {
	return (
		url.hostname === 'basemaps.cartocdn.com' ||
		url.hostname.endsWith('.basemaps.cartocdn.com') ||
		url.hostname === 'fonts.gstatic.com'
	);
}

/** Jamais en cache : tout ce qui doit rester frais. */
function isLiveData(url: URL): boolean {
	if (url.origin === location.origin) {
		// nos routes serveur (proxy Overpass, etc.) : toujours au réseau
		return url.pathname.startsWith('/api/');
	}
	if (url.hostname.endsWith('.supabase.co')) {
		// les photos publiques sont immuables ; le reste (REST, RPC, auth) doit être live
		return !url.pathname.startsWith('/storage/v1/object/public/');
	}
	return url.hostname.includes('overpass') || url.hostname === 'photon.komoot.io';
}

if (!import.meta.env.DEV) {
	sw.addEventListener('install', (event) => {
		event.waitUntil(
			caches
				.open(SHELL)
				.then((cache) => cache.addAll([...PRECACHE]))
				.then(() => sw.skipWaiting())
		);
	});

	sw.addEventListener('activate', (event) => {
		event.waitUntil(
			(async () => {
				for (const key of await caches.keys()) {
					if (key !== SHELL && key !== RUNTIME) await caches.delete(key);
				}
				await sw.clients.claim();
			})()
		);
	});

	sw.addEventListener('fetch', (event) => {
		const { request } = event;
		if (request.method !== 'GET') return;

		const url = new URL(request.url);
		if (isLiveData(url)) return; // laisse passer au réseau

		// Navigation : réseau d'abord (et on garde la coquille), sinon cache.
		if (request.mode === 'navigate') {
			event.respondWith(
				(async () => {
					try {
						const res = await fetch(request);
						(await caches.open(SHELL)).put(SHELL_URL, res.clone());
						return res;
					} catch {
						return (await caches.match(SHELL_URL)) ?? offline();
					}
				})()
			);
			return;
		}

		// Ressources de l'app : cache d'abord.
		if (url.origin === location.origin && PRECACHE.has(url.pathname)) {
			event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
			return;
		}

		// Fond de carte + polices : réseau d'abord, cache en secours hors-ligne.
		if (isMapAsset(url)) {
			event.respondWith(networkFirst(request));
			return;
		}

		// Photos publiques Supabase (immuables) : cache d'abord.
		if (url.pathname.startsWith('/storage/v1/object/public/')) {
			event.respondWith(staleWhileRevalidate(request));
		}
	});
}

/** Réseau d'abord ; on retombe sur le cache seulement si le réseau échoue. */
async function networkFirst(request: Request): Promise<Response> {
	const cache = await caches.open(RUNTIME);
	try {
		const res = await fetch(request);
		if (res.ok) {
			cache.put(request, res.clone()).then(() => trim(cache));
		}
		return res;
	} catch {
		return (await cache.match(request)) ?? offline();
	}
}

function offline(): Response {
	return new Response('Hors ligne', { status: 503, statusText: 'Offline' });
}

async function staleWhileRevalidate(request: Request): Promise<Response> {
	const cache = await caches.open(RUNTIME);
	const cached = await cache.match(request);

	const network = fetch(request)
		.then((res) => {
			if (res.ok || res.type === 'opaque') {
				cache.put(request, res.clone()).then(() => trim(cache));
			}
			return res;
		})
		.catch(() => undefined);

	return cached ?? (await network) ?? offline();
}

async function trim(cache: Cache) {
	const keys = await cache.keys();
	if (keys.length <= RUNTIME_MAX) return;
	for (const key of keys.slice(0, keys.length - RUNTIME_MAX)) {
		await cache.delete(key);
	}
}
