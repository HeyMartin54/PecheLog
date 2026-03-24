# CLAUDE.md — PêcheLog : Spécifications complètes du projet

> Ce fichier contient toutes les spécifications et décisions prises pour le projet PêcheLog.
> Il sert de contexte pour Claude Code ET pour Cursor AI.
> Mis à jour : Février 2026

---

## 🎯 Vision du projet

PêcheLog est une application de journal de pêche intelligente qui permet aux pêcheurs de :
- Logger leurs prises en **1 clic** avec capture automatique des données (GPS, météo, lac, vitesse)
- Visualiser leurs données sur une **carte interactive** avec bathymétrie
- Analyser leurs **statistiques** de pêche (par espèce, leurre, lac, période)
- **Partager** leurs cartes et spots avec d'autres pêcheurs
- Fonctionner en **mode hors-ligne** complet (essentiel pour la pêche en région éloignée)

## 📱 Plateformes cibles

| Plateforme | Technologie | Notes |
|------------|------------|-------|
| Android    | React Native via Expo | Version principale |
| iOS        | React Native via Expo | Même codebase |
| Web        | Expo Web export | Accès navigateur, fonctions limitées |

Les 3 versions partagent le même code source (monorepo Expo).

---

## 🔐 Authentification

### Fournisseurs de login
- **Google** — OAuth via Supabase Auth (nécessite Google Cloud Console)
- **Apple** — Sign In with Apple via Supabase Auth (nécessite Apple Developer 99$/an)
- **Facebook** — OAuth via Supabase Auth (nécessite Meta for Developers)

### Flow
1. L'utilisateur choisit un fournisseur sur l'écran de login
2. Redirection OAuth vers le fournisseur
3. Retour dans l'app avec session Supabase
4. Création automatique du profil dans `profiles` si première connexion
5. AuthContext global maintient l'état de connexion dans toute l'app

---

## 📝 Formulaire de saisie rapide

### Philosophie
Le pêcheur est sur l'eau, potentiellement en train de gérer un poisson. La saisie doit être **la plus rapide possible**. Tout ce qui peut être automatisé l'est.

### Champs automatiques (badges verts dans l'UI)
| Champ | Source | Fonctionne hors-ligne? |
|-------|--------|----------------------|
| Coordonnées GPS | `expo-location` | ✅ Oui (GPS natif) |
| Nom du lac | Reverse geocoding OU base de lacs locale | ✅ Si base locale préchargée |
| Température °C | API OpenWeatherMap (précachée) | ✅ Si précachée |
| Date et heure | Horloge du téléphone | ✅ Toujours |
| Vitesse (km/h) | GPS du téléphone | ✅ Oui |
| Profondeur (m) | Sonar Bluetooth si connecté | ✅ Oui (Bluetooth local) |

### Champs manuels
| Champ | Type d'input | Notes |
|-------|-------------|-------|
| Espèce | Chips sélectionnables | Depuis les favoris préconfigurés en premier |
| Leurre | Chips sélectionnables | Depuis les favoris + option "Ajouter" |
| Profondeur | Numérique (mètres) | Pré-rempli par sonar si disponible, modifiable |
| Grosseur | Toggle 3 modes : P/M/G/Trophée OU poids (lb) OU longueur (po) | |
| Photos/vidéos | expo-image-picker | Optionnel, 1 ou plusieurs |
| Carte destination | Radio : personnelle / partagée / publique | |
| Notes | Textarea | Optionnel, texte libre |

### Préconfiguration (dans Réglages)
L'utilisateur peut préconfigurer ses valeurs fréquentes :
- **Espèces favorites** — Apparaissent en premier dans les chips
- **Leurres favoris** — Apparaissent en premier + possibilité d'en ajouter
- **Lacs fréquentés** — Pour la reconnaissance rapide hors-ligne

---

## 🗺 Carte interactive

### Fonctionnalités
- Affichage des prises comme **marqueurs colorés** sur la carte
- **Clustering** (regroupement) des marqueurs quand on dézoome
- **Barre de recherche** de lac en haut
- **Clic sur un marqueur** = détail de la prise
- **Couche bathymétrique** activable (GeoJSON des profondeurs)
- **Légende de profondeur** en bas à gauche
- **Cartes par lac** avec nombre de prises et espèces trouvées

