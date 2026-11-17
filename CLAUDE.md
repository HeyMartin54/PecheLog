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

### Enregistrement : local d'abord (un seul chemin, avec ou sans réseau)
- Toute prise est d'abord écrite dans la file locale via `enqueueCatch()` (clé `offline_catches_queue_v1`), puis envoyée à Supabase en arrière-plan par le moteur de synchronisation. **Aucun écran ne fait d'insert direct.**
- L'`id` de la prise est un UUID créé sur l'appareil (`lib/uuid.ts`) : un envoi rejoué ne peut pas créer de doublon.
- Si l'écriture locale échoue, une erreur est affichée et le formulaire reste ouvert (jamais de faux « enregistré »).
- Les photos/médias sont copiés localement (`persistMediaForOffline`) et envoyés par la synchronisation ; un envoi en échec est réessayé ✅
- La météo manquante est complétée après l'envoi (Open-Meteo historique) ✅
- Sans position GPS, la prise peut être placée à la main sur la carte.

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
- **Cadrage initial** sur l'ensemble des prises, une seule fois ; ensuite la caméra appartient à l'utilisateur (bouton « tout voir » pour recadrer)
- Données lues dans le magasin local (`useCatches()`) : marqueurs affichés immédiatement, **y compris les prises pas encore synchronisées** ; la mise à jour serveur se fait en arrière-plan sans bloquer la carte
- Web : feuille de style Leaflet embarquée dans le bundle (aucun CDN)

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
- Local d'abord : `loadActiveTrip()` / `loadTripHistory()` lisent AsyncStorage et ne font **jamais** de requête réseau. Toute modification est écrite localement, marquée « à pousser », puis envoyée en arrière-plan.
- `refreshTripsFromServer()` pousse d'abord les changements locaux, puis récupère ceux d'un autre appareil (un voyage terminé hors-ligne ne « ressuscite » pas).

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

## 📴 Mode hors-ligne ✅ « LOCAL D'ABORD »

### Principe
L'app doit fonctionner **à 100%** sans connexion internet. C'est non-négociable pour la pêche en régions éloignées.

Le cas à ne jamais oublier est le **signal faible** : le téléphone se dit connecté, mais rien ne passe. L'app ne décide donc jamais « en ligne ou hors-ligne » pour choisir d'où lire : **elle lit toujours localement**, et parle au serveur en arrière-plan.

```
écran ──lit───▶ lib/catchStore.ts ──▶ cache serveur (AsyncStorage) + file d'attente
écran ──écrit─▶ lib/offlineQueue.ts (file, verrou) ──▶ lib/offlineSync.ts ──▶ Supabase
                                          ▲
                               lib/syncEngine.ts (QUAND synchroniser)
```

### Règles (à respecter dans tout nouveau code)
1. **Lire les prises** : `useCatches()` (`lib/hooks/useCatches.ts`). Ne jamais interroger `catches` depuis un écran.
2. **Enregistrer une prise** : `enqueueCatch()`. Ne jamais faire d'insert direct depuis un écran.
3. **Qui est l'utilisateur hors-ligne** : `useAuth().cachedUserId`. Ne pas appeler `supabase.auth.getSession()` pour cela : avec un jeton expiré elle tente un rafraîchissement réseau (~30 s de réessais).
4. **Tout appel réseau a un timeout.** Les appels Supabase l'ont d'office (`supabaseFetch`) ; les autres passent par `fetchWithTimeout` / `withTimeout` de `lib/net.ts`.
5. **Aucun indicateur de chargement ne doit dépendre du réseau** : afficher les données locales, rafraîchir ensuite.
6. La garde `isFocused` de `app/login.tsx` ne doit pas être retirée (voir « Pièges »).

### Modules

