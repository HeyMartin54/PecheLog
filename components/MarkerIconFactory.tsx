import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

// ─────────────────────────────────────────────────────────────────────────────
// Fabrique d'icônes de marqueurs.
//
// Pourquoi : sur Android, react-native-maps capture les *vues custom* d'un marqueur
// dans un bitmap, mais le rendu est rogné/décalé (cercles coupés à droite/en bas) de
// façon non corrigeable via tracksViewChanges. On contourne complètement le problème :
// on dessine chaque icône hors-écran, on la capture en PNG (react-native-view-shot, qui
// rend la sous-vue en logiciel — fiable, transformes/overflow/borderRadius respectés),
// puis le marqueur utilise `image={{uri}}`. Un <Marker image> est un bitmap natif :
// aucune vue custom n'est capturée par la carte.
//
// Comme view-shot rend fidèlement, on garde le vrai teardrop (prise unique) et le split
// bicolore PROPORTIONNEL (clusters). Les couleurs custom des espèces sont préservées
// (pinColor natif les approximerait à une teinte standard sur Android).
// ─────────────────────────────────────────────────────────────────────────────

export type MarkerSpec =
  | { kind: 'pin'; sig: string; color: string }
  | {
      kind: 'cluster';
      sig: string;
      color1: string;
      color2: string;
      multi: boolean;
      label: string;
      big: boolean;
      n1: number; // nb de l'espèce dominante (segment gauche)
      n2: number; // nb des autres espèces (segment droit)
    };

// Pin = cercle (tête) + triangle vers le bas (bordures) — AUCUNE transform : view-shot
// produisait un PNG vide/invalide avec rotate (→ Fresco échoue → marqueur rouge par défaut).
// Contenu collé en bas du canevas (paddingBottom) → la pointe est à PIN_CANVAS-PIN_PAD_BOTTOM.
const PIN_CANVAS = 48;
const CLUSTER_CANVAS = 52;
const PIN_PAD_BOTTOM = 2;

/** Ancre du marqueur image selon le type (cohérente avec la géométrie ci-dessus). */
export const PIN_ANCHOR = { x: 0.5, y: (PIN_CANVAS - PIN_PAD_BOTTOM) / PIN_CANVAS }; // ≈ {0.5,0.96}
export const CLUSTER_ANCHOR = { x: 0.5, y: 0.5 };

function Design({ spec }: { spec: MarkerSpec }) {
  if (spec.kind === 'pin') {
    // Tête ronde + triangle bas (bordures), sans transform → capture fiable.
    return (
      <>
        <View style={[styles.pinHead, { backgroundColor: spec.color }]}>
          <View style={styles.pinDot} />
        </View>
        <View style={[styles.pinTail, { borderTopColor: spec.color }]} />
      </>
    );
  }
  return (
    <View style={styles.wrap}>
      {spec.multi ? (
        <View style={styles.innerCircle}>
          {/* Split PROPORTIONNEL ; overflow:hidden du cercle découpe les segments
              (fiable via le rendu logiciel de view-shot). */}
          <View style={{ flex: spec.n1, backgroundColor: spec.color1 }} />
          <View style={{ flex: spec.n2, backgroundColor: spec.color2 }} />
        </View>
      ) : (
        <View style={[styles.full, { backgroundColor: spec.color1 }]} />
      )}
      <View style={styles.numWrap}>
        <Text style={[styles.num, spec.big && { fontSize: 11 }]}>{spec.label}</Text>
      </View>
    </View>
  );
}

const MAX_ATTEMPTS = 6;

// Un data-uri PNG valide et non vide. Une capture ratée renvoie '', undefined, ou une
// chaîne trop courte → on refuse de la mettre en cache (sinon marqueur rouge permanent).
function isValidPng(uri: string | null | undefined): uri is string {
  return !!uri && uri.startsWith('data:image') && uri.length > 120;
}

function Capture({
  spec,
  onCaptured,
}: {
  spec: MarkerSpec;
  onCaptured: (sig: string, uri: string) => void;
}) {
  const ref = useRef<View>(null);
  const size = spec.kind === 'pin' ? PIN_CANVAS : CLUSTER_CANVAS;
  const cancelledRef = useRef(false);
  const startedRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const attempt = useCallback(
    async (n: number) => {
      if (cancelledRef.current) return;
      try {
        // data-uri : géré nativement par react-native-maps (uri.startsWith("data:")).
        // width/height explicites → bitmap de taille définie.
        const uri = await captureRef(ref, {
          format: 'png',
          quality: 1,
          result: 'data-uri',
          width: size,
          height: size,
        });
        if (cancelledRef.current) return;
        if (isValidPng(uri)) {
          onCaptured(spec.sig, uri);
          return;
        }
        throw new Error('capture vide/invalide');
      } catch (e) {
        if (cancelledRef.current) return;
        if (n < MAX_ATTEMPTS) {
          setTimeout(() => attempt(n + 1), 100 * n); // backoff croissant
        } else {
          console.warn('[MarkerIconFactory] capture abandonnée', spec.sig, e);
        }
      }
    },
    [spec.sig, size, onCaptured],
  );

  // Capture déclenchée APRÈS le layout de la vue (dimensions réelles connues), puis un
  // court délai pour laisser le paint se faire. Plus fiable qu'un setTimeout à l'aveugle.
  const onLayout = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setTimeout(() => attempt(1), 60);
  }, [attempt]);

  return (
    <View
      ref={ref}
      collapsable={false}
      onLayout={onLayout}
      style={spec.kind === 'pin' ? styles.pinRoot : styles.clusterRoot}
    >
      <Design spec={spec} />
    </View>
  );
}

/**
 * Génère (et met en cache) les icônes PNG pour les specs demandées.
 * Retourne la table sig→uri et l'élément `renderer` à monter dans l'arbre
 * (vues de capture cachées hors-écran).
 */
export function useMarkerIcons(specs: MarkerSpec[]): {
  icons: Record<string, string>;
  renderer: ReactNode;
} {
  const [icons, setIcons] = useState<Record<string, string>>({});

  const onCaptured = useCallback((sig: string, uri: string) => {
    setIcons((prev) => (prev[sig] ? prev : { ...prev, [sig]: uri }));
  }, []);

  // Specs non encore capturées, dédupliquées par signature.
  const seen = new Set<string>();
  const pending = specs.filter((s) => {
    if (icons[s.sig] || seen.has(s.sig)) return false;
    seen.add(s.sig);
    return true;
  });

  const renderer = (
    <View style={styles.hidden} pointerEvents="none">
      {pending.map((s) => (
        <Capture key={s.sig} spec={s} onCaptured={onCaptured} />
      ))}
    </View>
  );

  return { icons, renderer };
}

const styles = StyleSheet.create({
  // Hors-écran : la capture rend la sous-vue en logiciel, l'occlusion/visibilité
  // n'a donc pas d'importance ; on la sort juste du champ de vision.
  hidden: { position: 'absolute', top: -2000, left: -2000 },

  // ── Canevas de capture (fond transparent + marge pour l'anti-aliasing) ──
  pinRoot: {
    width: PIN_CANVAS,
    height: PIN_CANVAS,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: PIN_PAD_BOTTOM,
    backgroundColor: 'transparent',
  },
  clusterRoot: {
    width: CLUSTER_CANVAS,
    height: CLUSTER_CANVAS,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },

  // ── Pin (tête ronde + triangle, sans transform) ──
  pinHead: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  pinTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -4,
  },
  pinDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },

  // ── Cluster ──
  wrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(13,30,47,0.15)',
  },
  full: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  innerCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  numWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  num: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
});
