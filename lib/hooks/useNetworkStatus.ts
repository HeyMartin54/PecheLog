import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

import { isStateOnline } from '@/lib/net';

/**
 * true  = internet semble utilisable (connecté ET joignable)
 * false = hors-ligne, ou connecté à un réseau sans accès internet
 * null  = pas encore déterminé
 *
 * Sert à l'AFFICHAGE (badge, messages). Aucun écran ne doit s'en servir pour
 * décider de lire ou non ses données : elles viennent toujours du magasin local.
 */
export function useNetworkStatus(): boolean | null {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      // isConnected null = l'OS ne sait pas encore → on reste indéterminé
      setOnline(state.isConnected == null ? null : isStateOnline(state));
    });
    return unsubscribe;
  }, []);

  return online;
}
