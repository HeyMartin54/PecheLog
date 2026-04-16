// ─── Catalogue de leurres PêcheLog ────────────────────────────────────────────
// Couverture : ~80 leurres populaires pour la pêche au Québec.
// Photos : Wikimedia Commons (CC BY-SA) quand disponibles, sinon null.
// En production, remplacer les photoUrl par des images locales dans assets/lures/
// pour un fonctionnement hors-ligne complet.

export type LureCategory =
  | 'Cuillère tournante'
  | 'Cuillère ondulante'
  | 'Poisson nageur'
  | 'Surface'
  | 'Jig'
  | 'Leurre souple'
  | 'Mouche'
  | 'Naturel';

export type LureConfig = {
  id: string;
  name: string;
  brand: string;
  category: LureCategory;
  /** Couleur principale de la carte */
  color: string;
  /** Fond translucide */
  bgColor: string;
  /** Emoji représentatif */
  emoji: string;
  /** URL photo optionnelle (Wikimedia Commons ou null) */
  photoUrl: string | null;
};

// ─── Couleurs par catégorie ───────────────────────────────────────────────────
export const LURE_CATEGORY_COLORS: Record<LureCategory, { color: string; bgColor: string; emoji: string }> = {
  'Cuillère tournante': { color: '#F5A623', bgColor: 'rgba(245,166,35,0.15)',  emoji: '🌀' },
  'Cuillère ondulante': { color: '#C0C0C0', bgColor: 'rgba(192,192,192,0.15)', emoji: '🥄' },
  'Poisson nageur':     { color: '#4BAEE8', bgColor: 'rgba(75,174,232,0.15)',  emoji: '🐟' },
  'Surface':            { color: '#00D4AA', bgColor: 'rgba(0,212,170,0.15)',   emoji: '💧' },
  'Jig':                { color: '#C77DDB', bgColor: 'rgba(199,125,219,0.15)', emoji: '🎣' },
  'Leurre souple':      { color: '#3DBA78', bgColor: 'rgba(61,186,120,0.15)',  emoji: '🪱' },
  'Mouche':             { color: '#FFD700', bgColor: 'rgba(255,215,0,0.15)',   emoji: '🦋' },
  'Naturel':            { color: '#A0785A', bgColor: 'rgba(160,120,90,0.15)', emoji: '🪱' },
};

