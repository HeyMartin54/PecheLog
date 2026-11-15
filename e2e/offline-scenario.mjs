// ─── Scénario navigateur : en ligne → serveur muet → redémarrage → retour ────
// Pilote la vraie application (export web) contre le faux serveur Supabase et
// vérifie, de bout en bout, les quatre exigences du mode hors-ligne :
//   1. l'app se charge sans réseau ;
//   2. la carte et ses marqueurs fonctionnent ;
//   3. une prise peut être enregistrée ;
//   4. la synchronisation repart au retour du réseau, sans doublon.
//
// Prérequis (voir e2e/README.md) : faux serveur sur :54321, export web servi
// sur :8081, Playwright + Chromium disponibles.
//
// Usage : node e2e/offline-scenario.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Playwright est chargé par require : il peut ainsi être installé globalement
// (NODE_PATH) sans être une dépendance du projet.
const { chromium } = createRequire(import.meta.url)('playwright');

const APP = process.env.APP_URL || 'http://localhost:8081';
const API = process.env.API_URL || 'http://localhost:54321';
const SHOTS = process.env.SHOTS_DIR || 'e2e/shots';
const USER = '00000000-0000-4000-8000-000000000001';
const STORAGE_KEY = 'sb-localhost-auth-token';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ─── Outils ──────────────────────────────────────────────────────────────────
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function control(path, body) {
  const res = await fetch(`${API}/__test/${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
  return res.json();
}
const serverState = () => control('state');
const serverCatches = async () => (await serverState()).tables.catches;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - started, detail: detail ?? '' });
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - started, detail: String(e.message ?? e) });
    console.log(`  ✗ ${name}\n      ${String(e.message ?? e).split('\n')[0]}`);
  }
}

/** Attend qu'une condition devienne vraie (sondage), sinon lève une erreur. */
async function until(probe, { timeout = 10_000, interval = 250, what = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(`délai dépassé (${timeout} ms) : ${what}`);
}

const seedCatch = (i, species, lake, lat, lng, extra = {}) => ({
  id: `0000000${i}-0000-4000-8000-00000000000${i}`,
  user_id: USER, map_id: null, trip_id: null, species, lure: 'Rapala X-Rap',
  latitude: lat, longitude: lng, lake_name: lake, depth_meters: 3, depth_source: 'manual',
  temperature_c: 18, wind_speed_kmh: 10, wind_direction_deg: 180, speed_kmh: 3,
  weather_conditions: 'Ensoleillé', size_category: 'medium', weight_lbs: 2 + i, length_inches: null,
  notes: null, caught_at: `2026-06-0${i}T12:00:00+00:00`, ...extra,
});

// ─── Scénario ────────────────────────────────────────────────────────────────
await mkdir(SHOTS, { recursive: true });
await control('reset');
await control('seed', {
  tables: {
    profiles: [{ id: USER, display_name: 'Martin', units_temp: 'C', units_weight: 'lb', units_length: 'in' }],
    catches: [
      seedCatch(1, 'Doré jaune', 'Lac Saint-Charles', 46.9412, -71.3871),
      seedCatch(2, 'Brochet', 'Lac Saint-Charles', 46.9437, -71.3902),
      seedCatch(3, 'Truite mouchetée', 'Lac Beauport', 46.9571, -71.2853),
    ],
  },
});

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 412, height: 880 },
  deviceScaleFactor: 1,
  locale: 'fr-CA',
  geolocation: { latitude: 46.9425, longitude: -71.3885 },
  permissions: ['geolocation'],
});

// Tout ce qui n'est pas local est coupé : tuiles, météo, géocodage, CDN.
const externalRequests = [];
await context.route(
  (url) => !['localhost', '127.0.0.1'].includes(url.hostname),
  (route) => {
    externalRequests.push(route.request().url());
    return route.abort();
  },
);

const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
/**
 * Texte visible à l'écran. Le formulaire de prise affiche ses libellés dans
 * des champs de saisie (non modifiables) : leur valeur est donc ajoutée.
 */
const bodyText = () =>
  page.evaluate(() => {
    const fields = [...document.querySelectorAll('input, textarea')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => el.value);
    return `${document.body.innerText}\n${fields.join('\n')}`;
  });

/** Clique sur un libellé affiché dans un champ de saisie (boutons du formulaire). */
async function clickField(text) {
  const point = await page.evaluate((wanted) => {
    const el = [...document.querySelectorAll('input, textarea')].find(
      (e) => e.offsetParent !== null && e.value.includes(wanted),
    );
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, text);
  check(point, `libellé « ${text} » introuvable`);
  await page.mouse.click(point.x, point.y);
}
const hasText = async (text) => (await bodyText()).includes(text);
const waitText = (text, timeout = 10_000) => until(() => hasText(text), { timeout, what: `texte « ${text} »` });
/**
 * Indicateurs de chargement VISIBLES qui bloquent du contenu. Celui du bandeau
 * « prises en attente » est exclu : il signale un envoi en cours, pas une attente.
 */
const spinners = () =>
  page.evaluate(
    () =>
      [...document.querySelectorAll('[role="progressbar"]')].filter(
        (el) => el.offsetParent !== null && !el.closest('[data-testid="sync-pending-banner"]'),
      ).length,
  );

async function setStoredSession(expired) {
  const session = await control('session', { userId: USER, expired });
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [STORAGE_KEY, JSON.stringify(session)]);
}

async function openTab(label) {
  await page.getByRole('tab', { name: label }).first().click();
  await sleep(400);
}

/** Nombre de prises représentées sur la carte (marqueurs simples + contenu des groupes). */
async function mapCatchCount() {
  return page.evaluate(() => {
    let total = 0;
    for (const el of document.querySelectorAll('.leaflet-marker-icon')) {
      const label = el.querySelector('span');
      total += label && /^\d+\+?$/.test(label.textContent.trim()) ? parseInt(label.textContent, 10) : 1;
    }
    return total;
  });
}

async function homeCatchTotal() {
  // Carte « Prises » de l'accueil : le nombre est sur la ligne qui précède le libellé
  const text = await bodyText();
  const match = /(\d+)\s*\n\s*PRISES\b/i.exec(text);
  return match ? Number(match[1]) : null;
}

/** Enregistre une prise depuis l'accueil, comme le ferait le pêcheur. */
async function logCatch() {
  await openTab('Accueil');
  await page.getByText('Nouvelle prise !').click();
  await waitText('Emplacement');
  await waitText('46.94', 20_000); // position GPS acquise
  const started = Date.now();
  await clickField('Enregistrer la prise');
  await waitText('Prises récentes', 15_000); // retour à l'accueil
  return Date.now() - started;
}

console.log('\n1. Démarrage en ligne');
await page.goto(`${APP}/metadata.json`); // même origine, sans lancer l'app
await setStoredSession(false);
await page.goto(`${APP}/`);

await step('l\'accueil affiche les prises du serveur', async () => {
  await waitText('Prises récentes');
  await until(async () => (await homeCatchTotal()) === 3, { what: '3 prises à l\'accueil' });
  check(await hasText('Truite mouchetée'), 'prise récente absente');
  await until(() => hasText('Martin'), { timeout: 5000, what: 'nom du profil' });
  await shot('01-accueil-en-ligne');
});

console.log('\n2. Carte');
let mapZoomBefore = null;
await step('la carte s\'affiche avec un marqueur par prise', async () => {
  await openTab('Carte');
  await page.waitForSelector('.leaflet-container', { timeout: 10_000 });
  await until(async () => (await mapCatchCount()) === 3, { what: '3 prises sur la carte' });
  await shot('02-carte-en-ligne');
  return `${await page.locator('.leaflet-marker-icon').count()} marqueur(s) pour 3 prises`;
});

await step('la feuille de style de la carte est embarquée (aucun appel à un CDN)', async () => {
  const position = await page.evaluate(() => getComputedStyle(document.querySelector('.leaflet-pane')).position);
  check(position === 'absolute', `style Leaflet non appliqué (position=${position})`);
  check(!externalRequests.some((u) => u.includes('unpkg.com')), 'appel à unpkg.com détecté');
});

await step('revenir sur l\'onglet ne recrée pas la carte et ne déplace pas la vue', async () => {
  // On zoome, on marque l'élément, on change d'onglet, on revient.
  await page.locator('.leaflet-control-zoom-in').click();
  await sleep(700);
  mapZoomBefore = await page.evaluate(() => {
    const el = document.querySelector('.leaflet-container');
    el.dataset.e2eMarker = 'meme-instance';
    return document.querySelector('.leaflet-proxy')?.style.transform ?? '';
  });
  await openTab('Stats');
  await openTab('Carte');
  await sleep(800);
  const after = await page.evaluate(() => ({
    marker: document.querySelector('.leaflet-container')?.dataset.e2eMarker ?? null,
    transform: document.querySelector('.leaflet-proxy')?.style.transform ?? '',
  }));
  check(after.marker === 'meme-instance', 'la carte a été détruite puis recréée');
  check(after.transform === mapZoomBefore, 'la vue (zoom / position) a été réinitialisée');
});

console.log('\n3. Enregistrer une prise en ligne');
await step('la prise est enregistrée puis envoyée au serveur, une seule fois', async () => {
  const ms = await logCatch();
  await until(async () => (await serverCatches()).length === 4, { what: '4 prises sur le serveur' });
  const rows = await serverCatches();
  const created = rows[rows.length - 1];
  check(UUID.test(created.id), `identifiant non généré par l'app : ${created.id}`);
  check(!('local_id' in created), 'champ local envoyé au serveur');
  await until(async () => (await homeCatchTotal()) === 4, { what: '4 prises à l\'accueil' });
  await until(async () => !(await hasText('en attente de synchronisation')), { what: 'plus rien en attente' });
  return `retour à l'accueil en ${ms} ms`;
});

