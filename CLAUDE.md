# CLAUDE.md — PêcheLog : Spécifications complètes du projet

> Ce fichier contient toutes les spécifications et décisions prises pour le projet PêcheLog.
> Il sert de contexte pour Claude Code ET pour Cursor AI.
> Mis à jour : Avril 2026 — **État réel du code inclus (✅ Implémenté / ⚠️ Partiel / ❌ Pas encore)**

---

## 🎯 Vision du projet

PêcheLog est une application de journal de pêche intelligente qui permet aux pêcheurs de :
- Logger leurs prises en **1 clic** avec capture automatique des données (GPS, météo, lac, vitesse)
- Visualiser leurs données sur une **carte interactive** avec bathymétrie
- Analyser leurs **statistiques** de pêche (par espèce, leurre, lac, période)
- **Planifier et gérer leurs voyages** de pêche (lacs, compagnons, leurres cibles)
- **Partager** leurs cartes et spots avec d'autres pêcheurs *(à venir)*
- Fonctionner en **mode hors-ligne** complet (essentiel pour la pêche en région éloignée)

## 📱 Plateformes cibles

| Plateforme | Technologie | Notes |
|------------|------------|-------|
| Android    | React Native via Expo | Version principale |
| iOS        | React Native via Expo | Même codebase |
| Web        | Expo Web export | Accès navigateur, fonctions limitées |

Les 3 versions partagent le même code source (monorepo Expo). Les fichiers `.web.tsx` surchargent les composants natifs pour la version web.

---

## 🔐 Authentification ✅ IMPLÉMENTÉ

### Fournisseurs de login
- **Google** — OAuth via Supabase Auth avec PKCE (mobile) / implicit flow (web)
- **Apple** — Sign In with Apple via Supabase Auth
- **Facebook** — OAuth via Supabase Auth
- **Email/Password** — Formulaire email + mot de passe (UI présente, flow Supabase)

### Flow
1. L'utilisateur choisit un fournisseur sur l'écran de login (`app/login.tsx`)
2. Redirection OAuth via `expo-web-browser` (mobile) ou redirect URL (web)
3. Le callback OAuth est traité dans `app/auth/callback.tsx`
4. Retour dans l'app avec session Supabase
5. Création automatique du profil dans `profiles` si première connexion
6. `AuthContext` (`contexts/AuthContext.tsx`) maintient l'état de connexion globalement
7. `AuthContext` expose `useAuth()` → `{ session, user, profile, signOut, ... }`

### Notes d'implémentation
- PKCE flow sur mobile, implicit flow sur web (détecté automatiquement)
- Logs détaillés via objet `authLog` dans AuthContext (utile pour debugging)
- Cold-start deep link géré pour le retour OAuth sur Android

---

## 📝 Formulaire de saisie rapide ✅ IMPLÉMENTÉ

### Philosophie
Le pêcheur est sur l'eau, potentiellement en train de gérer un poisson. La saisie doit être **la plus rapide possible**. Tout ce qui peut être automatisé l'est.

### Champs automatiques (badges dans l'UI)
| Champ | Source | Fonctionne hors-ligne? | État |
|-------|--------|----------------------|------|
| Coordonnées GPS | `expo-location` | ✅ Oui (GPS natif) | ✅ |
| Nom du lac | Reverse geocoding Nominatim/OpenStreetMap | ❌ Nécessite internet | ✅ |
| Température °C | API OpenWeatherMap | ❌ Nécessite internet | ✅ |
| Vent (km/h + direction) | API OpenWeatherMap | ❌ Nécessite internet | ✅ |
| Date et heure | Horloge du téléphone | ✅ Toujours | ✅ |
| Vitesse (km/h) | GPS du téléphone | ✅ Oui | ✅ |
| Profondeur (m) | Sonar Bluetooth si connecté | ✅ Oui (Bluetooth local) | ❌ |

### Champs manuels
| Champ | Type d'input | État |
|-------|-------------|------|
| Espèce | Chips sélectionnables (catalogue SPECIES_CONFIG, 11 espèces) | ✅ |
| Leurre | Composant LurePicker modal (catalogue 80 leurres, 8 catégories) | ✅ |
| Profondeur | Numérique (mètres) | ✅ |
| Grosseur | Toggle 3 modes : P/M/G/Trophée OU poids (lb) OU longueur (po) | ✅ |
| Photos/vidéos | `expo-image-picker`, 1 ou plusieurs | ✅ |
| Carte destination | Radio : personnelle / partagée / publique | ❌ (UI absente) |
| Notes | Textarea | ✅ |

