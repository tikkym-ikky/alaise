import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';

const url = env.PUBLIC_SUPABASE_URL;
const anonKey = env.PUBLIC_SUPABASE_ANON_KEY;

/** True once the two PUBLIC_SUPABASE_* env vars are set (see .env.example). */
export const supabaseEnabled = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = supabaseEnabled
	? createClient(url!, anonKey!)
	: null;

export const PHOTO_BUCKET = 'photos';

/** Public URL for a stored photo, or null. */
export function photoUrl(path: string | null | undefined): string | null {
	if (!path || !supabase) return null;
	return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}
