import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useNetworkStatus } from '@/lib/hooks/useNetworkStatus';
import { getSpeciesConfig } from '@/lib/species';
import { supabase } from '@/lib/supabase';
import { CATCH_SELECT_ALL, loadCatchesCache, saveCatchesCache } from '@/lib/catchCache';
import { colors, radius, spacing, typography } from '@/lib/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

type CatchRow = {
  id: string;
  species: string;
  lure: string | null;
  lake_name: string | null;
  depth_meters: number | null;
  weight_lbs: number | null;
  length_inches: number | null;
  size_category: string | null;
  caught_at: string;
};

type Period = '7d' | '30d' | 'year' | 'all';

const PERIOD_LABEL_KEYS: Record<Period, string> = {
  '7d': 'stats.period7d',
  '30d': 'stats.period30d',
  year: 'stats.periodYear',
  all: 'stats.periodAll',
};

const TIME_SLOTS = [
  { labelKey: 'stats.morning', icon: 'sunny-outline' as const, range: [5, 10] },
  { labelKey: 'stats.noon', icon: 'partly-sunny-outline' as const, range: [10, 14] },
  { labelKey: 'stats.afternoon', icon: 'sunny' as const, range: [14, 18] },
  { labelKey: 'stats.evening', icon: 'moon-outline' as const, range: [18, 29] },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function applyPeriodFilter(list: CatchRow[], period: Period): CatchRow[] {
  if (period === 'all') return list;
  const now = new Date();
  let cutoff: Date;
  if (period === '7d') cutoff = new Date(now.getTime() - 7 * 86_400_000);
  else if (period === '30d') cutoff = new Date(now.getTime() - 30 * 86_400_000);
  else cutoff = new Date(now.getFullYear(), 0, 1);
  return list.filter((c) => new Date(c.caught_at) >= cutoff);
}

function buildLast12Months(all: CatchRow[]): { month: string; count: number }[] {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return {
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      count: 0,
    };
  });
  for (const c of all) {
    const d = new Date(c.caught_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const entry = months.find((m) => m.month === key);
    if (entry) entry.count++;
  }
  return months;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[chipStyles.chip, active && chipStyles.active]}
      activeOpacity={0.75}
    >
      <Text style={[chipStyles.label, active && chipStyles.labelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  active: {
    backgroundColor: colors.accentSubtle,
    borderColor: colors.accent,
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
  },
  labelActive: {
    color: colors.accent,
  },
});

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={cardStyles.card}>
      <Text style={cardStyles.title}>{title}</Text>
      {children}
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    ...typography.h3,
    color: colors.textPrimary,
  },
});

function KpiCard({ value, label }: { value: string; label: string }) {
  return (
    <View style={kpiStyles.card}>
      <Text style={kpiStyles.value}>{value}</Text>
      <Text style={kpiStyles.label}>{label}</Text>
    </View>
  );
}

const kpiStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    gap: 2,
  },
  value: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.accent,
    letterSpacing: -0.5,
  },
  label: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    fontSize: 9,
  },
});

function HBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <View style={hbarStyles.row}>
      <Text style={hbarStyles.label} numberOfLines={1}>
        {label}
      </Text>
      <View style={hbarStyles.track}>
        <View style={[hbarStyles.fill, { width: `${pct}%` as `${number}%`, backgroundColor: color }]} />
      </View>
      <Text style={hbarStyles.value}>{value}</Text>
    </View>
  );
}

const hbarStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { ...typography.bodySmall, color: colors.textMuted, width: 108 },
  track: {
    flex: 1,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.full },
  value: { ...typography.label, color: colors.textPrimary, width: 28, textAlign: 'right' },
});

