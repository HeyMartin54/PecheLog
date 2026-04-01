// ─── PêcheLog Design System — Option A "Eau profonde" ────────────────────────
// Source unique pour toutes les couleurs, typographie et espacements de l'app.

export const colors = {
  // ── Arrière-plans ──────────────────────────────────────────────────────────
  bg:       '#060F1A',   // fond principal (très sombre)
  surface:  '#0D1E2F',   // cartes, modales
  surface2: '#132840',   // cartes imbriquées, inputs

  // ── Couleur d'accentuation ─────────────────────────────────────────────────
  accent:        '#00D4AA',
  accentGlow:    'rgba(0, 212, 170, 0.18)',
  accentSubtle:  'rgba(0, 212, 170, 0.10)',
  accentStrong:  'rgba(0, 212, 170, 0.25)',

  // ── Texte ─────────────────────────────────────────────────────────────────
  textPrimary: '#FFFFFF',
  textMuted:   'rgba(255, 255, 255, 0.55)',
  textSubtle:  'rgba(255, 255, 255, 0.32)',

  // ── Bordures ──────────────────────────────────────────────────────────────
  border:       'rgba(255, 255, 255, 0.08)',
  borderStrong: 'rgba(255, 255, 255, 0.16)',

  // ── Statuts ───────────────────────────────────────────────────────────────
  warning: '#F5A623',
  warningSubtle: 'rgba(245, 166, 35, 0.12)',
  success: '#2ECC71',
  successSubtle: 'rgba(46, 204, 113, 0.12)',
  error:   '#FF5E5E',
  errorSubtle: 'rgba(255, 94, 94, 0.10)',

  // ── Navigation ────────────────────────────────────────────────────────────
  tabBar:        '#080F1A',
  tabBarBorder:  'rgba(255, 255, 255, 0.07)',
  tabActive:     '#00D4AA',
  tabInactive:   'rgba(255, 255, 255, 0.38)',

  // ── Espèces de poissons ───────────────────────────────────────────────────
  species: {
    dore:    '#FFD700',
    brochet: '#3DBA78',
    truite:  '#4BAEE8',
    touladi: '#9BA8B5',
    achigan: '#E8894A',
    maskinonge: '#C77DDB',
    perchaude: '#F0B429',
    default: '#8899AA',
  } as Record<string, string>,
};

export const typography = {
  h1:        { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5 },
  h2:        { fontSize: 22, fontWeight: '600' as const, letterSpacing: -0.3 },
  h3:        { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.1 },
  body:      { fontSize: 15, fontWeight: '400' as const, lineHeight: 22 },
  bodySmall: { fontSize: 13, fontWeight: '400' as const, lineHeight: 19 },
  caption:   { fontSize: 11, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.8 },
  label:     { fontSize: 12, fontWeight: '500' as const },
  numeric:   { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.5 },
};

export const spacing = {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  xxl:  28,
  full: 999,
};

export const shadow = {
  accent: {
    shadowColor: '#00D4AA',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 6,
  },
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.20,
    shadowRadius: 8,
    elevation: 3,
  },
};
