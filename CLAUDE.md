# CLAUDE.md — PêcheLog : Spécifications complètes du projet

> Ce fichier contient toutes les spécifications et décisions prises pour le projet PêcheLog.
> Il sert de contexte pour Claude Code ET pour Cursor AI.
> Mis à jour : Juin 2026 — **État réel du code inclus (✅ Implémenté / ⚠️ Partiel / ❌ Pas encore)**

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
- Si hors-ligne (vérifié AVANT l'insert) ou si l'insert Supabase échoue → catch mis en file `offline_catches_queue_v1` (AsyncStorage)
- Sync automatique déclenchée quand connexion rétablie (`SyncManager` dans `app/_layout.tsx`)
- Les photos/médias **sont inclus** dans la file offline (copiés localement via `persistMediaForOffline`, uploadés à la sync) ✅
- La météo manquante est récupérée rétroactivement (Open-Meteo historique) lors de la sync ✅

### Préconfiguration depuis Voyage
- Le dernier espèce/leurre utilisé est sauvegardé via `saveLastCatchSettings()` dans `tripStorage.ts`
- Pré-remplit le formulaire au prochain lancer depuis un voyage actif

---

## 🗺 Carte interactive ✅ IMPLÉMENTÉ

### Bibliothèque utilisée
- **`react-native-maps`** (Apple Maps / Google Maps) — **pas MapBox**
- Web : `react-leaflet` + `leaflet` (intégration partielle, fichier `map.web.tsx`)

### Fonctionnalités implémentées
- Affichage des prises comme **marqueurs colorés** par espèce (couleurs custom via `useSpeciesColors`)
- **Clustering des marqueurs** au dézoom (natif ET web, segments bicolores multi-espèces) ✅
- **Barre de filtres** horizontale scrollable : 🔍 Recherche de lac, Espèce, Leurre, Plage de dates, Météo
- **Recherche de lac** — cherche parmi les lacs des prises de l'utilisateur (fonctionne hors-ligne) et centre la carte sur le lac choisi ✅
- **Toggle satellite** / carte standard
- **Callout au clic** sur un marqueur → affiche espèce, leurre, poids, date
- **Région calculée dynamiquement** pour englober tous les pins
- Données chargées depuis Supabase ou cache si hors-ligne

### Fonctionnalités prévues mais non implémentées ❌
- Couche bathymétrique (GeoJSON du MELCC — nécessite des données externes)
- Légende de profondeur
- Cartes par lac avec statistiques
- Tuiles hors-ligne (MapBox Offline Packs non applicable avec react-native-maps)

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
- `lib/tripStorage.ts` — AsyncStorage (cache local) + **sync Supabase** (table `trips`) ✅
- Types : `Trip`, `TripLake`, `LastCatchSettings`
- Fonctions : `saveActiveTrip`, `loadActiveTrip`, `endActiveTrip`, `loadTripHistory`, `deleteTripFromHistory`, `syncLocalTripsToSupabase`, `savePrefillTrip`, `loadPrefillTrip`, `addFrequentCompanions`, `loadFrequentCompanions`
- Offline-first : créés/terminés hors-ligne dans AsyncStorage, poussés vers Supabase au retour du signal (voir pièges dans la mémoire projet)

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

## 🤝 Partage de cartes par zones ✅ IMPLÉMENTÉ

### Principe
L'utilisateur **dessine une zone** (polygone) sur sa carte, lui donne un **nom**, et obtient un
**code d'invitation**. Toute prise située à l'intérieur de la zone est partagée avec les
utilisateurs qui rejoignent la zone avec ce code. Le destinataire bascule entre **sa carte**
et les **zones reçues** via le panneau « Zones » de la carte.

### Flux utilisateur
1. Carte > bouton **📐 Zones** > « ✏️ Dessiner une zone »
2. Mode dessin : chaque touche sur la carte ajoute un sommet (min. 3) — annuler / défaire / terminer
3. Nommer la zone → création dans Supabase → code d'invitation affiché
4. « Partager » envoie le code (Share natif / clipboard sur web)
5. Le destinataire entre le code dans « Rejoindre une zone » → la zone apparaît dans ses sources
6. En sélectionnant une zone reçue : polygone affiché + prises du propriétaire dans la zone
   (marqueurs/clusters habituels, callout **sans** navigation vers le détail)

### Sécurité (côté serveur — SQL dans DATABASE.md, à exécuter dans Supabase)
- Tables `shared_zones` (polygone JSONB + invite_code) et `zone_shares` (adhésions), RLS strict
- `redeem_zone_code(code)` — RPC SECURITY DEFINER : seule façon de rejoindre une zone
- `get_zone_catches(zone_id)` — RPC SECURITY DEFINER : vérifie l'adhésion puis ne retourne
  QUE les prises du propriétaire **strictement à l'intérieur** du polygone (`point_in_polygon` en plpgsql)
- Le destinataire peut quitter ; le propriétaire peut supprimer la zone (cascade sur les adhésions)

### Côté client
- `lib/zones.ts` — `loadZones`, `createZone`, `deleteZone`, `leaveZone`, `redeemZoneCode`,
  `fetchZoneCatches`, `pointInPolygon` (même ray-casting que le SQL) + cache AsyncStorage
- Ma propre zone sélectionnée = filtrage **local** de mes prises (fonctionne hors-ligne) ;
  zone reçue = RPC (avec cache du dernier résultat pour la lecture hors-ligne)
- Implémenté sur **les deux cartes** : `map.tsx` (react-native-maps `Polygon`) et `map.web.tsx` (Leaflet)

> ⚠️ **Prérequis** : exécuter le bloc SQL `shared_zones` / `zone_shares` / fonctions de DATABASE.md
> dans Supabase > SQL Editor avant d'utiliser la fonctionnalité.

---

## 📤 Partage d'une prise ✅ IMPLÉMENTÉ

### Principe
Depuis le détail d'une prise (`app/catch-detail.tsx`), le bouton **« 📤 Partager cette prise »**
ouvre un modal avec un **aperçu de carte visuelle** (branding PêcheLog, photo, espèce, taille,
lac, date, leurre, météo) et deux actions :
- **Partager l'image** (mobile) — la carte est capturée en PNG via `react-native-view-shot`
  puis envoyée à la feuille de partage native via `expo-sharing`
- **Partager le texte** — message multi-lignes avec émojis via `Share` natif
  (web : `navigator.share`, sinon copie presse-papiers — même pattern que le partage de zones)

### Confidentialité
Les **coordonnées GPS ne sont jamais incluses par défaut** — un interrupteur
« Inclure les coordonnées GPS » (off par défaut) permet de les ajouter au texte
et à la carte. Le spot reste secret sauf choix explicite.

### Côté client
- `lib/shareCatch.ts` — `buildCatchShareMessage` (texte localisé FR/EN, unités selon
  préférences via `fmtWeight`/`fmtLength`/`fmtTemp`), `shareCatchText` (Share natif / web),
  helpers `formatSizeLine` / `formatWeatherLine` / `formatCaughtAt`
- `components/ShareCatchCard.tsx` — carte visuelle capturable (thème sombre, couleur d'espèce)
- Fonctionne aussi **hors-ligne** (prise chargée du cache) — partage texte, photo si locale

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
- `enqueueOfflineCatch()` — met en file si hors-ligne ou si insert Supabase échoue
- `trySyncOfflineCatches()` — tente l'envoi quand connexion rétablie (verrou anti-doublons)
- `persistMediaForOffline()` — copie les médias dans `offline_media/` pour upload différé ✅
- Enrichissement météo rétroactif (Open-Meteo) pour les prises capturées hors-ligne ✅
- Clé AsyncStorage : `offline_catches_queue_v1`

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
- Compteur de prises en attente affiché dans Réglages > Synchronisation, avec bouton « Synchroniser maintenant » ✅

---

## ⚙️ Réglages ✅ IMPLÉMENTÉ

### État actuel (`app/(tabs)/settings.tsx`)
- **Profil** : affiche l'email de l'utilisateur ✅
- **Langue** : FR/EN fonctionnel — i18n complet de l'interface via `lib/i18n.ts` + `useSettings().t()` ✅
  - Les **données** (noms d'espèces, leurres, lacs, conditions météo stockées) restent en français — ne jamais les traduire
- **Unités** : °C/°F, lb/kg, po/cm fonctionnelles sur tous les écrans (accueil, stats, carte, formulaire, détail) ✅
  - Stockage canonique inchangé (°C, lb, pouces) — conversion à l'affichage ET à la saisie via `lib/settingsStorage.ts`
  - Sync best-effort vers `profiles.units_*` ; pull au premier lancement sur un nouvel appareil
- **Synchronisation** : compteur de prises en attente + bouton « Synchroniser maintenant » ✅
- **Équipement** : Mes leurres (`my-lures.tsx`) + Espèces & marqueurs (`my-species.tsx`, couleurs custom) ✅
- **Déconnexion** : bouton fonctionnel ✅

### Sections prévues non implémentées ❌
1. **Sonar Bluetooth** — Toggle + scan BLE (nécessite `react-native-ble-plx`, dev build et matériel)
2. **Cartes hors-ligne** — Gestion des régions téléchargées

### Architecture des préférences
- `lib/settingsStorage.ts` — types (`AppSettings`), persistance AsyncStorage (`@pechelog_settings_v1`), conversions d'unités, sync profil
- `lib/i18n.ts` — dictionnaires FR/EN (`translate`, `dateLocale`)
- `contexts/SettingsContext.tsx` — `useSettings()` → `{ settings, updateSettings, t, locale, fmtTemp, fmtWeight, fmtLength }`
- **Convention** : tout nouvel écran doit utiliser `t()` pour ses chaînes UI et `fmt*()` pour afficher température/poids/longueur

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
│   │   ├── map.tsx            # ✅ Carte native (clustering, recherche de lac, filtres)
│   │   ├── map.web.tsx        # ✅ Carte web (react-leaflet — mêmes fonctionnalités)
│   │   ├── stats.tsx          # ✅ Statistiques complètes
│   │   ├── trip.tsx           # ✅ Voyages de pêche (prise rapide, historique)
│   │   ├── settings.tsx       # ✅ Réglages (langue, unités, sync, équipement)
│   │   └── _layout.tsx        # ✅ 5 onglets : Accueil, Carte, Stats, Voyage, Réglages
│   ├── log-catch.tsx          # ✅ Formulaire de saisie rapide
│   ├── catch-detail.tsx       # ✅ Détail d'une prise (édition complète)
│   ├── plan-trip.tsx          # ✅ Planifier un voyage
│   ├── my-lures.tsx           # ✅ Gestion des leurres personnels
│   ├── my-species.tsx         # ✅ Gestion espèces actives + couleurs marqueurs
│   ├── login.tsx              # ✅ Écran de login OAuth
│   ├── modal.tsx              # Route modale générique
│   ├── auth/callback.tsx      # ✅ Callback OAuth (web)
│   └── _layout.tsx            # ✅ Layout + AuthProvider + SettingsProvider + SyncManager
├── components/
│   ├── LurePicker.tsx         # ✅ Sélecteur de leurre modal
│   ├── LureFormModal.tsx      # ✅ Création/édition de leurre (photo incluse)
│   ├── SpeciesDetailModal.tsx # ✅ Création/édition d'espèce custom
│   ├── ConnectionBadge.tsx    # ✅ Badge statut réseau
│   ├── LocationPickerMap.tsx  # ✅ Carte pour choisir un point GPS (+ .web.tsx)
│   ├── StaticMapView.tsx      # ✅ Carte en lecture seule (+ .web.tsx)
│   ├── Themed.tsx / StyledText.tsx / ExternalLink.tsx
├── lib/
│   ├── supabase.ts            # ✅ Client Supabase (URL hardcodée)
│   ├── theme.ts               # ✅ Couleurs, typographie, spacing, radius, shadows
│   ├── types.ts               # ✅ Types partagés (CatchPayload, MediaItem, SizeCategory…)
│   ├── zones.ts               # ✅ Zones de partage (polygones, codes, RPC) (NOUVEAU)
│   ├── i18n.ts                # ✅ Dictionnaires FR/EN + translate() (NOUVEAU)
│   ├── settingsStorage.ts     # ✅ Préférences unités/langue + conversions (NOUVEAU)
│   ├── species.ts             # ✅ Catalogue 11 espèces
│   ├── lures.ts               # ✅ Catalogue ~80 leurres
│   ├── lureStorage.ts         # ✅ Leurres personnels (Supabase + cache)
│   ├── net.ts                 # ✅ fetchWithTimeout / isOnline / withTimeout (OBLIGATOIRES)
│   ├── locationSafe.ts        # ✅ getPositionSafe (OBLIGATOIRE, jamais getCurrentPositionAsync brut)
│   ├── offlineSync.ts         # ✅ File d'attente offline (médias + météo rétroactive)
│   ├── catchCache.ts          # ✅ Cache AsyncStorage des prises
│   ├── tripStorage.ts         # ✅ Persistance voyages (AsyncStorage + Supabase)
│   ├── uploadMedia.ts / uploadLureMedia.ts  # ✅ Upload Supabase Storage
│   ├── hooks/
│   │   ├── useLocation.ts     # ✅ GPS + reverse geocoding Nominatim
│   │   ├── useWeather.ts      # ✅ OpenWeatherMap (EXPO_PUBLIC_OPENWEATHER_API_KEY)
│   │   ├── useNetworkStatus.ts# ✅ NetInfo
│   │   ├── useSpeciesColors.ts# ✅ Couleurs custom espèces
│   │   ├── useActiveSpecies.ts# ✅ Espèces actives de l'utilisateur
│   │   └── useCustomSpecies.ts# ✅ Espèces personnalisées
│   │   # ❌ NON CRÉÉ : useSonar.ts (matériel requis)
├── contexts/
│   ├── AuthContext.tsx        # ✅ Auth globale avec useAuth()
│   └── SettingsContext.tsx    # ✅ useSettings() — langue, unités, t(), fmt* (NOUVEAU)
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
id (= auth.uid), display_name, avatar_url,
preferred_species[], preferred_lures[], preferred_lakes[],
units_temp (C|F), units_weight (lb|kg), units_length (in|cm)
```

### Autres tables (voir DATABASE.md)
- `trips` — voyages synchronisés ✅
- `user_lures` — leurres personnels ✅
- `catch_media` — photos/vidéos ✅
- `maps` / `map_shares` — définies dans DATABASE.md, **pas encore utilisées par le client** (partage à venir)

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
5. Carte interactive : filtres, clustering, recherche de lac (natif + web)
6. Statistiques complètes (7 vues de données, filtres, records)
7. Voyages de pêche (planification + prise rapide + historique + sync Supabase)
8. Mode hors-ligne (cache + file d'attente + médias + météo rétroactive)
9. Synchronisation automatique au retour du signal + sync manuelle dans Réglages
10. Réglages fonctionnels : langue FR/EN (i18n complet), unités °C/°F lb/kg po/cm
11. Central `lib/types.ts` (types partagés consolidés)
12. Gestion leurres personnels + espèces custom (couleurs, actives/inactives)
13. **Partage de cartes par zones** — dessin de polygone nommé, code d'invitation, prises de la
    zone visibles par les destinataires, bascule ma carte / zones reçues (natif + web).
    ⚠️ SQL de DATABASE.md (`shared_zones`, `zone_shares`, RPC) à exécuter dans Supabase.

### ❌ Pas encore commencé (et pourquoi)
14. Sonar Bluetooth (Deeper PRO+) — nécessite `react-native-ble-plx` (non installé), un dev build EAS et le matériel pour tester
15. Couche bathymétrique (MELCC) — nécessite les données GeoJSON externes
16. Cartes hors-ligne (tuiles téléchargées) — non supporté nativement par react-native-maps
17. WatermelonDB — installé mais non activé ; le cache AsyncStorage couvre les besoins actuels
18. Publication EAS + soumission stores
