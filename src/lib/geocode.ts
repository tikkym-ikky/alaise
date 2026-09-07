// Type-ahead geocoding via Photon (Komoot) — OpenStreetMap data, no API key, CORS ok.
export type GeoResult = {
	id: string; // "node/123" style, matches Overpass ids when it's a real place
	label: string; // primary line
	detail: string; // secondary line (city, country…)
	lat: number;
	lon: number;
	kind: string; // osm value ("restaurant", "residential"…)
	isPlace: boolean; // named shop/amenity vs. a street or area
};

const PHOTON = 'https://photon.komoot.io/api/';
const PLACE_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'railway', 'public_transport', 'office'];
const OSM_TYPE: Record<string, string> = { N: 'node', W: 'way', R: 'relation' };

export async function geocode(
	q: string,
	near?: { lat: number; lon: number }
): Promise<GeoResult[]> {
	if (q.trim().length < 3) return [];

	const params = new URLSearchParams({ q, limit: '6', lang: 'fr' });
	if (near) {
		params.set('lat', String(near.lat));
		params.set('lon', String(near.lon));
	}

	const res = await fetch(`${PHOTON}?${params}`);
	if (!res.ok) throw new Error('geocode HTTP ' + res.status);
	const data = (await res.json()) as { features?: any[] };

	return (data.features ?? []).map((f, i): GeoResult => {
		const p = f.properties ?? {};
		const [lon, lat] = f.geometry.coordinates as [number, number];
		const street = [p.housenumber, p.street].filter(Boolean).join(' ');
		const name = p.name || street;
		const city = p.city || p.town || p.village || p.county;
		const ctx = [name ? city : null, p.state, p.country].filter(Boolean).join(', ');
		const isPlace = Boolean(p.name) && PLACE_KEYS.includes(p.osm_key);
		const type = OSM_TYPE[p.osm_type] ?? 'node';

		return {
			id: p.osm_id ? `${type}/${p.osm_id}` : `geo/${i}`,
			label: name || city || 'Résultat',
			detail: name ? ctx : [p.osm_value, city].filter(Boolean).join(' · ') || ctx,
			lat,
			lon,
			kind: p.osm_value || p.osm_key || 'place',
			isPlace
		};
	});
}
