-- ════════════════════════════════════════════════════════════════
-- Ma Cave à Vin v2 — Schéma complet Supabase
-- À exécuter dans Supabase → SQL Editor
-- ════════════════════════════════════════════════════════════════

-- 1) EMPLACEMENTS ----------------------------------------------------
create table emplacements (
  code text primary key,
  zone text not null,
  rayon text,
  capacite integer,
  temperature_cible numeric,
  humidite_cible numeric,
  notes text
);

-- 2) INVENTAIRE (table principale) -----------------------------------
create table vins (
  id uuid default gen_random_uuid() primary key,
  id_bouteille text unique,
  nom text not null,
  pays text,
  region text,
  appellation text,
  cepage text,
  millesime integer,
  couleur text,
  producteur text,
  format text default 'Bouteille (75cl)',
  quantite integer default 1,
  emplacement text references emplacements(code) on delete set null,
  date_achat date,
  vendeur text,
  prix_unitaire numeric,
  date_apogee integer,
  fenetre_consommation text,
  notes text,
  photo text,
  commentaire_degustation text,
  note_perso integer,
  accords text[],
  cotations jsonb,
  created_at timestamp default now()
);

-- 3) MOUVEMENTS (historique entrées/sorties) ---------------------------
create table mouvements (
  id uuid default gen_random_uuid() primary key,
  date date not null default current_date,
  vin_id uuid references vins(id) on delete cascade,
  type_mouvement text not null, -- Entrée, Sortie, Ajustement, Casse
  quantite integer not null,
  emplacement_source text,
  emplacement_cible text,
  motif text,
  commentaire text,
  created_at timestamp default now()
);

-- 4) DÉGUSTATIONS -------------------------------------------------------
create table degustations (
  id uuid default gen_random_uuid() primary key,
  date_degustation date not null default current_date,
  vin_id uuid references vins(id) on delete cascade,
  appreciation integer, -- 1 à 5
  invites text,
  commentaires text,
  moment_consommation text,
  service_temperature text,
  created_at timestamp default now()
);

-- ── Row Level Security (accès public, app personnelle) ──────────────
alter table emplacements enable row level security;
alter table vins enable row level security;
alter table mouvements enable row level security;
alter table degustations enable row level security;

create policy "Public access" on emplacements for all using (true);
create policy "Public access" on vins for all using (true);
create policy "Public access" on mouvements for all using (true);
create policy "Public access" on degustations for all using (true);

-- ── Données initiales : emplacements ─────────────────────────────────
insert into emplacements (code, zone, rayon, capacite, temperature_cible, humidite_cible, notes) values
('A1', 'Cave Principale', 'Rayon A - Niveau 1', 50, 12, 70, 'Zone de garde rouge'),
('A2', 'Cave Principale', 'Rayon A - Niveau 2', 50, 12, 70, 'Zone de garde rouge'),
('B1', 'Cave Électrique', 'Étagère 1', 24, 10, 65, 'Blancs et Champagnes'),
('C1', 'Cellier', 'Casier Bois', 100, 16, 60, 'Consommation rapide');

