/** Vocabulaire visuel partagé : échelle de propreté, icônes, formats. */

export type Grade = { label: string; blurb: string; color: string };

/** 1 → 5. `color` référence les tokens définis dans app.css. */
export const SCALE: Grade[] = [
	{ label: 'Insalubre', blurb: 'À fuir', color: 'var(--grade-1)' },
	{ label: 'Sale', blurb: 'En dépannage', color: 'var(--grade-2)' },
	{ label: 'Passable', blurb: 'Ça ira', color: 'var(--grade-3)' },
	{ label: 'Propre', blurb: 'Bonne surprise', color: 'var(--grade-4)' },
	{ label: 'Impeccable', blurb: 'La référence', color: 'var(--grade-5)' }
];

function idx(n: number) {
	return Math.min(4, Math.max(0, Math.round(n) - 1));
}
export const colorFor = (n: number) => SCALE[idx(n)].color;
export const cleanLabel = (n: number) => SCALE[idx(n)].label;
export const cleanBlurb = (n: number) => SCALE[idx(n)].blurb;

const ICONS: Record<string, string> = {
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
export const iconFor = (kind: string) => ICONS[kind] ?? '📍';

/** Note affichée : « 4 » plutôt que « 4.0 », « 3.5 » sinon. */
export const fmtScore = (n: number) => n.toFixed(1).replace('.0', '');

export function fmtDist(m: number) {
	return m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

export function fmtDate(ts: string) {
	return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/** Distance orthodromique en mètres. */
export function distM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
	const R = 6371000;
	const rad = (d: number) => (d * Math.PI) / 180;
	const dLat = rad(b.lat - a.lat);
	const dLon = rad(b.lon - a.lon);
	const s =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(s));
}
