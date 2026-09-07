-- loomap — schéma initial.
-- À coller dans Supabase → SQL Editor → New query → Run (une seule fois).

-- 1. Requêtes géographiques
create extension if not exists postgis;

-- 2. Tables ---------------------------------------------------------------

create table if not exists places (
  id   text primary key,               -- 'node/123' (OSM) ou 'manual/<uuid>'
  name text not null,
  kind text default 'lieu',
  lat  double precision not null,
  lon  double precision not null
);

create table if not exists ratings (
  id          uuid primary key default gen_random_uuid(),
  place_id    text not null references places(id) on delete cascade,
  cleanliness int  not null check (cleanliness between 1 and 5),
  note        text default '',
  photo_path  text,                     -- objet dans le bucket 'photos'
  author      uuid default auth.uid(),
  created_at  timestamptz default now()
);

create index if not exists ratings_place_idx on ratings (place_id);
create index if not exists places_geo_idx
  on places using gist (ST_MakePoint(lon, lat));

-- 3. Privilèges de rôle + Row Level Security --------------------------

-- Les rôles de l'API REST doivent avoir le GRANT sur les tables ;
-- RLS (plus bas) filtre ensuite ligne par ligne.
grant usage on schema public to anon, authenticated;
grant select on places, ratings to anon, authenticated;
grant insert, update, delete on places, ratings to authenticated;

alter table places  enable row level security;
alter table ratings enable row level security;

drop policy if exists "places lisibles"    on places;
drop policy if exists "places ajoutables"  on places;
drop policy if exists "places modifiables" on places;
create policy "places lisibles"    on places  for select using (true);
create policy "places ajoutables"  on places  for insert with check (auth.uid() is not null);
create policy "places modifiables" on places  for update using (auth.uid() is not null);

drop policy if exists "ratings lisibles"   on ratings;
drop policy if exists "ratings ajoutables" on ratings;
drop policy if exists "ratings: éditer les siennes"    on ratings;
drop policy if exists "ratings: supprimer les siennes" on ratings;
create policy "ratings lisibles"   on ratings for select using (true);
create policy "ratings ajoutables" on ratings for insert with check (auth.uid() is not null);
create policy "ratings: éditer les siennes"    on ratings for update using (author = auth.uid());
create policy "ratings: supprimer les siennes" on ratings for delete using (author = auth.uid());

-- 4. Bucket de photos --------------------------------------------------

insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

drop policy if exists "photos lisibles" on storage.objects;
drop policy if exists "photos ajoutables" on storage.objects;
drop policy if exists "photos: supprimer les siennes" on storage.objects;
create policy "photos lisibles" on storage.objects
  for select using (bucket_id = 'photos');
create policy "photos ajoutables" on storage.objects
  for insert with check (bucket_id = 'photos' and auth.uid() is not null);
create policy "photos: supprimer les siennes" on storage.objects
  for delete using (bucket_id = 'photos' and owner = auth.uid());

-- 5. « Notes autour d'ici » -------------------------------------------

drop function if exists ratings_near(float, float, float);
create function ratings_near(in_lat float, in_lon float, in_radius float)
returns table (
  id uuid, place_id text, name text, kind text, lat float, lon float,
  cleanliness int, note text, photo_path text, author uuid, created_at timestamptz
)
language sql stable
as $$
  select r.id, r.place_id, p.name, p.kind, p.lat, p.lon,
         r.cleanliness, r.note, r.photo_path, r.author, r.created_at
  from ratings r
  join places p on p.id = r.place_id
  where ST_DWithin(
    ST_MakePoint(p.lon, p.lat)::geography,
    ST_MakePoint(in_lon, in_lat)::geography,
    in_radius
  )
  order by r.created_at desc;
$$;
