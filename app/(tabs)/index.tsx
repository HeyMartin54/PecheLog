import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { DEV_TEST_USER_ID } from '@/lib/dev-test-user';
import { useLocation } from '@/lib/hooks/useLocation';
import { useWeather } from '@/lib/hooks/useWeather';
import { supabase } from '@/lib/supabase';

type Stat = {
  label: string;
  value: string;
};

type CatchRow = {
  id: string;
  species: string;
  lake_name: string | null;
  lure: string | null;
  weight_lbs: number | null;
  caught_at: string;
};

function formatRelativeTimeFr(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffM = Math.floor(diffMs / 60000);
  if (diffM < 1) return "à l'instant";
  if (diffM < 60) return `il y a ${diffM} min`;
  const diffH = Math.floor(diffM / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'hier';
  if (diffD < 7) return `il y a ${diffD} j`;
  return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
}

function catchMetaLine(row: CatchRow): string {
  const lake = row.lake_name?.trim() || 'Lieu inconnu';
  const when = formatRelativeTimeFr(row.caught_at);
  const lure = row.lure?.trim();
  return lure ? `${lake} · ${when} · ${lure}` : `${lake} · ${when}`;
}

function sizeLabel(row: CatchRow): string {
  if (row.weight_lbs != null && !Number.isNaN(row.weight_lbs)) {
    return `${row.weight_lbs.toFixed(1)} lb`;
  }
  return '—';
}

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { coords, lakeName } = useLocation();
  const { temperatureC, windKmh } = useWeather(
    coords?.coords.latitude ?? null,
    coords?.coords.longitude ?? null,
  );

  const [displayName, setDisplayName] = useState<string>('Pêcheur');
  const [stats, setStats] = useState<Stat[]>([
    { label: 'Prises', value: '—' },
    { label: 'Lacs', value: '—' },
    { label: 'lb record', value: '—' },
  ]);
  const [recentCatches, setRecentCatches] = useState<CatchRow[]>([]);
  const [homeDataLoading, setHomeDataLoading] = useState(false);

  const loadHomeData = useCallback(async () => {
    const effectiveUserId = user?.id ?? DEV_TEST_USER_ID;

    if (!user?.id) {
      setDisplayName('Pêcheur');
    }

    setHomeDataLoading(true);
    try {
      if (user?.id) {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', user.id)
          .maybeSingle();

        if (profileError) {
          console.warn('[Home] Erreur profil', profileError);
        } else if (profile?.display_name?.trim()) {
          setDisplayName(profile.display_name.trim());
        } else if (user.email) {
          setDisplayName(user.email.split('@')[0] ?? 'Pêcheur');
        }
      }

      const { data: rows, error: catchesError } = await supabase
        .from('catches')
        .select('id, species, lake_name, lure, weight_lbs, caught_at')
        .eq('user_id', effectiveUserId)
        .order('caught_at', { ascending: false });

      if (catchesError) {
        console.warn('[Home] Erreur prises', catchesError);
        return;
      }

      const list = rows ?? [];
      const lakeSet = new Set(
        list.map((r) => r.lake_name?.trim()).filter((n): n is string => !!n?.length),
      );
      const weights = list
        .map((r) => r.weight_lbs)
        .filter((w): w is number => typeof w === 'number' && !Number.isNaN(w));
      const recordLb = weights.length > 0 ? Math.max(...weights) : null;

      setStats([
        { label: 'Prises', value: String(list.length) },
        { label: 'Lacs', value: String(lakeSet.size) },
        {
          label: 'lb record',
          value: recordLb != null ? recordLb.toFixed(1) : '—',
        },
      ]);
      setRecentCatches(list.slice(0, 5));
    } finally {
      setHomeDataLoading(false);
    }
  }, [user?.id, user?.email]);

  useFocusEffect(
    useCallback(() => {
      loadHomeData();
    }, [loadHomeData]),
  );

  const headerLakeName = lakeName ?? 'Lac inconnu';
  const headerTemp =
    temperatureC != null ? `${temperatureC.toFixed(1)}°C` : 'Météo…';
  const headerWind =
    windKmh != null ? `${windKmh.toFixed(1)} km/h` : 'Vent…';

  const handleQuickLogPress = () => {
    router.push('/log-catch');
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.greeting}>Bonjour 👋</Text>
          <Text style={styles.name}>{displayName}</Text>
          <View style={styles.weatherRow}>
            <Text style={styles.weatherLocation} numberOfLines={2}>
              ☀️ {headerLakeName}
            </Text>
            <View style={styles.weatherBadgesRow}>
              <Text style={styles.weatherBadge}>🌡 {headerTemp}</Text>
              <Text style={styles.weatherBadge}>💨 {headerWind}</Text>
            </View>
          </View>
        </View>

        {/* Quick log button */}
        <TouchableOpacity style={styles.quickLogButton} activeOpacity={0.9} onPress={handleQuickLogPress}>
          <View style={styles.quickLogIcon}>
            <Text style={styles.quickLogIconText}>🎣</Text>
          </View>
          <View style={styles.quickLogText}>
            <Text style={styles.quickLogTitle}>Nouvelle prise !</Text>
            <Text style={styles.quickLogSubtitle}>Touche 1 bouton — on s&apos;occupe du reste</Text>
          </View>
        </TouchableOpacity>

        {/* Stats row */}
        <View style={styles.statsRow}>
          {homeDataLoading ? (
            <View style={styles.statsLoading}>
              <ActivityIndicator color={ACCENT} />
            </View>
          ) : (
            stats.map((stat) => (
              <View key={stat.label} style={styles.statCard}>
                <Text style={styles.statValue}>{stat.value}</Text>
                <Text style={styles.statLabel}>{stat.label}</Text>
              </View>
            ))
          )}
        </View>

        {/* Recent catches */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Prises récentes</Text>
          <Text style={styles.sectionLink}>Voir tout →</Text>
        </View>

        <View>
          {recentCatches.length === 0 && !homeDataLoading ? (
            <Text style={styles.emptyRecent}>
              {user?.id
                ? 'Aucune prise pour l’instant. Enregistre ta première avec le bouton ci-dessus.'
                : 'Aucune prise affichée (mode sans compte : vérifie la politique RLS SELECT sur catches, ou connecte-toi avec le compte de test).'}
            </Text>
          ) : (
            recentCatches.map((catchItem) => (
              <TouchableOpacity
                key={catchItem.id}
                style={styles.catchCard}
                activeOpacity={0.8}
                onPress={() => router.push(`/catch-detail?id=${catchItem.id}`)}
              >
                <View style={styles.catchThumb}>
                  <Text style={styles.catchThumbText}>🐟</Text>
                </View>
                <View style={styles.catchInfo}>
                  <Text style={styles.catchSpecies}>{catchItem.species}</Text>
                  <Text style={styles.catchMeta}>{catchMetaLine(catchItem)}</Text>
                </View>
                <Text style={styles.catchSize}>{sizeLabel(catchItem)}</Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const ACCENT = '#00E6B5';
const CARD_BG = '#0E2236';
const BORDER = 'rgba(255,255,255,0.06)';
const TEXT_MUTED = 'rgba(255,255,255,0.6)';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#061425',
  },
  scrollContent: {
    paddingTop: 10,
    paddingBottom: 90,
  },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  greeting: {
    fontSize: 14,
    color: TEXT_MUTED,
    marginBottom: 2,
  },
  name: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: '#FFFFFF',
  },
  weatherRow: {
    marginTop: 10,
    gap: 8,
  },
  weatherLocation: {
    fontSize: 13,
    color: TEXT_MUTED,
    lineHeight: 18,
  },
  weatherBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  weatherBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    fontSize: 12,
    color: ACCENT,
    backgroundColor: 'rgba(0, 212, 170, 0.08)',
  },
  quickLogButton: {
    marginHorizontal: 24,
    marginBottom: 24,
    paddingVertical: 20,
    paddingHorizontal: 24,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: ACCENT,
    shadowColor: '#00D4AA',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 6,
  },
  quickLogIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLogIconText: {
    fontSize: 26,
  },
  quickLogText: {
    flex: 1,
  },
  quickLogTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  quickLogSubtitle: {
    fontSize: 13,
    marginTop: 2,
    color: 'rgba(255,255,255,0.85)',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'stretch',
    paddingHorizontal: 24,
    marginBottom: 24,
    minHeight: 88,
  },
  statsLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyRecent: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    fontSize: 14,
    color: TEXT_MUTED,
    lineHeight: 20,
  },
  statCard: {
    flex: 1,
    marginHorizontal: 4,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: ACCENT,
  },
  statLabel: {
    marginTop: 4,
    fontSize: 11,
    color: TEXT_MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  sectionLink: {
    fontSize: 13,
    color: ACCENT,
  },
  catchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  catchThumb: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CARD_BG,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  catchThumbText: {
    fontSize: 22,
  },
  catchInfo: {
    flex: 1,
  },
  catchSpecies: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  catchMeta: {
    marginTop: 2,
    fontSize: 12,
    color: TEXT_MUTED,
  },
  catchSize: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginLeft: 8,
  },
});
