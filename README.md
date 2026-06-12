# 🍷 Ma Cave à Vin v2 — Guide de mise à jour

Cette version reconstruit l'app sur la base de votre fichier Excel `gestion_cave_vins_amelioree.xlsx` :
20 champs d'inventaire, cascade Pays → Région → Appellation → Cépage (≈770 combinaisons),
emplacements de cave, mouvements (entrées/sorties), dégustations, statut auto-calculé, dashboard.

---

## ⚠️ Important : nouvelle base de données

Le schéma a changé (nouvelles tables, nouveaux noms de colonnes). Vous avez deux options :

**Option A — Nouveau projet Supabase (recommandé, plus simple)**
1. Créez un nouveau projet sur [supabase.com](https://supabase.com)
2. SQL Editor → collez tout le contenu de `schema.sql` → Run
3. Cela crée les tables ET importe automatiquement vos 10 vins, dégustations et mouvements existants
4. Récupérez la nouvelle **Project URL** et **anon key** (Settings → API)

**Option B — Réutiliser le même projet Supabase**
1. SQL Editor → exécutez d'abord : `drop table if exists vins, mouvements, degustations, emplacements cascade;`
2. Puis collez tout `schema.sql` → Run
3. Vos clés restent les mêmes

---

## Étapes de déploiement

### 1. Remplacer le code
Remplacez le contenu de votre dossier `cave-a-vin` par celui de ce nouveau zip (gardez votre `.env` existant si vous utilisez l'Option B, sinon mettez à jour `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`).

### 2. Tester en local
```bash
npm install
npm run dev
```
Ouvrez `http://localhost:5173` — vous devriez voir vos 10 vins importés, avec statuts calculés automatiquement (À boire d'urgence, À boire bientôt, En garde, Épuisé).

### 3. Déployer
```bash
git add .
git commit -m "v2 - structure complète Excel"
git push
```
Vercel redéploie automatiquement. Si vous avez changé de projet Supabase (Option A), mettez à jour les variables d'environnement dans Vercel → Settings → Environment Variables, puis Redeploy.

---

## Nouveautés de cette version

**Onglets**
- **Inventaire** : 20 champs Excel, filtres par couleur/statut, recherche multi-champs
- **Statistiques** : total, valeur, références, note dégustation moyenne, bouteilles à boire <12 mois, répartition par couleur/pays/cépage
- **Cave** (emplacements) : occupation par zone avec température/humidité cibles
- **Mouvements** : historique entrées/sorties, généré automatiquement lors des ajouts et consommations
- **Dégustations** : journal de dégustation avec notes, invités, accords
- **Accords** : sommelier IA (inchangé)

**Formulaire d'ajout**
- Cascade **Pays → Région → Appellation → Cépage** (770 combinaisons issues de votre fichier, avec bascule en saisie libre si la combinaison n'existe pas)
- Champs complets : ID bouteille, producteur, format, emplacement, date/prix/vendeur d'achat, apogée, fenêtre de consommation, notes

**Statut automatique**
Calculé en temps réel (comme la formule Excel) :
- `Épuisé` si quantité = 0
- `À boire d'urgence` si année d'apogée ≤ année actuelle
- `À boire bientôt` si apogée dans ≤ 2 ans
- `En garde` sinon

**Fiche détail d'un vin**
- Bouton "Boire une bouteille" → décrémente le stock et crée un mouvement de sortie automatiquement
- Bouton "Ajouter une dégustation" → formulaire rapide
- Cotations critiques (James Suckling, Parker, RVF) via IA
- Photo d'étiquette

---

## Structure des fichiers

```
cave-a-vin/
├── schema.sql              ← Nouveau schéma + import des données Excel
├── src/
│   ├── App.jsx             ← Application complète
│   ├── data/referentiel.json  ← Cascade Pays/Région/Appellation/Cépage
│   ├── supabase.js
│   └── main.jsx
├── index.html
├── vite.config.js
├── package.json
└── .env
```
