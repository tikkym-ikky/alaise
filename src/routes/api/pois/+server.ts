import { error, json } from '@sveltejs/kit';
import { findPois } from '$lib/overpass.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const lat = Number(url.searchParams.get('lat'));
	const lon = Number(url.searchParams.get('lon'));
	const r = Math.min(2000, Math.max(100, Number(url.searchParams.get('r')) || 900));

	if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
		throw error(400, 'Paramètres lat/lon manquants ou invalides');
	}

	try {
		const pois = await findPois(lat, lon, r);
		// Vercel peut servir une requête identique depuis son cache edge.
		setHeaders({ 'cache-control': 'public, max-age=60, s-maxage=300' });
		return json(pois);
	} catch (e) {
		console.error('overpass', e);
		throw error(502, 'Service de lieux (Overpass) injoignable, réessaie');
	}
};
