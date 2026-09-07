export type Poi = {
	id: string;
	lat: number;
	lon: number;
	name: string;
	kind: string;
};

const OVERPASS = 'https://overpass-api.de/api/interpreter';

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

export async function fetchPois(lat: number, lon: number, radius = 900): Promise<Poi[]> {
	const parts = QUERY_TAGS.map(
		([k, v]) => `nwr[${k}=${v}][name](around:${radius},${lat},${lon});`
	).join('\n');
	const query = `[out:json][timeout:25];(${parts});out center tags 80;`;

	const res = await fetch(OVERPASS, {
		method: 'POST',
		body: 'data=' + encodeURIComponent(query)
	});
	if (!res.ok) throw new Error('Overpass HTTP ' + res.status);
	const data = (await res.json()) as { elements?: any[] };

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