function MonthlyChart({ data, locale }: { data: { month: string; count: number }[]; locale: string }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <View style={mcStyles.container}>
      {data.map((item) => {
        const heightPct = Math.max((item.count / max) * 100, item.count > 0 ? 4 : 0);
        const mIdx = parseInt(item.month.split('-')[1], 10) - 1;
        const monthLabel = new Date(2000, mIdx, 1)
          .toLocaleDateString(locale, { month: 'short' })
          .replace('.', '');
        return (
          <View key={item.month} style={mcStyles.col}>
            <Text style={mcStyles.count}>{item.count > 0 ? item.count : ''}</Text>
            <View style={mcStyles.track}>
              <View style={[mcStyles.bar, { height: `${heightPct}%` as `${number}%` }]} />
            </View>
            <Text style={mcStyles.monthLabel}>{monthLabel}</Text>
          </View>
        );
      })}
    </View>
  );
}

const mcStyles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'flex-end', height: 110, gap: 3 },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  track: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', backgroundColor: colors.accent, borderRadius: 3 },
  count: { ...typography.caption, color: colors.accent, fontSize: 9, marginBottom: 1 },
  monthLabel: { ...typography.caption, color: colors.textSubtle, fontSize: 9, marginTop: 3 },
});

function TimeOfDayChart({ data }: { data: { label: string; icon: typeof TIME_SLOTS[0]['icon']; count: number }[] }) {
  const max = Math.max(...data.map((s) => s.count), 1);
  const topCount = Math.max(...data.map((s) => s.count));
  return (
    <View style={todStyles.row}>
      {data.map((slot) => {
        const heightPct = Math.max((slot.count / max) * 100, slot.count > 0 ? 6 : 0);
        const isTop = slot.count === topCount && slot.count > 0;
        return (
          <View key={slot.label} style={todStyles.col}>
            <Text style={todStyles.count}>{slot.count > 0 ? slot.count : ''}</Text>
            <View style={todStyles.track}>
              <View
                style={[
                  todStyles.bar,
                  {
                    height: `${heightPct}%` as `${number}%`,
                    backgroundColor: isTop ? colors.accent : colors.accentSubtle,
                    borderWidth: isTop ? 0 : 1,
                    borderColor: colors.accentGlow,
                  },
                ]}
              />
            </View>
            <Ionicons name={slot.icon} size={13} color={colors.textMuted} />
            <Text style={todStyles.slotLabel}>{slot.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const todStyles = StyleSheet.create({
  row: { flexDirection: 'row', height: 100, gap: spacing.sm },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  track: { flex: 1, width: '80%', justifyContent: 'flex-end', marginBottom: spacing.xs },
  bar: { width: '100%', borderRadius: 4 },
  count: { ...typography.caption, color: colors.accent, fontSize: 10, marginBottom: 2 },
  slotLabel: { ...typography.caption, color: colors.textSubtle, fontSize: 9, marginTop: 2 },
});

function RecordTile({
  icon,
  iconColor,
  value,
  sublabel,
  species,
}: {
  icon: string;
  iconColor: string;
  value: string;
  sublabel: string;
  species?: string;
}) {
  return (
    <View style={recStyles.tile}>
      <Ionicons name={icon as any} size={18} color={iconColor} />
      <Text style={recStyles.tileValue}>{value}</Text>
      <Text style={recStyles.tileSub}>{sublabel}</Text>
      {species ? <Text style={recStyles.tileSpecies} numberOfLines={1}>{species}</Text> : null}
    </View>
  );
}

const recStyles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flex: 1,
    minWidth: '44%',
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    alignItems: 'center',
    gap: 3,
  },
  tileValue: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.3 },
  tileSub: { ...typography.caption, color: colors.textMuted, fontSize: 9 },
  tileSpecies: { ...typography.bodySmall, color: colors.textSubtle, fontSize: 11 },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function StatsScreen() {
  const { user, cachedUserId } = useAuth();
  const { t, locale, fmtWeight, fmtLength } = useSettings();
  const isConnected = useNetworkStatus();
  const insets = useSafeAreaInsets();
  const [allCatches, setAllCatches] = useState<CatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<Period>('all');
  const [speciesFilter, setSpeciesFilter] = useState<string | null>(null);
  const [lakeFilter, setLakeFilter] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const loadData = useCallback(async () => {
    const userId = user?.id ?? cachedUserId;
    if (!userId) return;
    setLoading(true);

    // Pas de session active ou hors-ligne → toujours utiliser le cache
    if (!user?.id || isConnected === false) {
      const cached = await loadCatchesCache(userId);
      if (cached) {
        setAllCatches(cached as unknown as CatchRow[]);
        setFromCache(true);
      }
      setLoading(false);
      return;
    }

    setFromCache(false);
    try {
      const { data, error } = await supabase
        .from('catches')
        .select(CATCH_SELECT_ALL)
        .eq('user_id', userId)
        .order('caught_at', { ascending: false });
      if (!error && data) {
        setAllCatches(data as unknown as CatchRow[]);
        await saveCatchesCache(userId, data as never);
      } else if (error) {
        // Fallback cache si erreur réseau inattendue
        const cached = await loadCatchesCache(userId);
        if (cached) { setAllCatches(cached as unknown as CatchRow[]); setFromCache(true); }
      }
    } finally {
      setLoading(false);
    }
  }, [user?.id, cachedUserId, isConnected]);

  useFocusEffect(
    useCallback(() => {
      loadData().catch(console.warn);
    }, [loadData]),
  );

  // ── Filtered list (period + optional species/lake) ────────────────────────
  const filtered = useMemo(() => {
    let list = applyPeriodFilter(allCatches, period);
    if (speciesFilter) list = list.filter((c) => c.species === speciesFilter);
    if (lakeFilter) list = list.filter((c) => c.lake_name === lakeFilter);
    return list;
  }, [allCatches, period, speciesFilter, lakeFilter]);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const lakes = new Set(filtered.map((c) => c.lake_name).filter(Boolean));
    const species = new Set(filtered.map((c) => c.species));
    const weights = filtered.flatMap((c) => (c.weight_lbs != null ? [c.weight_lbs] : []));
    return {
      total: filtered.length,
      lakes: lakes.size,
      species: species.size,
      maxWeight: weights.length > 0 ? Math.max(...weights) : null,
    };
  }, [filtered]);

  // ── Monthly chart (always all catches, last 12 months) ────────────────────
  const monthlyData = useMemo(() => buildLast12Months(allCatches), [allCatches]);

  // ── By species ────────────────────────────────────────────────────────────
  const speciesData = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of filtered) map.set(c.species, (map.get(c.species) ?? 0) + 1);
    return [...map.entries()]
      .map(([species, count]) => ({ species, count }))
      .sort((a, b) => b.count - a.count);
  }, [filtered]);

  // ── By lure ───────────────────────────────────────────────────────────────
  const lureData = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of filtered) if (c.lure) map.set(c.lure, (map.get(c.lure) ?? 0) + 1);
    return [...map.entries()]
      .map(([lure, count]) => ({ lure, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 7);
  }, [filtered]);

  // ── Time of day ───────────────────────────────────────────────────────────
  const timeData = useMemo(() => {
    const slots = TIME_SLOTS.map((s) => ({ ...s, label: t(s.labelKey), count: 0 }));
    for (const c of filtered) {
      const h = new Date(c.caught_at).getHours();
      for (const slot of slots) {
        if (h >= slot.range[0] && h < slot.range[1]) { slot.count++; break; }
      }
    }
    return slots;
  }, [filtered, t]);

  // ── Depth buckets ─────────────────────────────────────────────────────────
  const depthData = useMemo(() => {
    const buckets = [
      { label: '0 – 2 m', min: 0, max: 2, count: 0 },
      { label: '2 – 5 m', min: 2, max: 5, count: 0 },
      { label: '5 – 10 m', min: 5, max: 10, count: 0 },
      { label: '10 m +', min: 10, max: Infinity, count: 0 },
    ];
    for (const c of filtered) {
      if (c.depth_meters == null) continue;
      for (const b of buckets) {
        if (c.depth_meters >= b.min && c.depth_meters < b.max) { b.count++; break; }
      }
    }
    return buckets;
  }, [filtered]);
  const hasDepthData = depthData.some((b) => b.count > 0);

  // ── Records ───────────────────────────────────────────────────────────────
  const records = useMemo(() => {
    const heaviest = [...filtered]
      .filter((c) => c.weight_lbs != null)
      .sort((a, b) => (b.weight_lbs ?? 0) - (a.weight_lbs ?? 0))[0] ?? null;
    const longest = [...filtered]
      .filter((c) => c.length_inches != null)
      .sort((a, b) => (b.length_inches ?? 0) - (a.length_inches ?? 0))[0] ?? null;
    const trophyCount = filtered.filter((c) => c.size_category === 'trophy').length;
    const dayMap = new Map<string, number>();
    for (const c of filtered) {
      const day = new Date(c.caught_at).toISOString().slice(0, 10);
      dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
    }
    const bestDayCount = dayMap.size > 0 ? Math.max(...dayMap.values()) : 0;
    const bestDayKey = [...dayMap.entries()].find(([, v]) => v === bestDayCount)?.[0] ?? null;
    return { heaviest, longest, trophyCount, bestDayCount, bestDayKey };
  }, [filtered]);

  // ── Filter option lists ───────────────────────────────────────────────────
  const speciesOptions = useMemo(
    () => [...new Set(allCatches.map((c) => c.species))].sort(),
    [allCatches],
  );
  const lakeOptions = useMemo(
    () => [...new Set(allCatches.map((c) => c.lake_name).filter((l): l is string => !!l))].sort(),
    [allCatches],
  );

  const showRecords =
    records.heaviest != null ||
    records.longest != null ||
    records.trophyCount > 0 ||
    records.bestDayCount > 0;

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>{t('stats.title')}</Text>
        {fromCache ? (
          <View style={styles.cacheNotice}>
            <Ionicons name="cloud-offline-outline" size={11} color={colors.warning} />
            <Text style={styles.cacheNoticeText}>{t('home.localData')}</Text>
          </View>
        ) : allCatches.length > 0 ? (
          <Text style={styles.headerSub}>{t('stats.totalCatches', { n: allCatches.length })}</Text>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : allCatches.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="bar-chart" size={36} color={colors.accent} />
          </View>
          <Text style={styles.emptyTitle}>{t('home.emptyTitle')}</Text>
          <Text style={styles.emptyBody}>{t('stats.emptyBody')}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: 96 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Filtre période ────────────────────────────────────────── */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {(Object.keys(PERIOD_LABEL_KEYS) as Period[]).map((p) => (
              <FilterChip
                key={p}
                label={t(PERIOD_LABEL_KEYS[p])}
                active={period === p}
                onPress={() => setPeriod(p)}
              />
            ))}
          </ScrollView>

          {/* ── Filtre espèce (si plusieurs) ──────────────────────────── */}
          {speciesOptions.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              <FilterChip
                label={t('stats.allSpecies')}
                active={speciesFilter === null}
                onPress={() => setSpeciesFilter(null)}
              />
              {speciesOptions.map((s) => (
                <FilterChip
                  key={s}
                  label={s}
                  active={speciesFilter === s}
                  onPress={() => setSpeciesFilter(speciesFilter === s ? null : s)}
                />
              ))}
            </ScrollView>
          )}

          {/* ── Filtre lac (si plusieurs) ─────────────────────────────── */}
          {lakeOptions.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              <FilterChip
                label={t('stats.allLakes')}
                active={lakeFilter === null}
                onPress={() => setLakeFilter(null)}
              />
              {lakeOptions.map((l) => (
                <FilterChip
                  key={l}
                  label={l}
                  active={lakeFilter === l}
                  onPress={() => setLakeFilter(lakeFilter === l ? null : l)}
                />
              ))}
            </ScrollView>
          )}

          {/* ── KPIs ─────────────────────────────────────────────────── */}
          <View style={styles.kpiRow}>
            <KpiCard value={String(kpis.total)} label={t('home.statCatches')} />
            <KpiCard value={String(kpis.lakes)} label={t('home.statLakes')} />
            <KpiCard value={String(kpis.species)} label={t('stats.kpiSpecies')} />
            <KpiCard
              value={kpis.maxWeight != null ? fmtWeight(kpis.maxWeight) : '—'}
              label={t('stats.kpiRecord')}
            />
          </View>

          {/* ── Prises par mois ──────────────────────────────────────── */}
          <SectionCard title={t('stats.byMonth')}>
            <MonthlyChart data={monthlyData} locale={locale} />
          </SectionCard>

          {/* ── Par espèce ───────────────────────────────────────────── */}
          {speciesData.length > 0 && (
            <SectionCard title={t('stats.bySpecies')}>
              <View style={styles.barList}>
                {speciesData.map((item) => (
                  <HBar
                    key={item.species}
                    label={item.species}
                    value={item.count}
                    max={speciesData[0].count}
                    color={getSpeciesConfig(item.species).color}
                  />
                ))}
              </View>
            </SectionCard>
          )}

          {/* ── Meilleurs leurres ────────────────────────────────────── */}
          {lureData.length > 0 && (
            <SectionCard title={t('stats.bestLures')}>
              <View style={styles.barList}>
                {lureData.map((item) => (
                  <HBar
                    key={item.lure}
                    label={item.lure}
                    value={item.count}
                    max={lureData[0].count}
                    color={colors.warning}
                  />
                ))}
              </View>
            </SectionCard>
          )}

          {/* ── Heure de la journée ───────────────────────────────────── */}
          <SectionCard title={t('stats.timeOfDay')}>
            <TimeOfDayChart data={timeData} />
          </SectionCard>

          {/* ── Profondeur ───────────────────────────────────────────── */}
          {hasDepthData && (
            <SectionCard title={t('stats.depth')}>
              <View style={styles.barList}>
                {depthData.map((b) => (
                  <HBar
                    key={b.label}
                    label={b.label}
                    value={b.count}
                    max={Math.max(...depthData.map((d) => d.count), 1)}
                    color={colors.species.truite}
                  />
                ))}
              </View>
            </SectionCard>
          )}

          {/* ── Records & trophées ───────────────────────────────────── */}
          {showRecords && (
            <SectionCard title={t('stats.records')}>
              <View style={recStyles.grid}>
                {records.heaviest && records.heaviest.weight_lbs != null && (
                  <RecordTile
                    icon="trophy"
                    iconColor={colors.warning}
                    value={fmtWeight(records.heaviest.weight_lbs)}
                    sublabel={t('stats.heaviest')}
                    species={records.heaviest.species}
                  />
                )}
                {records.longest && records.longest.length_inches != null && (
                  <RecordTile
                    icon="resize-outline"
                    iconColor={colors.species.dore}
                    value={fmtLength(records.longest.length_inches)}
                    sublabel={t('stats.longest')}
                    species={records.longest.species}
                  />
                )}
                {records.trophyCount > 0 && (
                  <RecordTile
                    icon="star"
                    iconColor={colors.species.maskinonge}
                    value={String(records.trophyCount)}
                    sublabel={t('stats.trophies')}
                  />
                )}
                {records.bestDayCount > 0 && records.bestDayKey && (
                  <RecordTile
                    icon="calendar"
                    iconColor={colors.accent}
                    value={String(records.bestDayCount)}
                    sublabel={t('stats.bestDay')}
                    species={new Date(records.bestDayKey).toLocaleDateString(locale, {
                      day: 'numeric',
                      month: 'short',
                    })}
                  />
                )}
              </View>
            </SectionCard>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  headerTitle: { ...typography.h2, color: colors.textPrimary },
  headerSub: { ...typography.bodySmall, color: colors.textMuted },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cacheNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.warningSubtle,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.25)',
  },
  cacheNoticeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.warning,
  },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: radius.xl,
    backgroundColor: colors.accentSubtle,
    borderWidth: 1,
    borderColor: colors.accentGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: { ...typography.h3, color: colors.textMuted },
  emptyBody: {
    ...typography.bodySmall,
    color: colors.textSubtle,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },

  scroll: {},

  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },

  kpiRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },

  barList: { gap: spacing.sm },
});