await step('RÉGRESSION : un rafraîchissement du jeton ne ferme plus le formulaire en cours de saisie', async () => {
  // Jeton proche de l'expiration : Supabase le rafraîchit à son prochain
  // passage (≤ 30 s). Avant, l'écran ouvert était alors remplacé par l'accueil.
  const session = await control('session', { userId: USER });
  session.expires_at = Math.floor(Date.now() / 1000) + 100;
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [STORAGE_KEY, JSON.stringify(session)]);
  await page.reload();
  await waitText('Prises récentes');
  const refreshCount = async () =>
    (await serverState()).log.filter((l) => l.path === '/auth/v1/token').length;
  const before = await refreshCount();

  await page.getByText('Nouvelle prise !').click();
  await waitText('Emplacement');
  await page.locator('textarea').last().fill('note en cours de saisie');

  await until(async () => (await refreshCount()) > before, { timeout: 45_000, interval: 500, what: 'rafraîchissement du jeton' });
  await sleep(1500);

  check(page.url().endsWith('/log-catch'), `l'utilisateur a été renvoyé vers ${page.url()}`);
  check((await page.locator('textarea').last().inputValue()) === 'note en cours de saisie', 'la saisie a été perdue');
  await page.goBack();
  await waitText('Prises récentes');
});

