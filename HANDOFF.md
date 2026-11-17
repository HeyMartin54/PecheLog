# Passation — refonte du mode hors-ligne de PêcheLog

> À donner tel quel au prochain modèle / à la prochaine session.
> Branche : `claude/affectionate-curie-utsmwc` (pas de PR ouverte). Rien n'a été fusionné dans `main`.

## Objectif fixé par l'utilisateur

Revue complète de l'app, en particulier la carte et le mode hors-ligne, puis correction.
Quatre exigences : (1) l'app se charge hors-ligne, (2) la carte et les marqueurs
fonctionnent, (3) on peut enregistrer une prise, (4) la synchronisation repart au retour du réseau.

## Causes racines trouvées

L'app était « en ligne d'abord » : le repli local ne se déclenchait que si le téléphone
annonçait *aucun réseau*. Avec un signal faible (connecté, mais rien ne passe), presque
tout attendait le réseau sans limite de temps.

| # | Défaut | Où |
|---|---|---|
| 1 | Aucun timeout sur les appels Supabase → écrans figés sur un indicateur de chargement | partout |
| 2 | Entrée dans l'app liée au rafraîchissement du jeton (jusqu'à ~60 s de réessais) et à `isConnected === false` → renvoi vers le login avec un signal faible | `AuthContext`, `(tabs)/_layout`, `login` |
| 3 | **L'écran de login reste monté sous les onglets** (route initiale de la pile) et redirigeait vers l'accueil à chaque changement de session ou de réseau → l'écran ouvert (formulaire de prise en cours) était fermé, saisie perdue | `app/login.tsx` |
| 4 | File d'attente lue au début d'une synchro et réécrite à la fin → une prise saisie *pendant* la synchro était effacée | `lib/offlineSync.ts` |
| 5 | La synchro n'était tentée qu'une fois, à l'instant du retour du réseau, quand l'OS n'a pas encore validé l'accès internet → abandon, jamais de réessai | `SyncManager` dans `app/_layout.tsx` |
| 6 | Un envoi de photo sans timeout laissait le verrou de synchro bloqué pour toute la session ; les photos en échec étaient abandonnées | `lib/offlineSync.ts` |
| 7 | Envoi des photos impossible sur React Native : supabase-js met le Blob dans un FormData que la couche réseau native refuse (« Unrecognized FormData part ») ; erreur avalée | `lib/uploadMedia.ts` |
| 8 | Une requête partie sans jeton valide reçoit « 0 ligne » sans erreur (RLS) → cette liste vide écrasait le cache local | écrans + `lib/catchCache.ts` |
| 9 | Hors-ligne, la liste des leurres était remplacée par une liste vide et le cache détruit | `lib/lureStorage.ts` |
| 10 | Carte : voile qui bloquait les gestes à chaque chargement ; recadrage à chaque retour sur l'onglet ; sur web la carte était détruite et recréée, et sa feuille de style venait d'un CDN | `map.tsx`, `map.web.tsx` |
| 11 | Les prises saisies hors-ligne n'apparaissaient nulle part avant d'être synchronisées | écrans |
| 12 | Doublon possible : un envoi dont la réponse se perdait était réinséré | `log-catch.tsx`, synchro |

## Nouvelle architecture (« local d'abord »)

```
écran ──lit──▶ lib/catchStore.ts ──▶ cache serveur (AsyncStorage) + file d'attente
écran ──écrit─▶ lib/offlineQueue.ts (file, verrou)  ──▶ lib/offlineSync.ts ──▶ Supabase
                                         ▲
                              lib/syncEngine.ts (QUAND synchroniser)
```