### Bathymétrie
- Source : Ministère de l'Environnement du Québec (cartes bathymétriques publiques)
- Format : GeoJSON ou tuiles raster
- Affichage : Couche superposable sur la carte MapBox
- Dégradé de couleurs : bleu clair (0m) → bleu foncé (30m+)

### Mode hors-ligne cartes
- Utiliser MapBox Offline Packs pour télécharger des régions
- L'utilisateur choisit les régions à précharger dans Réglages
- Les tuiles sont stockées localement sur l'appareil

---

## 📊 Statistiques et visualisation

### Graphiques
- **Prises par mois** — Graphique en barres verticales
- **Meilleurs leurres** — Barres horizontales avec compteur
- **Par espèce** — Liste avec barre de progression et nombre

### Filtres (chips horizontaux scrollables)
- Période : 7 jours, 30 jours, cette année, tout
- Par lac
- Par leurre
- Par espèce

### Données
- Depuis Supabase en mode connecté
- Depuis WatermelonDB en mode hors-ligne
- Animations sur les barres au chargement

---

## 🤝 Partage de cartes

### 3 niveaux de partage
| Niveau | Description | Implémentation |
|--------|------------|----------------|
| Par lac | Toutes les prises d'un lac spécifique | Filtre sur `lake_name` + invitation |
| Par région | Une région entière (ex: Saguenay-Lac-Saint-Jean) | Bounding box géographique |
| Tout | Toutes les données de l'utilisateur | Export complet |

### Mécanisme
- Génération de lien/code de partage unique
- Permissions : lecture seule OU lecture + écriture
- Sur la carte : toggle entre ses données et les cartes reçues
- Sécurisé par Row Level Security dans Supabase

### Cartes reçues
- Liste des cartes partagées avec moi (nom du partageur, zone, nombre de prises)
- Bouton "Voir" pour afficher sur la carte

---

## 📡 Connexion sonar Bluetooth

### Objectif
Connecter l'app à un sonar de pêche portable via Bluetooth pour obtenir :
- La **profondeur** en temps réel (ajoutée automatiquement au formulaire)
- La possibilité de créer des **waypoints** avec profondeur

### Technologie
- `react-native-ble-plx` pour le Bluetooth Low Energy
- Protocole GATT spécifique au modèle de sonar
- Commencer par supporter le **Deeper PRO+** (le plus populaire)

### Flux
1. Dans Réglages > Sonar Bluetooth, l'utilisateur scanne les appareils
2. Il se connecte au sonar
3. La profondeur s'affiche en temps réel dans le formulaire de saisie
4. Badge "Sonar: 4.2m" dans les champs automatiques

---

## 📴 Mode hors-ligne (ARCHITECTURE CRITIQUE)

### Principe
L'app doit fonctionner **à 100%** sans connexion internet. C'est non-négociable pour la pêche en régions éloignées.

### 3 couches hors-ligne

#### 1. Données de pêche — WatermelonDB
- Base SQLite locale qui miroir les tables Supabase
- Toute saisie est enregistrée localement d'abord
- Sync bidirectionnelle au retour du signal :
  - **Push** : envoyer les nouvelles prises locales vers Supabase
  - **Pull** : récupérer les nouvelles données depuis Supabase (partages reçus, etc.)
- Champ `synced_at` sur chaque prise pour tracker l'état de sync

#### 2. Cartes — MapBox Offline Packs
- L'utilisateur télécharge des régions de carte dans Réglages
- Les tuiles sont stockées localement
- La carte fonctionne sans internet

#### 3. Météo — Précachage
- Avant une sortie de pêche, l'app télécharge les prévisions pour les prochaines heures
- Stockées localement, utilisées comme fallback si pas de signal

### Indicateurs UI
- **Bannière orange** en haut : "Mode hors-ligne — Les données seront synchronisées au retour du signal"
- **Compteur** dans Réglages : "X entrées en attente de sync"
- Détection de connexion via `@react-native-community/netinfo`
- Sync automatique déclenchée quand connexion rétablie