| Fichier | Rôle |
|---------|------|
| `lib/net.ts` | `isOnline()` = internet utilisable (enrichissements facultatifs) ; `mayReachNetwork()` = un réseau existe (la synchro tente quand même) ; `withTimeout`, `fetchWithTimeout`, `isNetworkError` |
| `lib/supabase.ts` | `supabaseFetch` : timeout sur chaque requête + refus local des requêtes de données sans session ; `readStoredAuthUser()` (identité locale, sans réseau) |
| `lib/uuid.ts` | UUID créé sur l'appareil = clé primaire de la prise |
| `lib/offlineQueue.ts` | File d'attente : chaque modification relit et réécrit sous verrou ; migration de l'ancien format ; médias locaux |
| `lib/offlineSync.ts` | Un passage de synchro : prise → médias → météo. Erreur réseau = arrêt, on réessaiera. Refus du serveur = élément « bloqué », conservé et visible dans Réglages |
| `lib/syncEngine.ts` | Déclencheurs : changement réseau, retour au premier plan, ajout à la file, session disponible, réessais 15 s → 5 min |
| `lib/catchStore.ts` | Source unique des prises (cache serveur + file d'attente), rafraîchie en arrière-plan |
| `lib/catchCache.ts` | Cache AsyncStorage des prises (`catches_cache_{userId}`) |
| `lib/tripStorage.ts`, `lib/lureStorage.ts` | Voyages et leurres : lecture locale, envoi différé |

### Authentification et hors-ligne
`useAuth().sessionStatus` :
- `active` — session valide
- `restoring` — utilisateur connu, jeton expiré pas encore rafraîchi (typique hors-ligne) : l'app est pleinement utilisable en local
- `expired` — session définitivement perdue : l'app reste utilisable en local, un bandeau invite à se reconnecter
- `signedOut` — personne de connu sur l'appareil → écran de login

`cachedUserId` n'est effacé que par une déconnexion explicite.

### Pièges connus
- **L'écran de login reste monté sous les onglets** (route initiale de la pile). Une redirection sans garde `isFocused` s'y exécutait à chaque rafraîchissement du jeton et fermait l'écran ouvert (formulaire de prise en cours).
- **Requête sans jeton valide** : le RLS répond « 0 ligne » sans erreur. `supabaseFetch` refuse ces requêtes ; sinon la liste vide écraserait le cache.
- **Joignabilité rapportée par l'OS** : fausse quelques secondes au retour du réseau. La synchro se base sur la présence d'un réseau, pas sur ce drapeau.
- **Blob + FormData** : inutilisable sur React Native. L'envoi de fichiers passe par `expo-file-system` (`lib/uploadMedia.ts`).

### Tests
- `npm test` — tests Jest de la file, de la synchronisation, du moteur, du magasin, des voyages, des leurres, du client Supabase, de l'envoi natif des photos et de l'écran de carte natif (`__tests__/`).
- `e2e/` — scénario navigateur contre un faux serveur Supabase : en ligne → serveur injoignable → redémarrage → retour du réseau (voir l'en-tête de `e2e/offline-scenario.mjs`).

### Non implémenté ❌
- **Fond de carte hors-ligne** : les marqueurs s'affichent toujours, mais les tuiles dépendent de ce que Google/Apple Maps a gardé en mémoire. Une vraie carte hors-ligne demande un fournisseur de tuiles (les conditions d'OpenStreetMap interdisent le téléchargement en masse).
- **Modifier / supprimer / dupliquer une prise déjà synchronisée** exige le réseau (lecture seule hors-ligne). Une prise en attente peut être supprimée.
- **Web** : pas de service worker (la page ne se recharge pas sans réseau).
- **WatermelonDB** : installé mais non utilisé ; AsyncStorage couvre les besoins actuels.
- **Météo précachée** avant une sortie.

### Indicateurs UI
- `ConnectionBadge` : « En ligne » seulement si internet est réellement utilisable
- `SyncStatusBanner` (accueil) : prises en attente (appui = synchroniser) et session expirée
- Badge « En attente » sur les prises non synchronisées (accueil, carte, détail)
- Réglages > Synchronisation : compteurs, résultat réel du dernier envoi, éléments refusés ✅

---

## ⚙️ Réglages ✅ IMPLÉMENTÉ

### État actuel (`app/(tabs)/settings.tsx`)
- **Profil** : affiche l'email de l'utilisateur ✅
- **Langue** : FR/EN fonctionnel — i18n complet de l'interface via `lib/i18n.ts` + `useSettings().t()` ✅
  - Les **données** (noms d'espèces, leurres, lacs, conditions météo stockées) restent en français — ne jamais les traduire
- **Unités** : °C/°F, lb/kg, po/cm fonctionnelles sur tous les écrans (accueil, stats, carte, formulaire, détail) ✅
  - Stockage canonique inchangé (°C, lb, pouces) — conversion à l'affichage ET à la saisie via `lib/settingsStorage.ts`
  - Sync best-effort vers `profiles.units_*` ; pull au premier lancement sur un nouvel appareil
- **Synchronisation** : prises et médias en attente (mis à jour en direct), bouton « Synchroniser maintenant » avec le résultat réel, éléments refusés par le serveur, avertissement avant déconnexion s'il reste des prises non envoyées ✅
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
│   └── _layout.tsx            # ✅ Layout + AuthProvider + SettingsProvider + SyncManager (branche le moteur de synchro)
├── components/
│   ├── LurePicker.tsx         # ✅ Sélecteur de leurre modal
│   ├── LureFormModal.tsx      # ✅ Création/édition de leurre (photo incluse)
│   ├── SpeciesDetailModal.tsx # ✅ Création/édition d'espèce custom
│   ├── ConnectionBadge.tsx    # ✅ Badge statut réseau
│   ├── SyncStatusBanner.tsx   # ✅ Bandeau prises en attente / session expirée
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
│   ├── net.ts                 # ✅ fetchWithTimeout / isOnline / mayReachNetwork / withTimeout (OBLIGATOIRES)
│   ├── locationSafe.ts        # ✅ getPositionSafe (OBLIGATOIRE, jamais getCurrentPositionAsync brut)
│   ├── uuid.ts                # ✅ UUID créé sur l'appareil (clé primaire des prises)
│   ├── offlineQueue.ts        # ✅ File d'attente des prises (verrou, médias locaux)
│   ├── offlineSync.ts         # ✅ Envoi de la file vers Supabase (idempotent)
│   ├── syncEngine.ts          # ✅ Déclenchement de la synchronisation
│   ├── catchStore.ts          # ✅ Magasin local des prises (source unique des écrans)
│   ├── catchCache.ts          # ✅ Cache AsyncStorage des prises
│   ├── tripStorage.ts         # ✅ Voyages : lecture locale, envoi différé
│   ├── uploadMedia.ts / uploadLureMedia.ts  # ✅ Envoi vers Supabase Storage (natif en flux)
│   ├── hooks/
│   │   ├── useLocation.ts     # ✅ GPS + reverse geocoding Nominatim
│   │   ├── useWeather.ts      # ✅ OpenWeatherMap (EXPO_PUBLIC_OPENWEATHER_API_KEY)
│   │   ├── useNetworkStatus.ts# ✅ NetInfo (« en ligne » = internet utilisable)
│   │   ├── useCatches.ts      # ✅ Prises de l'utilisateur (magasin local) — À UTILISER dans les écrans
│   │   ├── useSpeciesColors.ts# ✅ Couleurs custom espèces
│   │   ├── useActiveSpecies.ts# ✅ Espèces actives de l'utilisateur
│   │   └── useCustomSpecies.ts# ✅ Espèces personnalisées
│   │   # ❌ NON CRÉÉ : useSonar.ts (matériel requis)
├── contexts/
│   ├── AuthContext.tsx        # ✅ Auth globale avec useAuth()
│   └── SettingsContext.tsx    # ✅ useSettings() — langue, unités, t(), fmt* (NOUVEAU)
├── assets/                    # Images, fonts
├── __tests__/                 # ✅ Tests Jest (npm test)
├── e2e/                       # ✅ Scénario navigateur + faux serveur Supabase
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
| jest / jest-expo (dev) | 29 / 54 | Tests (`npm test`) |
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

| `EXPO_PUBLIC_GOOGLE_MAPS_KEY` | Oui (Android) | Carte native (`app.config.js`) |
| `EXPO_PUBLIC_SUPABASE_URL` | Non | Remplace l'URL Supabase par défaut (tests, autre projet) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Non | Remplace la clé publique par défaut |

> **Note**: Les valeurs Supabase par défaut (URL + clé publique) sont dans `lib/supabase.ts` ; les deux variables ci-dessus permettent de les remplacer sans toucher au code.

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
8. Mode hors-ligne « local d'abord » : magasin local des prises, file d'attente protégée, médias, météo rétroactive
9. Synchronisation idempotente, relancée au retour du signal, au premier plan et par réessais + sync manuelle dans Réglages
10. Réglages fonctionnels : langue FR/EN (i18n complet), unités °C/°F lb/kg po/cm
11. Central `lib/types.ts` (types partagés consolidés)
12. Gestion leurres personnels + espèces custom (couleurs, actives/inactives)
13. **Partage de cartes par zones** — dessin de polygone nommé, code d'invitation, prises de la
    zone visibles par les destinataires, bascule ma carte / zones reçues (natif + web).
    ⚠️ SQL de DATABASE.md (`shared_zones`, `zone_shares`, RPC) à exécuter dans Supabase.

### ❌ Pas encore commencé (et pourquoi)
14. Sonar Bluetooth (Deeper PRO+) — nécessite `react-native-ble-plx` (non installé), un dev build EAS et le matériel pour tester
15. Couche bathymétrique (MELCC) — nécessite les données GeoJSON externes
16. Fond de carte hors-ligne (tuiles téléchargées) — demande un fournisseur de tuiles et des essais sur appareil
17. WatermelonDB — installé mais non activé ; le cache AsyncStorage couvre les besoins actuels
18. Publication EAS + soumission stores
