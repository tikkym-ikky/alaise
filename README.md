# loomap

Noter la propreté des toilettes des lieux où l'on s'arrête (restaurant, gare, café…).
Carte plein écran, lieux réels via OpenStreetMap, note de propreté + photo, **partagées**
entre tous les utilisateurs.

## Stack

- **SvelteKit 2 + Svelte 5** (runes), TypeScript
- **MapLibre GL JS** + fond de carte CARTO Positron (sans clé API)
- **Overpass API** pour récupérer les bâtiments autour de toi (aucune clé)
- **Supabase** — Postgres + PostGIS (géo), Storage (photos), Auth anonyme, RLS
- **`@sveltejs/adapter-vercel`** pour le déploiement

## 1. Créer le projet Supabase

1. supabase.com → **New project** (note bien le mot de passe DB).
2. **SQL Editor → New query** → coller tout `supabase/schema.sql` → **Run**.
   Ça crée les tables `places` / `ratings`, les règles RLS, le bucket `photos`
   et la fonction `ratings_near`.
3. **Authentication → Sign In / Providers → Anonymous** → activer.
   (L'app connecte chaque visiteur en anonyme pour pouvoir écrire.)
4. **Project Settings → API** → copier `Project URL` et la clé `anon` `public`.

## 2. Config locale

```bash
cp .env.example .env
# coller PUBLIC_SUPABASE_URL et PUBLIC_SUPABASE_ANON_KEY dans .env
npm install
npm run dev
```

Ces deux valeurs sont **publiques** (elles partent dans le navigateur) : la sécurité
vient des règles RLS, pas du secret de la clé.

`npm run check` (types) · `npm run build` (prod).

> Le build force le runtime `nodejs22.x` (`vite.config.ts`) parce que Node 26 n'est pas
> encore reconnu par l'adaptateur. Vercel tourne en Node 22, donc pas d'impact là-bas.

## 3. Déploiement Vercel

1. Pousser le repo sur GitHub.
2. vercel.com → **Add New… → Project** → importer le repo (SvelteKit détecté seul).
3. **Settings → Environment Variables** → ajouter `PUBLIC_SUPABASE_URL` et
   `PUBLIC_SUPABASE_ANON_KEY` (mêmes valeurs que `.env`).
4. Deploy. Chaque `git push` redéploie.

Alternative sans compte GitHub : `npm i -g vercel && vercel`.

## Comment ça marche

- **Charger la zone** : Overpass pose une pastille par bâtiment (rayon 900 m) **et**
  `ratings_near` charge les notes existantes (rayon 1,5 km) en losanges colorés
  (rouge = sale → vert = nickel).
- Tape une pastille (ou un losange) → fiche de notation, avec l'historique du lieu.
- **＋** : noter un endroit absent d'OSM (position = centre de la carte).
- **🧭** : recentrer sur ta position.
- Photo : compressée (`src/lib/image.ts`) puis envoyée dans le bucket `photos`.

## Structure

```
src/lib/supabase.ts          client Supabase + résolution des URLs de photos
src/lib/ratings.svelte.ts    store des notes (auth, loadNear, add, remove)
src/lib/overpass.ts          POI OpenStreetMap autour d'un point
src/lib/image.ts             compression photo -> Blob JPEG
src/routes/+page.svelte      carte + fiche de notation
supabase/schema.sql          à exécuter une fois dans Supabase
```

## Roadmap

- [ ] Agréger par lieu (note moyenne, nombre d'avis) plutôt qu'empiler les notes.
- [ ] Rafraîchir les notes automatiquement au déplacement de la carte (debounce).
- [ ] `src/service-worker.ts` : vrai mode hors-ligne (cache du shell + dernières notes).
- [ ] Déplacer le marqueur à la main quand la porte des WC n'est pas à l'adresse OSM.
- [ ] Filtres (type de lieu, note mini), recherche.
- [ ] Supabase Realtime : voir les notes des autres apparaître en direct.
- [ ] Emballer en app installable via **Capacitor** si besoin des stores.