// ─── Catalogue complet ────────────────────────────────────────────────────────
export const LURES_CATALOG: LureConfig[] = [
  // ── Cuillères tournantes (spinners) ────────────────────────────────────────
  {
    id: 'mepps-aglia-2-argent',
    name: 'Aglia #2 Argent',
    brand: 'Mepps',
    category: 'Cuillère tournante',
    color: '#F5A623', bgColor: 'rgba(245,166,35,0.15)', emoji: '🌀',
    photoUrl: null,
  },
  {
    id: 'mepps-aglia-3-or',
    name: 'Aglia #3 Or',
    brand: 'Mepps',
    category: 'Cuillère tournante',
    color: '#F5A623', bgColor: 'rgba(245,166,35,0.15)', emoji: '🌀',
    photoUrl: null,
  },
  {
    id: 'mepps-black-fury-2',
    name: 'Black Fury #2',
    brand: 'Mepps',
    category: 'Cuillère tournante',
    color: '#F5A623', bgColor: 'rgba(245,166,35,0.15)', emoji: '🌀',
    photoUrl: null,
  },
  {
    id: 'mepps-aglia-long-3',
    name: 'Aglia Long #3',
    brand: 'Mepps',
    category: 'Cuillère tournante',
    color: '#F5A623', bgColor: 'rgba(245,166,35,0.15)', emoji: '🌀',
    photoUrl: null,
  },
  {
    id: 'mepps-lusox-1',
    name: 'Lusox #1',
    brand: 'Mepps',
    category: 'Cuillère tournante',
    color: '#F5A623', bgColor: 'rgba(245,166,35,0.15)', emoji: '🌀',
    photoUrl: null,
  },
  {
    id: 'bluefox-vibrax-3',
    name: 'Vibrax #3',
    brand: 'Blue Fox',
    category: 'Cuillère tournante',
    color: '#F5A623', bgColor: 'rgba(245,166,35,0.15)', emoji: '🌀',
    photoUrl: null,
  },
  {
    id: 'bluefox-vibrax-4',
    name: 'Vibrax #4',
    brand: 'Blue Fox',
    category: 'Cuillère tournante',
    color: '#F5A623', bgColor: 'rgba(245,166,35,0.15)', emoji: '🌀',
    photoUrl: null,
  },
  {
    id: 'panther-martin-6',
    name: 'Panther Martin #6',
    brand: 'Panther Martin',
    category: 'Cuillère tournante',
    color: '#F5A623', bgColor: 'rgba(245,166,35,0.15)', emoji: '🌀',
    photoUrl: null,
  },
  {
    id: 'panther-martin-9',
    name: 'Panther Martin #9',
    brand: 'Panther Martin',
    category: 'Cuillère tournante',
    color: '#F5A623', bgColor: 'rgba(245,166,35,0.15)', emoji: '🌀',
    photoUrl: null,
  },
  {
    id: 'roostertail-1-8',
    name: "Rooster Tail 1/8 oz",
    brand: "Worden's",
    category: 'Cuillère tournante',
    color: '#F5A623', bgColor: 'rgba(245,166,35,0.15)', emoji: '🌀',
    photoUrl: null,
  },
  {
    id: 'roostertail-1-4',
    name: "Rooster Tail 1/4 oz",
    brand: "Worden's",
    category: 'Cuillère tournante',
    color: '#F5A623', bgColor: 'rgba(245,166,35,0.15)', emoji: '🌀',
    photoUrl: null,
  },

  // ── Cuillères ondulantes (spoons) ──────────────────────────────────────────
  {
    id: 'williams-wobbler-w50',
    name: 'Wobbler W50',
    brand: 'Williams',
    category: 'Cuillère ondulante',
    color: '#C0C0C0', bgColor: 'rgba(192,192,192,0.15)', emoji: '🥄',
    photoUrl: null,
  },
  {
    id: 'williams-wobbler-w60',
    name: 'Wobbler W60',
    brand: 'Williams',
    category: 'Cuillère ondulante',
    color: '#C0C0C0', bgColor: 'rgba(192,192,192,0.15)', emoji: '🥄',
    photoUrl: null,
  },
  {
    id: 'dardevle-1oz',
    name: 'Dardevle 1 oz',
    brand: 'Eppinger',
    category: 'Cuillère ondulante',
    color: '#C0C0C0', bgColor: 'rgba(192,192,192,0.15)', emoji: '🥄',
    photoUrl: null,
  },
  {
    id: 'dardevle-1-2oz',
    name: 'Dardevle 1/2 oz',
    brand: 'Eppinger',
    category: 'Cuillère ondulante',
    color: '#C0C0C0', bgColor: 'rgba(192,192,192,0.15)', emoji: '🥄',
    photoUrl: null,
  },
  {
    id: 'kastmaster-1-2',
    name: 'Kastmaster 1/2 oz',
    brand: 'Acme',
    category: 'Cuillère ondulante',
    color: '#C0C0C0', bgColor: 'rgba(192,192,192,0.15)', emoji: '🥄',
    photoUrl: null,
  },
  {
    id: 'little-cleo-3-4',
    name: 'Little Cleo 3/4 oz',
    brand: 'Acme',
    category: 'Cuillère ondulante',
    color: '#C0C0C0', bgColor: 'rgba(192,192,192,0.15)', emoji: '🥄',
    photoUrl: null,
  },
  {
    id: 'krocodile-3-8',
    name: 'Krocodile 3/8 oz',
    brand: 'Luhr-Jensen',
    category: 'Cuillère ondulante',
    color: '#C0C0C0', bgColor: 'rgba(192,192,192,0.15)', emoji: '🥄',
    photoUrl: null,
  },
  {
    id: 'doctor-spoon',
    name: 'Doctor Spoon',
    brand: 'Williams',
    category: 'Cuillère ondulante',
    color: '#C0C0C0', bgColor: 'rgba(192,192,192,0.15)', emoji: '🥄',
    photoUrl: null,
  },

  // ── Poissons nageurs (crankbaits / jerkbaits) ──────────────────────────────
  {
    id: 'rapala-original-7',
    name: 'Original Floater 7 cm',
    brand: 'Rapala',
    category: 'Poisson nageur',
    color: '#4BAEE8', bgColor: 'rgba(75,174,232,0.15)', emoji: '🐟',
    photoUrl: null,
  },
  {
    id: 'rapala-original-9',
    name: 'Original Floater 9 cm',
    brand: 'Rapala',
    category: 'Poisson nageur',
    color: '#4BAEE8', bgColor: 'rgba(75,174,232,0.15)', emoji: '🐟',
    photoUrl: null,
  },
  {
    id: 'rapala-xrap-10',
    name: 'X-Rap 10',
    brand: 'Rapala',
    category: 'Poisson nageur',
    color: '#4BAEE8', bgColor: 'rgba(75,174,232,0.15)', emoji: '🐟',
    photoUrl: null,
  },
  {
    id: 'rapala-shad-rap-sr7',
    name: 'Shad Rap SR7',
    brand: 'Rapala',
    category: 'Poisson nageur',
    color: '#4BAEE8', bgColor: 'rgba(75,174,232,0.15)', emoji: '🐟',
    photoUrl: null,
  },
  {
    id: 'rapala-husky-jerk-10',
    name: 'Husky Jerk 10',
    brand: 'Rapala',
    category: 'Poisson nageur',
    color: '#4BAEE8', bgColor: 'rgba(75,174,232,0.15)', emoji: '🐟',
    photoUrl: null,
  },
  {
    id: 'rapala-countdown-7',
    name: 'Countdown 7',
    brand: 'Rapala',
    category: 'Poisson nageur',
    color: '#4BAEE8', bgColor: 'rgba(75,174,232,0.15)', emoji: '🐟',
    photoUrl: null,
  },
  {
    id: 'rapala-dt6',
    name: 'DT-6',
    brand: 'Rapala',
    category: 'Poisson nageur',
    color: '#4BAEE8', bgColor: 'rgba(75,174,232,0.15)', emoji: '🐟',
    photoUrl: null,
  },
  {
    id: 'storm-thunderstick',
    name: 'ThunderStick',
    brand: 'Storm',
    category: 'Poisson nageur',
    color: '#4BAEE8', bgColor: 'rgba(75,174,232,0.15)', emoji: '🐟',
    photoUrl: null,
  },
  {
    id: 'rebel-crawfish',
    name: 'Crawfish',
    brand: 'Rebel',
    category: 'Poisson nageur',
    color: '#4BAEE8', bgColor: 'rgba(75,174,232,0.15)', emoji: '🐟',
    photoUrl: null,
  },
  {
    id: 'yozuri-crystal-minnow',
    name: 'Crystal Minnow 9 cm',
    brand: 'Yo-Zuri',
    category: 'Poisson nageur',
    color: '#4BAEE8', bgColor: 'rgba(75,174,232,0.15)', emoji: '🐟',
    photoUrl: null,
  },
  {
    id: 'berkley-flicker-shad',
    name: 'Flicker Shad 5 cm',
    brand: 'Berkley',
    category: 'Poisson nageur',
    color: '#4BAEE8', bgColor: 'rgba(75,174,232,0.15)', emoji: '🐟',
    photoUrl: null,
  },
  {
    id: 'cordell-redfin',
    name: 'Red Fin',
    brand: 'Cotton Cordell',
    category: 'Poisson nageur',
    color: '#4BAEE8', bgColor: 'rgba(75,174,232,0.15)', emoji: '🐟',
    photoUrl: null,
  },
  {
    id: 'lucky-craft-lvr-d7',
    name: 'LVR D-7',
    brand: 'Lucky Craft',
    category: 'Poisson nageur',
    color: '#4BAEE8', bgColor: 'rgba(75,174,232,0.15)', emoji: '🐟',
    photoUrl: null,
  },

  // ── Surface (topwater) ─────────────────────────────────────────────────────
  {
    id: 'heddon-zara-spook',
    name: 'Zara Spook',
    brand: 'Heddon',
    category: 'Surface',
    color: '#00D4AA', bgColor: 'rgba(0,212,170,0.15)', emoji: '💧',
    photoUrl: null,
  },
  {
    id: 'heddon-torpedo',
    name: 'Baby Torpedo',
    brand: 'Heddon',
    category: 'Surface',
    color: '#00D4AA', bgColor: 'rgba(0,212,170,0.15)', emoji: '💧',
    photoUrl: null,
  },
  {
    id: 'hula-popper',
    name: 'Hula Popper',
    brand: 'Arbogast',
    category: 'Surface',
    color: '#00D4AA', bgColor: 'rgba(0,212,170,0.15)', emoji: '💧',
    photoUrl: null,
  },
  {
    id: 'arbogast-jitterbug',
    name: 'Jitterbug',
    brand: 'Arbogast',
    category: 'Surface',
    color: '#00D4AA', bgColor: 'rgba(0,212,170,0.15)', emoji: '💧',
    photoUrl: null,
  },
  {
    id: 'rebel-popr',
    name: 'Pop-R',
    brand: 'Rebel',
    category: 'Surface',
    color: '#00D4AA', bgColor: 'rgba(0,212,170,0.15)', emoji: '💧',
    photoUrl: null,
  },
  {
    id: 'river2sea-whopper-plopper',
    name: 'Whopper Plopper 90',
    brand: 'River2Sea',
    category: 'Surface',
    color: '#00D4AA', bgColor: 'rgba(0,212,170,0.15)', emoji: '💧',
    photoUrl: null,
  },
  {
    id: 'rapala-skitter-pop',
    name: 'Skitter Pop 7',
    brand: 'Rapala',
    category: 'Surface',
    color: '#00D4AA', bgColor: 'rgba(0,212,170,0.15)', emoji: '💧',
    photoUrl: null,
  },
  {
    id: 'strike-king-sexy-frog',
    name: 'KVD Sexy Frog',
    brand: 'Strike King',
    category: 'Surface',
    color: '#00D4AA', bgColor: 'rgba(0,212,170,0.15)', emoji: '💧',
    photoUrl: null,
  },
  {
    id: 'booyah-pad-crasher',
    name: 'Pad Crasher',
    brand: 'Booyah',
    category: 'Surface',
    color: '#00D4AA', bgColor: 'rgba(0,212,170,0.15)', emoji: '💧',
    photoUrl: null,
  },

  // ── Jigs ───────────────────────────────────────────────────────────────────
  {
    id: 'jig-marabou-blanc-1-4',
    name: 'Jig Marabou Blanc 1/4 oz',
    brand: 'Générique',
    category: 'Jig',
    color: '#C77DDB', bgColor: 'rgba(199,125,219,0.15)', emoji: '🎣',
    photoUrl: null,
  },
  {
    id: 'jig-marabou-chartreuse-1-4',
    name: 'Jig Marabou Chartreuse 1/4 oz',
    brand: 'Générique',
    category: 'Jig',
    color: '#C77DDB', bgColor: 'rgba(199,125,219,0.15)', emoji: '🎣',
    photoUrl: null,
  },
  {
    id: 'jig-tube-1-4',
    name: 'Jig Tube 1/4 oz',
    brand: 'Générique',
    category: 'Jig',
    color: '#C77DDB', bgColor: 'rgba(199,125,219,0.15)', emoji: '🎣',
    photoUrl: null,
  },
  {
    id: 'jig-tube-3-8',
    name: 'Jig Tube 3/8 oz',
    brand: 'Générique',
    category: 'Jig',
    color: '#C77DDB', bgColor: 'rgba(199,125,219,0.15)', emoji: '🎣',
    photoUrl: null,
  },
  {
    id: 'jig-curly-tail-1-4',
    name: 'Jig Curly Tail 1/4 oz',
    brand: 'Générique',
    category: 'Jig',
    color: '#C77DDB', bgColor: 'rgba(199,125,219,0.15)', emoji: '🎣',
    photoUrl: null,
  },
  {
    id: 'jig-bucktail-1-2',
    name: 'Jig Bucktail 1/2 oz',
    brand: 'Générique',
    category: 'Jig',
    color: '#C77DDB', bgColor: 'rgba(199,125,219,0.15)', emoji: '🎣',
    photoUrl: null,
  },
  {
    id: 'swim-jig-3-8',
    name: 'Swim Jig 3/8 oz',
    brand: 'Z-Man',
    category: 'Jig',
    color: '#C77DDB', bgColor: 'rgba(199,125,219,0.15)', emoji: '🎣',
    photoUrl: null,
  },
  {
    id: 'football-jig-3-4',
    name: 'Football Jig 3/4 oz',
    brand: 'Générique',
    category: 'Jig',
    color: '#C77DDB', bgColor: 'rgba(199,125,219,0.15)', emoji: '🎣',
    photoUrl: null,
  },
  {
    id: 'ned-rig-1-10',
    name: 'Ned Rig 1/10 oz',
    brand: 'Z-Man',
    category: 'Jig',
    color: '#C77DDB', bgColor: 'rgba(199,125,219,0.15)', emoji: '🎣',
    photoUrl: null,
  },
  {
    id: 'blade-bait-3-8',
    name: 'Blade Bait 3/8 oz',
    brand: 'Générique',
    category: 'Jig',
    color: '#C77DDB', bgColor: 'rgba(199,125,219,0.15)', emoji: '🎣',
    photoUrl: null,
  },

  // ── Leurres souples (soft plastics) ────────────────────────────────────────
  {
    id: 'berkley-powerbait-minnow',
    name: 'PowerBait Minnow 3"',
    brand: 'Berkley',
    category: 'Leurre souple',
    color: '#3DBA78', bgColor: 'rgba(61,186,120,0.15)', emoji: '🪱',
    photoUrl: null,
  },
  {
    id: 'berkley-gulp-minnow',
    name: 'Gulp Alive Minnow 3"',
    brand: 'Berkley',
    category: 'Leurre souple',
    color: '#3DBA78', bgColor: 'rgba(61,186,120,0.15)', emoji: '🪱',
    photoUrl: null,
  },
  {
    id: 'berkley-gulp-crawdad',
    name: 'Gulp Crawdad 2"',
    brand: 'Berkley',
    category: 'Leurre souple',
    color: '#3DBA78', bgColor: 'rgba(61,186,120,0.15)', emoji: '🪱',
    photoUrl: null,
  },
  {
    id: 'zoom-trick-worm',
    name: 'Trick Worm 6"',
    brand: 'Zoom',
    category: 'Leurre souple',
    color: '#3DBA78', bgColor: 'rgba(61,186,120,0.15)', emoji: '🪱',
    photoUrl: null,
  },
  {
    id: 'gary-yamamoto-senko-4',
    name: 'Senko 4"',
    brand: 'Gary Yamamoto',
    category: 'Leurre souple',
    color: '#3DBA78', bgColor: 'rgba(61,186,120,0.15)', emoji: '🪱',
    photoUrl: null,
  },
  {
    id: 'keitech-swing-impact',
    name: 'Swing Impact 3.5"',
    brand: 'Keitech',
    category: 'Leurre souple',
    color: '#3DBA78', bgColor: 'rgba(61,186,120,0.15)', emoji: '🪱',
    photoUrl: null,
  },
  {
    id: 'strike-king-rage-craw',
    name: 'Rage Craw 4"',
    brand: 'Strike King',
    category: 'Leurre souple',
    color: '#3DBA78', bgColor: 'rgba(61,186,120,0.15)', emoji: '🪱',
    photoUrl: null,
  },
  {
    id: 'paddle-tail-swimbait-4',
    name: 'Swimbait Paddle Tail 4"',
    brand: 'Générique',
    category: 'Leurre souple',
    color: '#3DBA78', bgColor: 'rgba(61,186,120,0.15)', emoji: '🪱',
    photoUrl: null,
  },
  {
    id: 'tube-4',
    name: 'Tube Plastique 4"',
    brand: 'Générique',
    category: 'Leurre souple',
    color: '#3DBA78', bgColor: 'rgba(61,186,120,0.15)', emoji: '🪱',
    photoUrl: null,
  },
  {
    id: 'grub-3',
    name: 'Grub 3"',
    brand: 'Générique',
    category: 'Leurre souple',
    color: '#3DBA78', bgColor: 'rgba(61,186,120,0.15)', emoji: '🪱',
    photoUrl: null,
  },
  {
    id: 'zman-chatterbait',
    name: 'ChatterBait 3/8 oz',
    brand: 'Z-Man',
    category: 'Leurre souple',
    color: '#3DBA78', bgColor: 'rgba(61,186,120,0.15)', emoji: '🪱',
    photoUrl: null,
  },

  // ── Mouches ────────────────────────────────────────────────────────────────
  {
    id: 'mouche-adams',
    name: 'Adams',
    brand: 'Mouche sèche',
    category: 'Mouche',
    color: '#FFD700', bgColor: 'rgba(255,215,0,0.15)', emoji: '🦋',
    photoUrl: null,
  },
  {
    id: 'mouche-elk-hair-caddis',
    name: 'Elk Hair Caddis',
    brand: 'Mouche sèche',
    category: 'Mouche',
    color: '#FFD700', bgColor: 'rgba(255,215,0,0.15)', emoji: '🦋',
    photoUrl: null,
  },
  {
    id: 'mouche-hares-ear',
    name: "Hare's Ear",
    brand: 'Nymphe',
    category: 'Mouche',
    color: '#FFD700', bgColor: 'rgba(255,215,0,0.15)', emoji: '🦋',
    photoUrl: null,
  },
  {
    id: 'mouche-pheasant-tail',
    name: 'Pheasant Tail',
    brand: 'Nymphe',
    category: 'Mouche',
    color: '#FFD700', bgColor: 'rgba(255,215,0,0.15)', emoji: '🦋',
    photoUrl: null,
  },
  {
    id: 'muddler-minnow',
    name: 'Muddler Minnow',
    brand: 'Streamer',
    category: 'Mouche',
    color: '#FFD700', bgColor: 'rgba(255,215,0,0.15)', emoji: '🦋',
    photoUrl: null,
  },
  {
    id: 'woolly-bugger-noir',
    name: 'Woolly Bugger (noir)',
    brand: 'Streamer',
    category: 'Mouche',
    color: '#FFD700', bgColor: 'rgba(255,215,0,0.15)', emoji: '🦋',
    photoUrl: null,
  },
  {
    id: 'woolly-bugger-olive',
    name: 'Woolly Bugger (olive)',
    brand: 'Streamer',
    category: 'Mouche',
    color: '#FFD700', bgColor: 'rgba(255,215,0,0.15)', emoji: '🦋',
    photoUrl: null,
  },
  {
    id: 'zonker',
    name: 'Zonker',
    brand: 'Streamer',
    category: 'Mouche',
    color: '#FFD700', bgColor: 'rgba(255,215,0,0.15)', emoji: '🦋',
    photoUrl: null,
  },
  {
    id: 'popper-mouche',
    name: 'Popper en foam',
    brand: 'Mouche',
    category: 'Mouche',
    color: '#FFD700', bgColor: 'rgba(255,215,0,0.15)', emoji: '🦋',
    photoUrl: null,
  },

  // ── Naturel / Appâts vivants ────────────────────────────────────────────────
  {
    id: 'ver-de-terre',
    name: 'Ver de terre',
    brand: 'Naturel',
    category: 'Naturel',
    color: '#A0785A', bgColor: 'rgba(160,120,90,0.15)', emoji: '🪱',
    photoUrl: null,
  },
  {
    id: 'minnow-ventre-jaune',
    name: 'Minnow (ventre jaune)',
    brand: 'Naturel',
    category: 'Naturel',
    color: '#A0785A', bgColor: 'rgba(160,120,90,0.15)', emoji: '🐠',
    photoUrl: null,
  },
  {
    id: 'sangsue',
    name: 'Sangsue',
    brand: 'Naturel',
    category: 'Naturel',
    color: '#A0785A', bgColor: 'rgba(160,120,90,0.15)', emoji: '🪱',
    photoUrl: null,
  },
  {
    id: 'grenouille',
    name: 'Grenouille',
    brand: 'Naturel',
    category: 'Naturel',
    color: '#A0785A', bgColor: 'rgba(160,120,90,0.15)', emoji: '🐸',
    photoUrl: null,
  },
  {
    id: 'ecrevisse',
    name: 'Écrevisse',
    brand: 'Naturel',
    category: 'Naturel',
    color: '#A0785A', bgColor: 'rgba(160,120,90,0.15)', emoji: '🦞',
    photoUrl: null,
  },
  {
    id: 'maggot',
    name: 'Vers à fraise (maggot)',
    brand: 'Naturel',
    category: 'Naturel',
    color: '#A0785A', bgColor: 'rgba(160,120,90,0.15)', emoji: '🪱',
    photoUrl: null,
  },
];

/** Toutes les catégories disponibles dans le catalogue */
export const ALL_LURE_CATEGORIES: LureCategory[] = [
  'Cuillère tournante',
  'Cuillère ondulante',
  'Poisson nageur',
  'Surface',
  'Jig',
  'Leurre souple',
  'Mouche',
  'Naturel',
];

/** Retourne la config d'un leurre par son id, ou null si non trouvé */
export function getLureById(id: string): LureConfig | null {
  return LURES_CATALOG.find((l) => l.id === id) ?? null;
}

/** Retourne la config d'un leurre par son nom (insensible à la casse), ou null */
export function getLureByName(name: string): LureConfig | null {
  const lower = name.toLowerCase();
  return LURES_CATALOG.find((l) => l.name.toLowerCase() === lower) ?? null;
}

/** Filtre les leurres par catégorie et/ou texte de recherche */
export function filterLures(
  query: string,
  category: LureCategory | null,
): LureConfig[] {
  let results = LURES_CATALOG;

  if (category) {
    results = results.filter((l) => l.category === category);
  }

  if (query.trim()) {
    const q = query.toLowerCase();
    results = results.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.brand.toLowerCase().includes(q) ||
        l.category.toLowerCase().includes(q),
    );
  }

  return results;
}