console.log('\n4. Réseau présent mais serveur muet (signal faible)');
await control('config', { down: true });

await step('enregistrer reste immédiat, sans attendre le réseau', async () => {
  const ms = await logCatch();
  check(ms < 3000, `enregistrement trop lent sans réseau : ${ms} ms`);
  check((await serverCatches()).length === 4, 'le serveur ne devrait rien avoir reçu');
  return `${ms} ms`;
});

await step('la prise apparaît tout de suite à l\'accueil, marquée « en attente »', async () => {
  await until(async () => (await homeCatchTotal()) === 5, { what: '5 prises à l\'accueil' });
  await waitText('1 prise en attente de synchronisation');
  check(await hasText('En attente'), 'badge « En attente » absent');
  await shot('03-accueil-prise-en-attente');
});

await step('la prise en attente a son marqueur sur la carte', async () => {
  await openTab('Carte');
  await until(async () => (await mapCatchCount()) === 5, { what: '5 prises sur la carte' });
  await shot('04-carte-prise-en-attente');
});

await step('Réglages indique 1 prise en attente', async () => {
  await openTab('Réglages');
  await until(async () => (await page.getByTestId('pending-count').innerText()) === '1', { what: 'compteur à 1' });
});

console.log('\n5. Redémarrage à froid, serveur injoignable, jeton expiré');
// Cas le plus courant sur l'eau : l'app est rouverte plus d'une heure après son
// dernier usage, le jeton d'accès est donc expiré et ne peut pas être rafraîchi.
await setStoredSession(true);
let coldStartMs = 0;

