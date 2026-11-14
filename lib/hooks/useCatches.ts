import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import { useAuth } from '@/contexts/AuthContext';
import type { CachedCatch } from '@/lib/catchCache';
import {
  getCatchStoreSnapshot,
  refreshCatches,
  setCatchStoreUser,
  subscribeCatchStore,
} from '@/lib/catchStore';

const NO_CATCHES: CachedCatch[] = [];

export type UseCatchesResult = {
  /** Prises à afficher : cache du serveur + prises en attente, plus récentes d'abord. */
  catches: CachedCatch[];
  /** Vrai tant que la lecture locale n'est pas terminée (quelques millisecondes). */
  loading: boolean;
  /** Une mise à jour serveur est en cours, en arrière-plan. */
  refreshing: boolean;
  /** Les données affichées viennent de l'appareil (serveur non joint récemment). */
  fromCache: boolean;
  pendingCount: number;
  lastServerSyncAt: number | null;
  refresh: (force?: boolean) => Promise<boolean>;
};

/**
 * Prises de l'utilisateur, lues localement puis mises à jour en arrière-plan.
 * À utiliser dans tout écran qui affiche des prises — ne pas interroger
 * Supabase directement depuis un écran.
 */
export function useCatches(): UseCatchesResult {
  const { user, cachedUserId } = useAuth();
  const userId = user?.id ?? cachedUserId ?? null;
  const sessionUserId = user?.id ?? null;

  const snap = useSyncExternalStore(subscribeCatchStore, getCatchStoreSnapshot, getCatchStoreSnapshot);

  useEffect(() => {
    setCatchStoreUser(userId);
  }, [userId]);

  // À chaque retour sur l'écran (et quand la session devient disponible) :
  // demande de mise à jour, limitée en fréquence par le magasin.
  useFocusEffect(
    useCallback(() => {
      if (sessionUserId) refreshCatches().catch(() => undefined);
    }, [sessionUserId]),
  );

  const refresh = useCallback((force = true) => refreshCatches({ force }), []);

  // Le magasin peut encore pointer sur l'utilisateur précédent pendant un rendu.
  const ready = snap.userId === userId && userId != null;

  return {
    catches: ready ? snap.catches : NO_CATCHES,
    loading: userId != null && (!ready || !snap.hydrated),
    refreshing: ready && snap.refreshing,
    fromCache: ready && snap.hydrated && snap.source === 'cache',
    pendingCount: ready ? snap.pendingCount : 0,
    lastServerSyncAt: ready ? snap.lastServerSyncAt : null,
    refresh,
  };
}