### Comportement hors-ligne
- Si Supabase insert échoue → catch mis en file `offline_catches_queue_v1` (AsyncStorage)
- Sync automatique déclenchée quand connexion rétablie (`SyncManager` dans `app/_layout.tsx`)
- Les photos/médias **ne sont pas** inclus dans la file offline (à implémenter)

### Préconfiguration depuis Voyage
- Le dernier espèce/leurre utilisé est sauvegardé via `saveLastCatchSettings()` dans `tripStorage.ts`
- Pré-remplit le formulaire au prochain lancer depuis un voyage actif

---

## 🗺 Carte interactive ✅ IMPLÉMENTÉ

### Bibliothèque utilisée
- **`react-native-maps`** (Apple Maps / Google Maps) — **pas MapBox**
- Web : `react-leaflet` + `leaflet` (intégration partielle, fichier `map.web.tsx`)

### Fonctionnalités implémentées
- Affichage des prises comme **marqueurs colorés** par espèce (couleurs depuis `SPECIES_CONFIG`)
- **Barre de filtres** horizontale scrollable : Espèce, Leurre, Plage de dates, Météo
- **Toggle satellite** / carte standard
- **Callout au clic** sur un marqueur → affiche espèce, leurre, poids, date
- **Région calculée dynamiquement** pour englober tous les pins
- Données chargées depuis Supabase ou cache si hors-ligne

### Fonctionnalités prévues mais non implémentées ❌
- Clustering des marqueurs (regroupement au dézoom)
- Couche bathymétrique (GeoJSON du MELCC)
- Légende de profondeur
- Barre de recherche de lac
- Cartes par lac avec statistiques
- MapBox Offline Packs (remplacé à terme par react-native-maps offline)

---

## 🧭 Voyages de pêche ✅ NOUVEAU (non prévu à l'origine)

### Description
Module de planification et suivi de sorties de pêche. Permet d'organiser une sortie avant de partir, puis d'y associer les prises en temps réel.

### Écrans
- **`app/(tabs)/trip.tsx`** — Onglet "Voyage" (icône bateau)
  - Si voyage actif : affiche les infos + bouton "Logguer une prise" + "Terminer le voyage"
  - Si pas de voyage actif : bouton "Planifier un nouveau voyage" + historique
  - Historique : 20 derniers voyages avec option "Relancer ce voyage"
- **`app/plan-trip.tsx`** — Formulaire de planification (modal stack)
  - Lacs cibles (multi-entrée)
  - Compagnons (suggestions depuis `loadFrequentCompanions()`)
  - Espèces cibles par lac
  - Leurres prévus (LurePicker)
  - Notes libres

### Persistance
- `lib/tripStorage.ts` — AsyncStorage (local uniquement, pas dans Supabase)
- Types : `Trip`, `TripLake`, `LastCatchSettings`
- Fonctions : `saveActiveTrip`, `loadActiveTrip`, `endActiveTrip`, `loadTripHistory`, `savePrefillTrip`, `loadPrefillTrip`, `addFrequentCompanions`, `loadFrequentCompanions`
- Les voyages ne sont **pas** synchronisés avec Supabase (à implémenter si besoin)

---

## 📊 Statistiques et visualisation ✅ IMPLÉMENTÉ (plus complet que prévu)

### KPI Cards
- Total prises, Lacs visités, Espèces différentes, Record de poids (lb)

### Graphiques et tableaux
- **Prises par mois** — 12 derniers mois, barres verticales
- **Par espèce** — Barres horizontales avec nombre
- **Meilleurs leurres** — Top 7, barres horizontales
- **Par heure de la journée** — Distribution des prises (Matin/Midi/Après-midi/Soir)
- **Distribution de profondeur** — En mètres
- **Records** : prise la plus lourde, plus longue, total trophées, meilleure journée

### Filtres (chips horizontaux scrollables)
- Période : 7 jours, 30 jours, cette année, tout
- Par espèce (si >1 espèce dans les données)
- Par lac (si >1 lac dans les données)

### Données
- Depuis Supabase en mode connecté
- Depuis `catchCache.ts` (AsyncStorage) en mode hors-ligne
- ~~WatermelonDB~~ → remplacé par AsyncStorage cache

---

## 🤝 Partage de cartes ❌ PAS ENCORE IMPLÉMENTÉ

