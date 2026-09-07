import { supabase, supabaseEnabled, photoUrl, PHOTO_BUCKET } from './supabase';

export type Place = {
	id: string; // OSM id ("node/123") or "manual/<uuid>"
	name: string;
	kind: string;
	lat: number;
	lon: number;
};

export type Rating = {
	id: string;
	place_id: string;
	name: string;
	kind: string;
	lat: number;
	lon: number;
	cleanliness: number; // 1..5
	note: string;
	photo_path: string | null;
	photo_url: string | null; // resolved for display
	author: string | null;
	created_at: string;
};

/** One aggregated place (all its ratings folded together). */
export type PlaceSummary = {
	placeId: string;
	name: string;
	kind: string;
	lat: number;
	lon: number;
	avg: number;
	count: number;
	lastNote: string;
	photo_url: string | null;
	lastAt: string;
};

/** Un lieu agrégé, avec sa distance au point de référence. */
export type Ranked = PlaceSummary & { dist: number | null };

export type NewRating = {
	place: Place;
	cleanliness: number;
	note: string;
	photo: Blob | null;
};

type NearRow = {
	id: string;
	place_id: string;
	name: string;
	kind: string | null;
	lat: number;
	lon: number;
	cleanliness: number;
	note: string | null;
	photo_path: string | null;
	author: string | null;
	created_at: string;
};

class RatingStore {
	items = $state<Rating[]>([]);
	ready = $state(false);
	error = $state<string | null>(null);

	/** Sign in (anonymously) so inserts pass RLS. Call once in the browser. */
	async init() {
		if (!supabaseEnabled || !supabase) {
			this.error = 'Backend non configuré — voir .env.example';
			return;
		}
		const { data } = await supabase.auth.getSession();
		if (!data.session) {
			const { error } = await supabase.auth.signInAnonymously();
			if (error) {
				this.error =
					'Connexion anonyme refusée — active-la dans Supabase (Auth → Providers → Anonymous).';
				return;
			}
		}
		this.ready = true;
	}

	/** Load community ratings within `radius` metres of a point. */
	async loadNear(lat: number, lon: number, radius = 1200) {
		if (!supabase) return;
		const { data, error } = await supabase.rpc('ratings_near', {
			in_lat: lat,
			in_lon: lon,
			in_radius: radius
		});
		if (error) {
			this.error = 'Chargement des notes impossible';
			return;
		}
		this.items = (data as NearRow[]).map((r) => ({
			id: r.id,
			place_id: r.place_id,
			name: r.name,
			kind: r.kind ?? 'lieu',
			lat: r.lat,
			lon: r.lon,
			cleanliness: r.cleanliness,
			note: r.note ?? '',
			photo_path: r.photo_path,
			photo_url: photoUrl(r.photo_path),
			author: r.author,
			created_at: r.created_at
		}));
	}

	forPlace(placeId: string | null): Rating[] {
		if (!placeId) return [];
		return this.items.filter((x) => x.place_id === placeId);
	}

	/** All rated places, each folded to an average + count. */
	get summaries(): PlaceSummary[] {
		const m = new Map<string, PlaceSummary>();
		for (const r of this.items) {
			const cur = m.get(r.place_id);
			if (!cur) {
				m.set(r.place_id, {
					placeId: r.place_id,
					name: r.name,
					kind: r.kind,
					lat: r.lat,
					lon: r.lon,
					avg: r.cleanliness,
					count: 1,
					lastNote: r.note,
					photo_url: r.photo_url,
					lastAt: r.created_at
				});
			} else {
				cur.avg = (cur.avg * cur.count + r.cleanliness) / (cur.count + 1);
				cur.count += 1;
				if (r.created_at > cur.lastAt) {
					cur.lastAt = r.created_at;
					if (r.note) cur.lastNote = r.note;
					if (r.photo_url) cur.photo_url = r.photo_url;
				}
			}
		}
		return [...m.values()];
	}

	async add({ place, cleanliness, note, photo }: NewRating): Promise<boolean> {
		if (!supabase) return false;

		let photo_path: string | null = null;
		if (photo) {
			photo_path = `${crypto.randomUUID()}.jpg`;
			const up = await supabase.storage
				.from(PHOTO_BUCKET)
				.upload(photo_path, photo, { contentType: 'image/jpeg' });
			if (up.error) {
				this.error = 'Envoi de la photo impossible';
				return false;
			}
		}

		const placeRes = await supabase.from('places').upsert(place);
		if (placeRes.error) {
			this.error = 'Enregistrement du lieu impossible';
			return false;
		}

		const { data, error } = await supabase
			.from('ratings')
			.insert({ place_id: place.id, cleanliness, note, photo_path })
			.select()
			.single();
		if (error || !data) {
			this.error = 'Enregistrement de la note impossible';
			return false;
		}

		this.items = [
			{
				id: data.id,
				place_id: place.id,
				name: place.name,
				kind: place.kind,
				lat: place.lat,
				lon: place.lon,
				cleanliness,
				note,
				photo_path,
				photo_url: photoUrl(photo_path),
				author: data.author ?? null,
				created_at: data.created_at
			},
			...this.items
		];
		return true;
	}

	async remove(id: string): Promise<void> {
		if (!supabase) return;
		const target = this.items.find((x) => x.id === id);
		const { error } = await supabase.from('ratings').delete().eq('id', id);
		if (error) {
			this.error = 'Suppression impossible (ce n’est peut-être pas ta note)';
			return;
		}
		if (target?.photo_path) {
			await supabase.storage.from(PHOTO_BUCKET).remove([target.photo_path]);
		}
		this.items = this.items.filter((x) => x.id !== id);
	}
}

export const ratings = new RatingStore();
