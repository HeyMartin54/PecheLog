// ─── UUID v4 généré côté client ──────────────────────────────────────────────
// L'identifiant d'une prise est créé SUR LE TÉLÉPHONE, au moment de la saisie,
// et non plus par la base de données. C'est ce qui rend la synchronisation
// idempotente : si un envoi est rejoué (réponse perdue, timeout, app tuée),
// la base refuse le doublon (clé primaire) au lieu de créer une 2e prise.
//
// Pas de dépendance native (expo-crypto) : on utilise l'API crypto si le moteur
// JS la fournit, sinon Math.random. L'unicité suffit ici (ce n'est pas un secret).

type CryptoLike = {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
};

function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  const cryptoObj = (globalThis as { crypto?: CryptoLike }).crypto;
  if (cryptoObj?.getRandomValues) {
    try {
      cryptoObj.getRandomValues(bytes);
      return bytes;
    } catch {
      /* on retombe sur Math.random */
    }
  }
  for (let i = 0; i < count; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

export function generateUuid(): string {
  const cryptoObj = (globalThis as { crypto?: CryptoLike }).crypto;
  if (cryptoObj?.randomUUID) {
    try {
      return cryptoObj.randomUUID();
    } catch {
      /* contexte non sécurisé (http) → génération manuelle */
    }
  }
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(b[i].toString(16).padStart(2, '0'));
  return (
    `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-` +
    `${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