### 3 niveaux de partage prévus
| Niveau | Description | Implémentation |
|--------|------------|----------------|
| Par lac | Toutes les prises d'un lac spécifique | Filtre sur `lake_name` + invitation |
| Par région | Une région entière (ex: Saguenay-Lac-Saint-Jean) | Bounding box géographique |
| Tout | Toutes les données de l'utilisateur | Export complet |

### Mécanisme prévu
- Génération de lien/code de partage unique
- Permissions : lecture seule OU lecture + écriture
- Sur la carte : toggle entre ses données et les cartes reçues
- Sécurisé par Row Level Security dans Supabase (tables `maps`, `shares` non créées)

> **Note**: L'onglet "Partage" du design original est absent. À l'heure actuelle il n'y a pas de remplacement prévu à court terme.

---

## 📡 Connexion sonar Bluetooth ❌ PAS ENCORE IMPLÉMENTÉ

### Objectif
Connecter l'app à un sonar de pêche portable via Bluetooth pour obtenir :
- La **profondeur** en temps réel (ajoutée automatiquement au formulaire)
- La possibilité de créer des **waypoints** avec profondeur

### Technologie prévue
- `react-native-ble-plx` pour le Bluetooth Low Energy
- Protocole GATT spécifique au modèle de sonar
- Commencer par supporter le **Deeper PRO+** (le plus populaire)

### Flux prévu
1. Dans Réglages > Sonar Bluetooth, l'utilisateur scanne les appareils
2. Il se connecte au sonar
3. La profondeur s'affiche en temps réel dans le formulaire de saisie
4. Badge "Sonar: 4.2m" dans les champs automatiques

> **Note**: `lib/hooks/useSonar.ts` n'existe pas encore.

---

## 📴 Mode hors-ligne ⚠️ PARTIEL

### Principe
L'app doit fonctionner **à 100%** sans connexion internet. C'est non-négociable pour la pêche en régions éloignées.

### Architecture actuelle (implémentée)

#### 1. Détection de connexion ✅
- `lib/hooks/useNetworkStatus.ts` via `@react-native-community/netinfo`
- Retourne `boolean | null` (true = en ligne, false = hors-ligne, null = inconnu)
- `ConnectionBadge.tsx` affiche le statut en temps réel
- `SyncManager` dans `app/_layout.tsx` déclenche la sync quand connexion rétablie

#### 2. Cache de données ✅
- `lib/catchCache.ts` — sauvegarde les prises Supabase dans AsyncStorage
- Clé : `catches_cache_{userId}_v1`
- Utilisé comme fallback sur l'accueil, la carte et les stats

#### 3. File d'attente de prises ✅
- `lib/offlineSync.ts`
- `enqueueOfflineCatch()` — met en file si insert Supabase échoue
- `trySyncOfflineCatches()` — tente l'envoi quand connexion rétablie
- Clé AsyncStorage : `offline_catches_queue_v1`
- **Limitation** : les photos/médias ne sont pas inclus dans la file

#### 4. Voyages ✅
- `lib/tripStorage.ts` — AsyncStorage, fonctionne 100% hors-ligne

### Architecture prévue mais non implémentée ❌

#### WatermelonDB (remplacé temporairement par AsyncStorage)
- `@nozbe/watermelondb` est installé dans `package.json` mais **jamais instancié**
- La base SQLite locale n'est pas configurée
- La sync bidirectionnelle complète (pull Supabase → local) n'est pas faite
- À implémenter pour remplacer le cache AsyncStorage actuel

#### Cartes hors-ligne
- MapBox Offline Packs → non applicable (on utilise react-native-maps)
- Alternative à étudier : tuiles OpenStreetMap téléchargées localement

#### Météo précachée
- Pas de précachage de prévisions avant une sortie
- Actuellement : si hors-ligne, pas de données météo dans le formulaire

### Indicateurs UI actuels
- `ConnectionBadge` affiché dans les écrans (pas de bannière orange comme prévu)
- Compteur de prises en attente : accessible via `getOfflineQueueCount()` (non affiché dans les réglages)

---

## ⚙️ Réglages ⚠️ PARTIEL

### État actuel (`app/(tabs)/settings.tsx`)
- **Profil** : affiche l'email de l'utilisateur ✅
- **Langue** : UI présente (FR/EN) mais non fonctionnel ❌
- **Unités** : UI présente (°C/°F, lb/kg, po/cm) mais non fonctionnel ❌
- **Couleurs des espèces** : UI de personnalisation présente, persistée via `useSpeciesColors` ✅
- **Déconnexion** : bouton fonctionnel ✅

