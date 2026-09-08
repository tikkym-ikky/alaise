/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const SHELL = `alaise-shell-${version}`;
const RUNTIME = 'alaise-runtime';
const RUNTIME_MAX = 320; // tuiles + polices + photos gardées hors-ligne
const SHELL_URL = '/'; // coquille HTML, mise en cache à la première visite

/** Ressources de l'app (noms hashés → sûres à mettre en cache fort). */
const PRECACHE = new Set([...build, ...files]);

/** Hôtes dont on garde une copie pour l'usage hors-ligne. */
const CACHEABLE_HOSTS = new Set([
	'basemaps.cartocdn.com',
	'tiles.basemaps.cartocdn.com',
	'fonts.googleapis.com',
	'fonts.gstatic.com'
]);

/** Jamais en cache : tout ce qui doit rester frais. */
function isLiveData(url: URL): boolean {
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

		// Tuiles, polices, photos publiques : cache d'abord, complété au fil de l'eau.
		const cacheable =
			CACHEABLE_HOSTS.has(url.hostname) ||
			url.pathname.startsWith('/storage/v1/object/public/');
		if (cacheable) {
			event.respondWith(staleWhileRevalidate(request));
		}
	});
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
