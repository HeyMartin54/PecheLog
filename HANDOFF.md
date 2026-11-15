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
| `npx tsc --noEmit` | OK au commit `594f3b6` (seule erreur : `components/ExternalLink.tsx`, antérieure). **À relancer** : `lib/net.ts` a été modifié depuis |
| `npm test` (Jest, 9 fichiers dans `__tests__/`) | 118 tests réussis au commit `594f3b6`. **À relancer** |
| Scénario navigateur `e2e/offline-scenario.mjs` | Dernier passage : **17 / 25**. Voir ci-dessous |
| Appareil Android / iOS réel | **Jamais testé.** Aucun émulateur dans l'environnement de travail |

### Scénario navigateur — ce qui passe

Accueil et carte en ligne ; feuille de style de la carte embarquée ; la carte n'est plus
recréée au changement d'onglet ; prise enregistrée et envoyée une seule fois ;
**le rafraîchissement du jeton ne ferme plus le formulaire** ; enregistrement en ~30 ms
serveur injoignable ; prise en attente visible à l'accueil, sur la carte et dans Réglages ;
carte, voyage et détail d'une prise utilisables serveur injoignable ; **session restaurée et
prise envoyée 8 s après le retour du serveur, sans doublon** ; aucune requête de données
partie sans session.

### Scénario navigateur — les 8 échecs du dernier passage

Aucun n'a été attribué à un défaut de l'app côté mobile ; ils restent à confirmer :

1. Étape 5 (démarrage à froid) : le script rechargeait la page sur l'onglet Réglages et
   comptait des indicateurs cachés. Script corrigé (`page.goto('/')`, indicateurs visibles
   seulement) — **non relancé**.
2. Étape 7 (mode avion) : sur web, le badge restait « En ligne ». Cause : dans Chrome,
   NetInfo n'écoute que `navigator.connection` et ignore les événements `online`/`offline`.
   Correctif ajouté dans `lib/net.ts` (relais de ces événements vers `NetInfo.refresh()`,
   web uniquement) — **ni compilé ni relancé**.
3. Étapes 8, 10, 11 : échecs en cascade de l'étape 7 (le navigateur restait hors-ligne).

La dernière commande (modification de `lib/net.ts` et du script) a été interrompue en cours :
vérifier que `e2e/offline-scenario.mjs` contient bien `page.goto(\`${APP}/\`)` à l'étape 5
et le bloc `try / finally` autour de `setOffline` à l'étape 7 ; sinon, les refaire.

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

## Reste à faire

1. Relancer `npx tsc --noEmit` et `npm test`.
2. Reconstruire l'export web, relancer le scénario, traiter ce qui échoue encore.
3. **Mettre à jour `CLAUDE.md`** : il décrit encore l'ancienne architecture (sections
   « Mode hors-ligne », « Architecture des fichiers », « Comportement hors-ligne »).
   Ce fichier-ci peut ensuite être supprimé.
4. Tester sur un téléphone, en priorité : démarrage en mode avion après plus d'une heure
   d'inactivité ; saisie avec 1 barre de signal ; retour du réseau ; envoi d'une photo
   (le nouvel envoi natif n'a jamais tourné sur un appareil) ; carte native (marqueurs,
   bouton « tout voir », plus de recadrage automatique).

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