### Sections prévues non implémentées ❌
1. **Préconfiguration rapide** — Espèces et leurres favoris, lacs fréquentés
2. **Sonar Bluetooth** — Toggle + scan d'appareils BLE
3. **Cartes hors-ligne** — Gestion des régions téléchargées
4. **Données en attente de sync** — Compteur de la file offline

---

## 🗂 Catalogues de données ✅ IMPLÉMENTÉ

### Espèces — `lib/species.ts`
11 espèces québécoises configurées dans `SPECIES_CONFIG` :
- Doré jaune, Brochet, Brochet du nord, Truite mouchetée, Truite arc-en-ciel
- Touladi, Achigan à grande bouche, Achigan à petite bouche, Maskinongé, Perchaude
- "Site prometteur" (entrée spéciale sans poisson)

Chaque espèce a : `color`, `bgColor`, `code` (2 lettres), `photoUrl` (Wikimedia)

Fonctions : `getSpeciesConfig(species)`, `getSpeciesColor(species)`

### Leurres — `lib/lures.ts`
~80 leurres dans `LURES_CATALOG`, organisés en 8 catégories :
- Cuillère tournante, Cuillère ondulante, Poisson nageur, Surface
- Jig, Leurre souple, Mouche, Naturel

Chaque leurre a : `id`, `name`, `brand`, `category`, `color`, `bgColor`, `emoji`, `photoUrl`

Fonctions : `getLureById(id)`, `getLureByName(name)`, `filterLures(query, category)`

---

## 🏗 Architecture des fichiers (état actuel)

```
PecheLog/
├── app/
│   ├── (tabs)/
│   │   ├── index.tsx          # ✅ Accueil — météo, stats résumé, prises récentes
│   │   ├── map.tsx            # ✅ Carte native (react-native-maps)
│   │   ├── map.web.tsx        # ⚠️ Carte web (react-leaflet, partiel)
│   │   ├── stats.tsx          # ✅ Statistiques complètes
│   │   ├── trip.tsx           # ✅ Voyages de pêche (NOUVEAU)
│   │   ├── settings.tsx       # ⚠️ Réglages (UI partielle)
│   │   └── _layout.tsx        # ✅ 5 onglets : Accueil, Carte, Stats, Voyage, Réglages
│   ├── log-catch.tsx          # ✅ Formulaire de saisie rapide
│   ├── catch-detail.tsx       # ✅ Détail d'une prise
│   ├── plan-trip.tsx          # ✅ Planifier un voyage (NOUVEAU)
│   ├── login.tsx              # ✅ Écran de login OAuth
│   ├── modal.tsx              # Route modale générique
│   ├── auth/callback.tsx      # ✅ Callback OAuth (web)
│   └── _layout.tsx            # ✅ Layout + AuthProvider + SyncManager
├── components/
│   ├── LurePicker.tsx         # ✅ Sélecteur de leurre modal (NOUVEAU)
│   ├── ConnectionBadge.tsx    # ✅ Badge statut réseau (remplace OfflineBanner)
│   ├── LocationPickerMap.tsx  # ✅ Carte pour choisir un point GPS
│   ├── LocationPickerMap.web.tsx  # ✅ Version web
│   ├── StaticMapView.tsx      # ✅ Carte en lecture seule (NOUVEAU)
│   ├── StaticMapView.web.tsx  # ✅ Version web
│   ├── Themed.tsx             # ✅ Text/View thématisés
│   ├── StyledText.tsx         # ✅ Composants typographie
│   └── ExternalLink.tsx       # ✅ Lien web safe
│   # ❌ NON CRÉÉS : CatchCard, ChipSelector, SizeToggle, MapMarker, StatBar, PhotoPicker
├── lib/
│   ├── supabase.ts            # ✅ Client Supabase (URL hardcodée)
│   ├── theme.ts               # ✅ Couleurs, typographie, spacing, radius, shadows
│   ├── species.ts             # ✅ Catalogue 11 espèces (NOUVEAU)
│   ├── lures.ts               # ✅ Catalogue ~80 leurres (NOUVEAU)
│   ├── offlineSync.ts         # ✅ File d'attente offline (NOUVEAU)
│   ├── catchCache.ts          # ✅ Cache AsyncStorage des prises (NOUVEAU)
│   ├── tripStorage.ts         # ✅ Persistance voyages (NOUVEAU)
│   ├── hooks/
│   │   ├── useLocation.ts     # ✅ GPS + reverse geocoding Nominatim
│   │   ├── useWeather.ts      # ✅ OpenWeatherMap (EXPO_PUBLIC_OPENWEATHER_API_KEY)
│   │   ├── useNetworkStatus.ts# ✅ NetInfo (remplace useOffline.ts)
│   │   └── useSpeciesColors.ts# ✅ Couleurs custom espèces (NOUVEAU)
│   │   # ❌ NON CRÉÉS : useAuth.ts (dans contexts/), useSonar.ts, useOffline.ts
│   └── utils/
│       # ❌ NON CRÉÉS : geocoding.ts (inline dans useLocation), formatting.ts
│   # ❌ NON CRÉÉ : types.ts (types définis inline dans chaque fichier)
│   # ❌ NON CRÉÉ : lib/offline/ (WatermelonDB non configuré)
├── contexts/
│   └── AuthContext.tsx        # ✅ Auth globale avec useAuth()
├── assets/                    # Images, fonts
├── CLAUDE.md                  # Ce fichier
├── DATABASE.md                # Schéma SQL complet
└── prototype/
    └── PecheLog-Prototype.html # Prototype de référence
```

