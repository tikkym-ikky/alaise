import { labelFor, type Poi } from './overpass';

// Miroirs Overpass, essayés dans l'ordre. Le principal (overpass-api.de) est
// souvent surchargé et répond 406/429/504.
const OVERPASS_ENDPOINTS = [
	'https://overpass-api.de/api/interpreter',
	'https://overpass.kumi.systems/api/interpreter'
];
const ENDPOINT_TIMEOUT = 14000; // au-delà, miroir considéré muet → suivant

// Overpass renvoie 406 aux User-Agent génériques (dont le « node » par défaut) :
// il faut s'identifier explicitement.
const USER_AGENT = 'alaise/1.0 (+https://alaise.vercel.app; PWA notes de propreté toilettes)';

// Tags OSM : « endroits où l'on peut entrer et avoir besoin de toilettes ».
const QUERY_TAGS: Array<[string, string]> = [
	['amenity', 'restaurant'],
	['amenity', 'cafe'],
	['amenity', 'fast_food'],
	['amenity', 'bar'],
	['amenity', 'pub'],
	['amenity', 'fuel'],
	['amenity', 'toilets'],
	['amenity', 'library'],
	['amenity', 'cinema'],
	['amenity', 'community_centre'],
	['railway', 'station'],
	['public_transport', 'station'],
	['shop', 'mall'],
	['shop', 'department_store']
];

type OverpassElement = {
	type: string;
	id: number;
	lat?: number;
	lon?: number;
	center?: { lat: number; lon: number };
	tags?: Record<string, string>;
};

/** Lance la requête sur les miroirs, deux passes (les erreurs sont transitoires). */
async function runOverpass(query: string): Promise<OverpassElement[]> {
	const body = 'data=' + encodeURIComponent(query);
	let lastErr: unknown;

	for (let pass = 0; pass < 2; pass++) {
		for (const endpoint of OVERPASS_ENDPOINTS) {
			try {
				const res = await fetch(endpoint, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
						'User-Agent': USER_AGENT,
						Accept: 'application/json'
					},
					body,
					signal: AbortSignal.timeout(ENDPOINT_TIMEOUT)
				});
				if (res.ok) {
					const data = (await res.json()) as { elements?: OverpassElement[] };
					return data.elements ?? [];
				}
				lastErr = new Error(`${endpoint} → HTTP ${res.status}`);
			} catch (e) {
				lastErr = e;
			}
		}
	}
	throw lastErr ?? new Error('Overpass injoignable');
}

/** POI OSM autour d'un point (rayon en mètres). */
export async function findPois(lat: number, lon: number, radius: number): Promise<Poi[]> {
	const parts = QUERY_TAGS.map(
		([k, v]) => `nwr[${k}=${v}][name](around:${radius},${lat},${lon});`
	).join('\n');
	const query = `[out:json][timeout:25];(${parts});out center tags 80;`;

	const seen = new Set<string>();
	const out: Poi[] = [];
	for (const el of await runOverpass(query)) {
		const point = el.type === 'node' ? { lat: el.lat, lon: el.lon } : el.center;
		if (!point || point.lat == null || point.lon == null) continue;
		const id = `${el.type}/${el.id}`;
		if (seen.has(id)) continue;
		seen.add(id);
		const tags = el.tags ?? {};
		const kind =
			tags.amenity || tags.shop || tags.railway || tags.public_transport || 'lieu';
		out.push({
			id,
			lat: point.lat,
			lon: point.lon,
			name: tags.name || labelFor(kind),
			kind
		});
	}
	return out;
}
