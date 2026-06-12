import * as Location from 'expo-location';

import { withTimeout } from '@/lib/net';

// ─── Acquisition GPS robuste (Android) ────────────────────────────────────────
// Sur Android, getCurrentPositionAsync(High) peut bloquer très longtemps
// (démarrage GPS à froid, intérieur, ciel obstrué). Stratégie en cascade :
//   1. Dernière position connue très récente (< 30 s) → instantané
//   2. Fix GPS précis avec timeout
//   3. Précision réduite (réseau/wifi) — souvent instantané sur Android
//   4. Dernière position connue (≤ 10 min) — mieux que rien
// Retourne null si aucune position n'est disponible.

export async function getPositionSafe(timeoutMs = 12000): Promise<Location.LocationObject | null> {
  // 1) Position connue très récente — instantané (utile en bateau, GPS déjà chaud)
  try {
    const recent = await Location.getLastKnownPositionAsync({ maxAge: 30 * 1000 });
    if (recent) return recent;
  } catch { /* on continue */ }

  // 2) Fix GPS précis, mais borné dans le temps
  try {
    return await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      timeoutMs,
      'GPS précis',
    );
  } catch { /* on continue */ }

  // 3) Précision réduite (cellulaire/wifi)
  try {
    return await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      5000,
      'GPS approximatif',
    );
  } catch { /* on continue */ }

  // 4) Dernière position connue, même un peu vieille
  try {
    return await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 });
  } catch {
    return null;
  }
}
