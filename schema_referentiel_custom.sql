-- ════════════════════════════════════════════════════════════════
-- Ajout : référentiel personnalisé (régions / appellations / cépages
-- ajoutés manuellement, en plus de ceux du fichier Excel d'origine)
-- À exécuter dans Supabase → SQL Editor
-- ════════════════════════════════════════════════════════════════

create table referentiel_custom (
  id uuid default gen_random_uuid() primary key,
  pays text not null,
  region text not null,
  appellation text not null,
  cepage text not null,
  created_at timestamp default now(),
  unique (pays, region, appellation, cepage)
);

alter table referentiel_custom enable row level security;
create policy "Public access" on referentiel_custom for all using (true);