| Fichier | Rôle |
|---|---|
| `lib/net.ts` | `isOnline()` (internet utilisable) vs `mayReachNetwork()` (un réseau existe : la synchro tente quand même) ; `withTimeout`, `fetchWithTimeout`, `isNetworkError` |
| `lib/supabase.ts` | `supabaseFetch` : timeout sur chaque requête + refus local des requêtes de données sans session ; `readStoredAuthUser()` (identité locale, sans réseau) ; URL/clé surchargeables par `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` |
| `lib/uuid.ts` | UUID créé sur l'appareil = clé primaire de la prise → envoi rejouable sans doublon (erreur 23505 traitée comme un succès) |
| `lib/offlineQueue.ts` | File d'attente : toute modification relit et réécrit sous verrou ; migration de l'ancien format ; médias locaux |
| `lib/offlineSync.ts` | Un passage de synchro : prise, puis médias, puis météo rétroactive ; erreur réseau = on arrête et on réessaiera ; refus serveur = élément « bloqué », conservé |
| `lib/syncEngine.ts` | Déclencheurs : changement réseau, premier plan, ajout à la file, session disponible, réessais 15 s → 5 min |
| `lib/catchStore.ts` + `lib/hooks/useCatches.ts` | Source unique des prises pour accueil, carte, stats, détail |
| `lib/tripStorage.ts` | Voyages : lecture locale instantanée, envoi en arrière-plan, `refreshTripsFromServer()` |
| `lib/lureStorage.ts` | Leurres : cache jamais vidé sur échec, création possible hors-ligne, `watchLures()` |
| `lib/uploadMedia.ts` | Envoi natif en flux (`expo-file-system` `createUploadTask`) ; Blob sur web |
| `contexts/AuthContext.tsx` | `sessionStatus` : `loading / active / restoring / expired / signedOut` ; `cachedUserId` effacé seulement par une déconnexion explicite |
| `components/SyncStatusBanner.tsx` | Bandeau « n prises en attente » / « session expirée » |