await step('l\'app s\'ouvre directement sur les données locales', async () => {
  const started = Date.now();
  await page.goto(`${APP}/`); // nouveau chargement complet de l'app, sur l'accueil
  await waitText('Prises récentes', 8000);
  await until(async () => (await homeCatchTotal()) === 5, { timeout: 8000, what: '5 prises (cache + en attente)' });
  coldStartMs = Date.now() - started;
  check(!(await hasText('Continuer avec Google')), 'renvoyé vers l\'écran de connexion');
  check(coldStartMs < 5000, `démarrage trop lent : ${coldStartMs} ms`);
  await shot('05-demarrage-sans-serveur');
  return `données affichées en ${coldStartMs} ms`;
});

await step('aucun indicateur de chargement ne reste bloqué', async () => {
  await sleep(2500);
  const count = await spinners();
  check(count === 0, `${count} indicateur(s) de chargement encore affiché(s) à l'accueil`);
});

await step('la carte fonctionne et montre toutes les prises', async () => {
  await openTab('Carte');
  await page.waitForSelector('.leaflet-container', { timeout: 8000 });
  await until(async () => (await mapCatchCount()) === 5, { timeout: 8000, what: '5 prises sur la carte' });
  check(await hasText('Données locales'), 'mention « Données locales » absente');
  await shot('06-carte-sans-serveur');
});

await step('les statistiques s\'affichent', async () => {
  await openTab('Stats');
  await waitText('5 prises au total', 5000).catch(() => waitText('Données locales', 2000));
  check(await hasText('Par espèce'), 'graphiques absents');
  check((await spinners()) === 0, 'indicateur de chargement bloqué');
});

await step('l\'onglet Voyage s\'affiche (pas d\'attente du serveur)', async () => {
  await openTab('Voyage');
  await waitText('Voyage de pêche', 4000);
  await waitText('Démarrer maintenant', 4000);
});

await step('le détail d\'une prise en attente s\'ouvre', async () => {
  await openTab('Accueil');
  await page.getByText('En attente', { exact: true }).first().click();
  await waitText('En attente de synchronisation', 6000);
  await waitText('Coordonnées GPS', 4000);
  await shot('07-detail-prise-en-attente');
  await page.getByText('← Retour').first().click();
  await waitText('Prises récentes');
});

await step('le détail d\'une prise déjà synchronisée s\'ouvre depuis le cache', async () => {
  await page.getByText('Truite mouchetée').first().click();
  await waitText('Lac Beauport', 6000);
  await waitText('Lecture seule', 4000);
  await page.getByText('← Retour').first().click();
  await waitText('Prises récentes');
});

console.log('\n6. Le serveur répond de nouveau (aucun signal du navigateur)');
await control('config', { down: false });

await step('la session est restaurée et la prise part toute seule', async () => {
  const started = Date.now();
  await until(async () => (await serverCatches()).length === 5, { timeout: 45_000, interval: 500, what: '5 prises sur le serveur' });
  await until(async () => !(await hasText('en attente de synchronisation')), { timeout: 10_000, what: 'bandeau disparu' });
  return `synchronisée ${Math.round((Date.now() - started) / 1000)} s après le retour du serveur`;
});

await step('aucun doublon côté serveur', async () => {
  const rows = await serverCatches();
  check(new Set(rows.map((r) => r.id)).size === rows.length, 'identifiants en double');
  check(rows.length === 5, `${rows.length} prises au lieu de 5`);
});

console.log('\n7. Mode avion pendant l\'utilisation');
await step('hors-ligne : la prise est gardée ; en ligne : elle part aussitôt', async () => {
  await openTab('Accueil');
  await page.getByText('Nouvelle prise !').click();
  await waitText('46.94', 20_000);
  await context.setOffline(true);
  try {
    await clickField('Enregistrer la prise');
    await waitText('1 prise en attente de synchronisation', 8000);
    await waitText('Hors-ligne', 8000);
    await shot('08-mode-avion');
    check((await serverCatches()).length === 5, 'rien ne devrait être parti');
  } finally {
    await context.setOffline(false);
  }
  const started = Date.now();
  await until(async () => (await serverCatches()).length === 6, { timeout: 20_000, what: '6 prises sur le serveur' });
  await waitText('En ligne', 8000);
  return `envoyée ${Math.round((Date.now() - started) / 100) / 10} s après le retour du réseau`;
});

