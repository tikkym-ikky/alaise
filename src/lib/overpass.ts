export type Poi = {
	id: string;
	lat: number;
	lon: number;
	name: string;
	kind: string;
};

// Plusieurs miroirs : le principal (overpass-api.de) renvoie souvent 406/429/504
// quand il est chargé, et sur ces erreurs il n'ajoute pas d'en-tête CORS →
// le navigateur signale « CORS blocked ». On bascule sur le miroir suivant.
const OVERPASS_ENDPOINTS = [
	'https://overpass-api.de/api/interpreter',
	'https://overpass.kumi.systems/api/interpreter'
];
const ENDPOINT_TIMEOUT = 14000; // au-delà, on considère le miroir muet et on passe au suivant

// Tags for "places you might walk into and need a loo".
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

const LABELS: Record<string, string> = {
	restaurant: 'Restaurant',
	cafe: 'Café',
	fast_food: 'Fast-food',
	bar: 'Bar',
	pub: 'Pub',
	fuel: 'Station-service',
	toilets: 'Toilettes publiques',
	library: 'Bibliothèque',
	cinema: 'Cinéma',
	community_centre: 'Centre social',
	station: 'Gare / station',
	mall: 'Centre commercial',
	department_store: 'Grand magasin'
};

export function labelFor(kind: string): string {
	return LABELS[kind] ?? 'Lieu';
}

type OverpassResponse = { elements?: any[] };

/**
 * POST la requête aux miroirs Overpass l'un après l'autre jusqu'à une réponse OK.
 * Deux passes : les erreurs 406/429/504 sont quasi toujours transitoires.
 */
async function runOverpass(query: string): Promise<OverpassResponse> {
	const body = 'data=' + encodeURIComponent(query);
	let lastErr: unknown;

	for (let pass = 0; pass < 2; pass++) {
		for (const endpoint of OVERPASS_ENDPOINTS) {
			try {
				const res = await fetch(endpoint, {
					method: 'POST',
					// type CORS-safe (pas de préflight) et encodage attendu par Overpass
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body,
					signal: AbortSignal.timeout(ENDPOINT_TIMEOUT)
				});
				if (res.ok) return (await res.json()) as OverpassResponse;
				lastErr = new Error('Overpass HTTP ' + res.status);
			} catch (e) {
				lastErr = e; // réseau/timeout, ou erreur CORS sur une réponse d'erreur du miroir
			}
		}
	}
	throw lastErr ?? new Error('Overpass injoignable');
}

export async function fetchPois(lat: number, lon: number, radius = 900): Promise<Poi[]> {
	const parts = QUERY_TAGS.map(
		([k, v]) => `nwr[${k}=${v}][name](around:${radius},${lat},${lon});`
	).join('\n');
	const query = `[out:json][timeout:25];(${parts});out center tags 80;`;
	const data = await runOverpass(query);

	const seen = new Set<string>();
	const out: Poi[] = [];
	for (const el of data.elements ?? []) {
		const point = el.type === 'node' ? { lat: el.lat, lon: el.lon } : el.center;
		if (!point) continue;
		const tags = el.tags ?? {};
		const kind =
			tags.amenity || tags.shop || tags.railway || tags.public_transport || 'lieu';
		const id = `${el.type}/${el.id}`;
		if (seen.has(id)) continue;
		seen.add(id);
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