---

## 📦 Dépendances clés (`package.json`)

| Paquet | Version | Usage |
|--------|---------|-------|
| expo | 54.0.33 | Framework principal |
| react / react-native | 19.1.0 / 0.81.5 | UI |
| expo-router | — | Navigation fichiers |
| @supabase/supabase-js | 2.95.3 | Backend + Auth |
| react-native-maps | — | Carte native |
| react-leaflet / leaflet | — | Carte web (partiel) |
| @react-native-async-storage/async-storage | — | Persistance locale |
| @react-native-community/netinfo | — | Détection réseau |
| @nozbe/watermelondb | 0.28.0 | **Installé mais non utilisé** |
| expo-location | — | GPS |
| expo-image-picker | — | Photos/vidéos |
| expo-camera | — | Caméra |
| react-native-reanimated | — | Animations |

---

## 🗄 Schéma Supabase (tables utilisées)

### `catches`
```sql
id, user_id, map_id, species, lure,
latitude, longitude, lake_name,
depth_meters, depth_source (manual|sonar|bathymetric|null),
temperature_c, wind_speed_kmh, wind_direction_deg, speed_kmh,
weather_conditions,
size_category (small|medium|large|trophy), weight_lbs, length_inches,
notes, caught_at, created_at
```

### `profiles`
```sql
id (= auth.uid), display_name, email
```

### Tables non encore créées ❌
- `maps` — pour le partage de cartes
- `shares` — permissions de partage (RLS)

---

## 🌐 Variables d'environnement

| Variable | Obligatoire | Usage |
|----------|------------|-------|
| `EXPO_PUBLIC_OPENWEATHER_API_KEY` | Oui | `useWeather.ts` |

> **Note**: Les credentials Supabase (URL + anon key) sont hardcodés dans `lib/supabase.ts`. À migrer vers des variables d'environnement pour la production.

---

## 📋 État d'avancement et prochaines étapes

### ✅ Complété
1. Setup Expo + Supabase + thème + catalogues espèces/leurres
2. Auth OAuth complet (Google, Apple, Facebook + email/password)
3. Écran d'accueil avec météo, stats résumé, prises récentes
4. Formulaire de saisie rapide (GPS, météo, espèce, leurre, photos)
5. Carte interactive avec filtres (espèce, leurre, date, météo)
6. Statistiques complètes (7 vues de données, filtres, records)
7. Voyages de pêche (planification + suivi + historique) — **fonctionnalité ajoutée**
8. Mode hors-ligne de base (cache + file d'attente)
9. Synchronisation automatique au retour du signal

### ⚠️ En cours / Partiel
10. Réglages — UI présente, persistance des préférences manquante
11. Mode hors-ligne complet — WatermelonDB à activer
12. Carte web — react-leaflet partiellement intégré

### ❌ Pas encore commencé
13. Partage de cartes entre utilisateurs
14. Sonar Bluetooth (Deeper PRO+)
15. Couche bathymétrique (MELCC)
16. Cartes hors-ligne (tuiles téléchargées)
17. Central `lib/types.ts` (types actuellement inline)
18. Préférences unités (°C/°F, lb/kg, po/cm) fonctionnelles
19. Upload médias dans la file offline
20. Publication EAS + soumission stores