Règles à respecter dans tout nouveau code :
- un écran ne lit jamais les prises dans Supabase directement : `useCatches()` ;
- enregistrer une prise = `enqueueCatch()` (jamais d'insert direct depuis un écran) ;
- ne pas utiliser `supabase.auth.getSession()` pour connaître l'utilisateur hors-ligne
  (elle déclenche un rafraîchissement réseau) : `useAuth().cachedUserId` ou `readStoredAuthUser()` ;
- la garde `isFocused` dans `app/login.tsx` ne doit pas être retirée (défaut n° 3).

## État de la vérification

| Vérification | État |
|---|---|
| `npx tsc --noEmit` | OK (seule erreur : `components/ExternalLink.tsx`, antérieure au chantier — les types de routes ne sont pas générés hors d'un `expo start`) |
| `npm test` (Jest, 9 fichiers dans `__tests__/`) | **118 tests réussis** |
| Scénario navigateur `e2e/offline-scenario.mjs` | **25 vérifications sur 25**, aucune erreur JavaScript dans la page |
| Bundle Android (`npx expo export -p android`) | OK : le code mobile se compile (ne prouve pas son comportement à l'exécution) |
| Appareil Android / iOS réel | **Jamais testé.** Aucun émulateur dans l'environnement de travail |

### Ce que le scénario navigateur prouve

L'app réelle (export web) tourne contre un faux serveur Supabase (`e2e/mock-supabase.mjs`)
qui applique les mêmes règles que le vrai (chacun ses lignes, clé primaire unique) et
permet d'injecter des pannes.

| Exigence | Vérifié |
|---|---|
| Se charge hors-ligne | Serveur injoignable **et** jeton expiré : données affichées en ~350 ms, pas de renvoi vers le login, aucun indicateur de chargement bloqué. Jeton révoqué : l'app reste utilisable et invite à se reconnecter |
| Carte et marqueurs | Un marqueur par prise ; les prises non envoyées y figurent ; la carte n'est plus recréée ni recadrée au changement d'onglet ; feuille de style embarquée (aucun CDN) |
| Enregistrer une prise | ~30 ms, serveur joignable ou non ; visible aussitôt à l'accueil (« En attente »), sur la carte et dans Réglages ; son détail s'ouvre |
| Synchronisation au retour | Serveur de retour sans aucun signal du navigateur : envoyée en 3 s. Mode avion levé : 0,5 s. Insertion rejouée après deux réponses perdues : une seule ligne. Aucun doublon |
| Divers | Un rafraîchissement du jeton ne ferme plus le formulaire en cours ; aucune requête de données n'est partie sans session |

Limite de cette preuve : c'est la version **web**. Elle partage toute la logique (file,
synchro, magasin, authentification, écrans) avec le mobile, mais pas la carte native
(`react-native-maps`), ni l'envoi natif des photos, ni la détection réseau d'Android.

### Relancer le scénario navigateur

```bash
node e2e/mock-supabase.mjs
```
```bash
EXPO_PUBLIC_SUPABASE_URL=http://localhost:54321 EXPO_PUBLIC_SUPABASE_ANON_KEY=test-anon-key npx expo export -p web --output-dir /tmp/dist-e2e
```
```bash
node e2e/static-server.mjs /tmp/dist-e2e 8081
```
```bash
node e2e/offline-scenario.mjs
```
Playwright n'est pas une dépendance du projet (chargé par `require`, installation globale).
Les captures d'écran vont dans `e2e/shots/` (ignoré par git).

## Compiler l'APK Android (EAS)

L'utilisateur installe des APK du profil `preview` (distribution interne), tous signés
avec la clé EAS par défaut du projet `@nitram54/PecheLog` : un nouvel APK `preview`
s'installe **par-dessus** l'app existante, données locales conservées.

- Un jeton Expo (compte de service « Claude », admin du compte `nitram54`) est enregistré
  comme secret réseau de l'environnement cloud « Maison » pour `api.expo.dev`. Le proxy
  l'injecte ; le CLI a seulement besoin d'une valeur fictive :
  ```bash
  EXPO_TOKEN=proxy-injected npx eas-cli build -p android --profile preview --non-interactive --no-wait
  ```
- Les clés `EXPO_PUBLIC_GOOGLE_MAPS_KEY` et `EXPO_PUBLIC_OPENWEATHER_API_KEY` sont dans
  l'environnement EAS `preview` (aussi `production` et `development`).
- **Ne pas compiler sans jeton valide** (consigne de l'utilisateur) : pas de compilation
  locale signée avec une autre clé, qui obligerait à désinstaller l'app et perdrait les
  prises non synchronisées.
- Compilation du commit `e6bf32f` : build `5d159bed-c1de-460c-9c9e-3da1a89be052`
  (https://expo.dev/accounts/nitram54/projects/PecheLog/builds/5d159bed-c1de-460c-9c9e-3da1a89be052).

## Reste à faire

1. **Tester sur un téléphone**, en priorité :
   - démarrage en mode avion après plus d'une heure d'inactivité ;
   - saisie avec 1 barre de signal, puis retour du réseau ;
   - envoi d'une photo — le nouvel envoi natif (`expo-file-system`) n'a jamais tourné sur un appareil ;
   - carte native : marqueurs, prise en attente, bouton « tout voir », plus de recadrage automatique.
2. Décider du fond de carte hors-ligne (voir les limites ci-dessous).
3. Ce fichier peut être supprimé une fois ces points traités : `CLAUDE.md` décrit
   maintenant la nouvelle architecture (section « Mode hors-ligne »).

## Limites connues, non traitées

- **Fond de carte hors-ligne** : les marqueurs s'affichent toujours, mais les tuiles
  dépendent de ce que Google/Apple Maps a gardé en mémoire. Une vraie carte hors-ligne
  demande un fournisseur de tuiles (les conditions d'OpenStreetMap interdisent le
  téléchargement en masse) et des essais sur appareil.
- **Modifier / supprimer / dupliquer une prise déjà synchronisée** exige toujours le réseau
  (lecture seule hors-ligne). Une prise en attente peut être supprimée.
- **Web** : pas de service worker, donc la page ne se recharge pas sans réseau ; sur web
  les photos d'une prise en attente sont perdues si la page est rechargée avant l'envoi.
- Les clés locales des voyages ne sont pas séparées par utilisateur (inchangé).

## À signaler à l'utilisateur

- `app/login.tsx` contient l'adresse et le mot de passe d'un compte de test en clair
  (bouton affiché en développement seulement, mais présents dans le dépôt).
- L'ajout de `jest` / `jest-expo` a fait monter de quelques versions correctives des
  paquets d'outillage `@expo/*` dans `package-lock.json` (aucune bibliothèque d'exécution).
- Le SQL de `DATABASE.md` n'a pas été modifié : aucune migration n'est nécessaire
  (`catches.id`, `catch_media.id` et `user_lures.id` acceptaient déjà un UUID fourni).
