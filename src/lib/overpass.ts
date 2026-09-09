export type Poi = {
	id: string;
	lat: number;
	lon: number;
	name: string;
	kind: string;
};

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

/**
 * Lieux OpenStreetMap autour d'un point.
 *
 * Passe par notre propre endpoint `/api/pois` (même origine) plutôt que
 * d'interroger Overpass directement : les instances publiques limitent le débit
 * et n'ajoutent pas d'en-tête CORS sur leurs réponses d'erreur (406/429/504),
 * ce que le navigateur affiche comme un blocage CORS.
 */
export async function fetchPois(lat: number, lon: number, radius = 900): Promise<Poi[]> {
	const q = new URLSearchParams({
		lat: String(lat),
		lon: String(lon),
		r: String(Math.round(radius))
	});
	const res = await fetch(`/api/pois?${q}`);
	if (!res.ok) throw new Error('POIs HTTP ' + res.status);
	return (await res.json()) as Poi[];
}
