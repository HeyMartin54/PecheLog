// ─── Configuration des espèces de poissons ───────────────────────────────────
// Photos : images Wikimedia Commons (CC BY-SA), libres de droits.
// Remplacez les URLs par des images locales (assets/species/*.jpg) si vous
// souhaitez un fonctionnement hors-ligne complet.

import { colors } from './theme';

export type SpeciesConfig = {
  /** Couleur principale de l'espèce */
  color: string;
  /** Couleur de fond translucide */
  bgColor: string;
  /** Code court (2 lettres) pour les avatars */
  code: string;
  /** URL d'une photo réelle de l'espèce (Wikimedia Commons) */
  photoUrl: string;
};

export const SPECIES_CONFIG: Record<string, SpeciesConfig> = {
  'Doré jaune': {
    color: colors.species.dore,
    bgColor: 'rgba(255, 215, 0, 0.15)',
    code: 'DJ',
    photoUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Walleye_pike.jpg/640px-Walleye_pike.jpg',
  },
  'Brochet': {
    color: colors.species.brochet,
    bgColor: 'rgba(61, 186, 120, 0.15)',
    code: 'BR',
    photoUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b7/Esox_lucius1.jpg/640px-Esox_lucius1.jpg',
  },
  'Brochet du nord': {
    color: colors.species.brochet,
    bgColor: 'rgba(61, 186, 120, 0.15)',
    code: 'BN',
    photoUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b7/Esox_lucius1.jpg/640px-Esox_lucius1.jpg',
  },
  'Truite mouchetée': {
    color: colors.species.truite,
    bgColor: 'rgba(75, 174, 232, 0.15)',
    code: 'TM',
    photoUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/Salvelinus_fontinalis.jpg/640px-Salvelinus_fontinalis.jpg',
  },
  'Truite arc-en-ciel': {
    color: colors.species.truite,
    bgColor: 'rgba(75, 174, 232, 0.15)',
    code: 'TA',
    photoUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Rainbow_trout.png/640px-Rainbow_trout.png',
  },
  'Touladi': {
    color: colors.species.touladi,
    bgColor: 'rgba(155, 168, 181, 0.15)',
    code: 'TO',
    photoUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Salvelinus_namaycush.jpg/640px-Salvelinus_namaycush.jpg',
  },
  'Achigan à grande bouche': {
    color: colors.species.achigan,
    bgColor: 'rgba(232, 137, 74, 0.15)',
    code: 'AG',
    photoUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Largemouth_bass.png/640px-Largemouth_bass.png',
  },
  'Achigan à petite bouche': {
    color: colors.species.achigan,
    bgColor: 'rgba(232, 137, 74, 0.15)',
    code: 'AP',
    photoUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Micropterus_dolomieu.jpg/640px-Micropterus_dolomieu.jpg',
  },
  'Maskinongé': {
    color: colors.species.maskinonge,
    bgColor: 'rgba(199, 125, 219, 0.15)',
    code: 'MK',
    photoUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2d/Muskellunge_%28Esox_masquinongy%29.jpg/640px-Muskellunge_%28Esox_masquinongy%29.jpg',
  },
  'Perchaude': {
    color: colors.species.perchaude,
    bgColor: 'rgba(240, 180, 41, 0.15)',
    code: 'PE',
    photoUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Yellow_perch.jpg/640px-Yellow_perch.jpg',
  },
  'Site prometteur': {
    color: '#FF6B6B',
    bgColor: 'rgba(255, 107, 107, 0.12)',
    code: '📍',
    photoUrl: '',
  },
};

/** Retourne la config d'espèce, ou une config par défaut si inconnue */
export function getSpeciesConfig(species: string): SpeciesConfig {
  // Correspondance exacte d'abord
  if (SPECIES_CONFIG[species]) return SPECIES_CONFIG[species];

  // Correspondance partielle (ex: "Doré" → "Doré jaune")
  const lower = species.toLowerCase();
  const key = Object.keys(SPECIES_CONFIG).find((k) => {
    const kl = k.toLowerCase();
    return lower.includes(kl) || kl.includes(lower);
  });
  if (key) return SPECIES_CONFIG[key];

  // Fallback générique
  const firstTwo = species.slice(0, 2).toUpperCase();
  return {
    color: colors.species.default,
    bgColor: 'rgba(136, 153, 170, 0.15)',
    code: firstTwo,
    photoUrl: '',
  };
}

/** Retourne la couleur d'espèce pour les marqueurs carte */
export function getSpeciesColor(species: string): string {
  return getSpeciesConfig(species).color;
}