-- ── Vins importés depuis le fichier Excel ────────────────────────────
insert into vins (id_bouteille, nom, pays, region, appellation, cepage, millesime, couleur, producteur, format, quantite, emplacement, date_achat, vendeur, prix_unitaire, date_apogee, fenetre_consommation, notes) values
('B001', 'Château Margaux', 'France', 'Bordeaux', 'Pauillac', 'Cabernet Sauvignon', 2015, 'Rouge', 'Château Margaux', 'Bouteille (75cl)', 6, 'A1', '2018-05-12', 'Millésimes SAS', 650, 2025, '2023-2035', 'Grand Cru Classé'),
('B002', 'Domaine Leflaive Puligny-Montrachet', 'France', 'Bourgogne', 'Chablis', 'Chardonnay', 2018, 'Blanc', 'Domaine Leflaive', 'Bouteille (75cl)', 3, 'B1', '2020-11-05', 'Nicolas', 120, 2024, '2022-2028', 'Exceptionnel'),
('B003', 'Sassicaia', 'Italie', 'Toscane', 'Chianti Classico', 'Sangiovese', 2016, 'Rouge', 'Tenuta San Guido', 'Magnum (1.5L)', 2, 'A2', '2019-09-20', 'Wine Decanter', 350, 2026, '2024-2036', 'Super Toscan'),
('B004', 'Vega Sicilia Único', 'Espagne', 'Rioja', 'Rioja Gran Reserva', 'Tempranillo', 2010, 'Rouge', 'Vega Sicilia', 'Bouteille (75cl)', 4, 'A1', '2021-02-15', 'Vinatis', 400, 2028, '2025-2040', 'Icône espagnole'),
('B005', 'Côte-Rôtie Ampuis', 'France', 'Rhône', 'Châteauneuf-du-Pape', 'Syrah', 2017, 'Rouge', 'Guigal', 'Bouteille (75cl)', 12, 'A2', '2020-04-18', 'Chateaunet', 75, 2025, '2022-2032', 'Très aromatique'),
('B006', 'Sancerre d''Antan', 'France', 'Loire', 'Sancerre', 'Sauvignon Blanc', 2020, 'Blanc', 'Henri Bourgeois', 'Bouteille (75cl)', 0, 'C1', '2022-06-10', 'Nicolas', 35, 2023, '2021-2025', 'Épuisé, à racheter'),
('B007', 'Barolo Cannubi', 'Italie', 'Piémont', 'Barolo', 'Nebbiolo', 2015, 'Rouge', 'Marchesi di Barolo', 'Bouteille (75cl)', 5, 'A1', '2019-10-12', 'Wine Decanter', 90, 2027, '2023-2033', 'Puissant'),
('B008', 'Amarone della Valpolicella', 'Italie', 'Vénétie', 'Amarone', 'Corvina', 2017, 'Rouge', 'Masi', 'Bouteille (75cl)', 8, 'A2', '2021-05-20', 'Vinatis', 60, 2026, '2023-2032', 'Riche et complexe'),
('B009', 'Rioja Alta Gran Reserva 904', 'Espagne', 'Rioja', 'Rioja Gran Reserva', 'Tempranillo', 2011, 'Rouge', 'La Rioja Alta', 'Bouteille (75cl)', 6, 'A1', '2020-08-14', 'Decántalo', 70, 2026, '2022-2036', 'Classique'),
('B010', 'Ruinart Blanc de Blancs', 'France', 'Champagne', 'Chablis', 'Chardonnay', null, 'Effervescent', 'Ruinart', 'Bouteille (75cl)', 6, 'B1', '2023-12-15', 'Nicolas', 85, 2025, '2024-2027', 'Champagne de fête');

-- ── Dégustations importées ───────────────────────────────────────────
insert into degustations (date_degustation, vin_id, appreciation, invites, commentaires, moment_consommation, service_temperature)
select '2024-01-20'::date, id, 5, 'Jean & Marie', 'Absolument grandiose, tanins soyeux', 'Dîner d''anniversaire', '17°C, carafé 2h' from vins where id_bouteille = 'B001'
union all
select '2024-02-10'::date, id, 4, 'Famille', 'Très frais, belle minéralité', 'Repas de famille', '10°C' from vins where id_bouteille = 'B006'
union all
select '2024-03-15'::date, id, 5, 'Amis', 'Puissant, notes de fruits noirs', 'Soirée dégustation', '16°C' from vins where id_bouteille = 'B003'
union all
select '2024-04-05'::date, id, 4, 'Solo', 'Toujours aussi agréable', 'Apéritif', '11°C' from vins where id_bouteille = 'B006';

-- ── Mouvements importés ───────────────────────────────────────────────
insert into mouvements (date, vin_id, type_mouvement, quantite, emplacement_source, emplacement_cible, motif, commentaire)
select '2024-01-15'::date, id, 'Entrée', 6, null, 'A1', 'Achat initial', 'Millésimes SAS' from vins where id_bouteille = 'B001'
union all
select '2024-02-10'::date, id, 'Sortie', 2, 'C1', null, 'Dîner de famille', 'Excellent accord avec poisson' from vins where id_bouteille = 'B006'
union all
select '2024-03-01'::date, id, 'Entrée', 3, null, 'B1', 'Achat', 'Nicolas' from vins where id_bouteille = 'B002'
union all
select '2024-04-05'::date, id, 'Sortie', 1, 'C1', null, 'Dégustation', 'Dernière bouteille' from vins where id_bouteille = 'B006';