console.log('\n8. Réponse du serveur perdue en route');
await step('la même insertion rejouée plusieurs fois ne crée qu\'une prise', async () => {
  await until(async () => !(await hasText('en attente de synchronisation')), { timeout: 10_000, what: 'file vide avant le test' });
  // Le serveur écrit la ligne, puis perd sa réponse — deux fois de suite.
  // L'insertion est donc REJOUÉE (par la pile réseau du navigateur, comme le
  // fait OkHttp sur Android, ou par l'app à son essai suivant). Avec un
  // identifiant attribué par le serveur, chaque rejeu créait une prise de plus.
  await control('config', { dropAfterInsert: 2 });
  await logCatch();
  await until(async () => (await serverCatches()).length === 7, { timeout: 8000, what: 'ligne écrite côté serveur' });
  await until(async () => !(await hasText('en attente de synchronisation')), { timeout: 80_000, interval: 500, what: 'prise confirmée' });

  const { tables, log } = await serverState();
  const rows = tables.catches;
  const lost = log.filter((l) => l.note).length;
  check(lost === 2, `la panne n'a pas été injectée comme prévu (${lost})`);
  check(rows.length === 7, `${rows.length} prises au lieu de 7 (doublon)`);
  check(new Set(rows.map((r) => r.id)).size === 7, 'identifiants en double');

  // …et l'app la considère bien comme envoyée (ni en attente, ni refusée)
  await openTab('Réglages');
  await until(async () => (await page.getByTestId('pending-count').innerText()) === '0', { what: 'compteur à 0' });
  check(!(await hasText('refusé')), 'la prise est signalée comme refusée par le serveur');
  await openTab('Accueil');
  return `${lost} réponses perdues, insertion rejouée, 1 seule ligne`;
});

console.log('\n9. Protection du cache');
await step('aucune requête de données n\'est partie sans session', async () => {
  const { log } = await serverState();
  const anon = log.filter((l) => l.path?.startsWith('/rest/v1/') && l.role !== 'authenticated');
  check(anon.length === 0, `${anon.length} requête(s) de données non authentifiée(s) : ${JSON.stringify(anon.slice(0, 3))}`);
});

console.log('\n10. Jeton révoqué par le serveur');
await step('l\'app reste utilisable avec les données locales et invite à se reconnecter', async () => {
  await control('config', { refreshMode: 'invalid' });
  await setStoredSession(true);
  await page.goto(`${APP}/`);
  await waitText('Prises récentes', 8000);
  await until(async () => (await homeCatchTotal()) === 7, { timeout: 8000, what: '7 prises depuis le cache' });
  await waitText('Session expirée', 20_000);
  check(!(await hasText('Continuer avec Google')), 'renvoyé vers l\'écran de connexion');
  await shot('09-session-expiree');
});

await step('l\'écran de connexion propose de revenir aux données locales', async () => {
  await page.getByText('Se reconnecter').first().click();
  await waitText('Continuer avec Google', 6000);
  await waitText('Continuer avec mes données locales', 4000);
  await page.getByText('Continuer avec mes données locales').last().click();
  await waitText('Prises récentes', 6000);
});

console.log('\n11. Appareil sans utilisateur connu');
await step('redirige vers l\'écran de connexion', async () => {
  await control('config', { refreshMode: 'ok' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${APP}/`);
  await waitText('Continuer avec Google', 10_000);
  await shot('10-connexion');
});

// ─── Bilan ───────────────────────────────────────────────────────────────────
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
if (pageErrors.length > 0) console.log(`Erreurs JavaScript dans la page : ${pageErrors.length}\n  ${pageErrors.slice(0, 5).join('\n  ')}`);
await writeFile(`${SHOTS}/results.json`, JSON.stringify({ results, pageErrors, coldStartMs }, null, 2));
process.exit(failed.length > 0 || pageErrors.length > 0 ? 1 : 0);