---

## ⚙️ Réglages

### Sections
1. **Préconfiguration rapide**
   - Espèces favorites (modal multi-select)
   - Leurres favoris (modal multi-select + ajout custom)
   - Lacs fréquentés

2. **Connexions**
   - Sonar Bluetooth (toggle + scan)
   - Cartes hors-ligne (liste des régions téléchargées)
   - Météo auto (toggle)

3. **Mode hors-ligne**
   - Précharger les cartes (toggle)
   - Simuler mode hors-ligne (pour tester)
   - Données en attente de sync (compteur)

4. **Unités**
   - Température : °C / °F
   - Poids : livres (lb) / kilogrammes (kg)
   - Longueur : pouces (po) / centimètres (cm)

5. **Compte**
   - Profil utilisateur
   - Fournisseur d'auth (Google/Apple/Facebook)
   - Déconnexion

---

## 🏗 Architecture des fichiers (cible)

```
PecheLog/
├── app/
│   ├── (tabs)/
│   │   ├── index.tsx          # Accueil
│   │   ├── map.tsx            # Carte
│   │   ├── stats.tsx          # Statistiques
│   │   ├── share.tsx          # Partage
│   │   └── settings.tsx       # Réglages
│   ├── log-catch.tsx          # Formulaire de saisie
│   ├── catch-detail.tsx       # Détail d'une prise
│   ├── login.tsx              # Écran de login
│   └── _layout.tsx            # Layout principal
├── components/
│   ├── CatchCard.tsx          # Carte de prise (liste)
│   ├── ChipSelector.tsx       # Sélecteur de chips
│   ├── SizeToggle.tsx         # Toggle P/M/G / Poids / Longueur
│   ├── MapMarker.tsx          # Marqueur sur la carte
│   ├── StatBar.tsx            # Barre de statistique
│   ├── OfflineBanner.tsx      # Bannière hors-ligne
│   └── PhotoPicker.tsx        # Sélecteur photo/vidéo
├── lib/
│   ├── supabase.ts            # Client Supabase
│   ├── theme.ts               # Couleurs et constantes
│   ├── types.ts               # Types TypeScript
│   ├── offline/
│   │   ├── database.ts        # Config WatermelonDB
│   │   ├── models/            # Modèles WatermelonDB
│   │   └── sync.ts            # Logique de synchronisation
│   ├── hooks/
│   │   ├── useAuth.ts         # Hook d'authentification
│   │   ├── useLocation.ts     # Hook GPS
│   │   ├── useWeather.ts      # Hook météo
│   │   ├── useSonar.ts        # Hook Bluetooth sonar
│   │   └── useOffline.ts      # Hook état de connexion
│   └── utils/
│       ├── geocoding.ts       # Reverse geocoding
│       └── formatting.ts      # Formatage dates, poids, etc.
├── contexts/
│   └── AuthContext.tsx         # Contexte d'authentification global
├── assets/                    # Images, fonts, etc.
├── .cursorrules               # Règles pour Cursor AI
├── CLAUDE.md                  # Ce fichier (specs pour Claude Code)
├── DATABASE.md                # Schéma SQL complet
└── prototype/
    └── PecheLog-Prototype.html # Prototype interactif de référence
```

---

## 📋 Ordre de développement recommandé

1. **Setup** — Projet Expo + Supabase + thème + types
2. **Auth** — Login Google/Apple/Facebook + AuthContext
3. **Accueil** — Écran d'accueil avec données mock
4. **Saisie** — Formulaire de prise avec GPS/météo auto
5. **Carte** — MapBox avec marqueurs
6. **Stats** — Graphiques et filtres
7. **Réglages** — Préconfiguration + unités
8. **Hors-ligne** — WatermelonDB + sync
9. **Partage** — Cartes partagées entre utilisateurs
10. **Sonar** — Bluetooth BLE
11. **Bathymétrie** — Couche carte avec profondeurs
12. **Publication** — Builds EAS + soumission stores
