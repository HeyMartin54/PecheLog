import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import LureFormModal from '@/components/LureFormModal';
import LurePicker from '@/components/LurePicker';
import {
  createUserLure,
  loadLuresWithCache,
  setCachedLures,
  type UserLure,
} from '@/lib/lureStorage';
import { useActiveSpecies } from '@/lib/hooks/useActiveSpecies';
import { SPECIES_CONFIG } from '@/lib/species';
import { colors, radius, spacing, typography } from '@/lib/theme';
import { useAuth } from '@/contexts/AuthContext';
import {
  addFrequentCompanions,
  clearPrefillTrip,
  loadActiveTrip,
  loadFrequentCompanions,
  loadPrefillTrip,
  saveActiveTrip,
  type TripLake,
} from '@/lib/tripStorage';

function generateId(): string {
  return `trip_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

export default function PlanTripScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isEditMode = mode === 'edit';
  const { activeSpecies } = useActiveSpecies();
  const fishSpecies = activeSpecies.filter((s) => s !== 'Site prometteur');

  const [lakes, setLakes] = useState<TripLake[]>([{ name: '', targetSpecies: [] }]);
  const [companions, setCompanions] = useState<string[]>([]);
  const [companionInput, setCompanionInput] = useState('');
  const [frequentCompanions, setFrequentCompanions] = useState<string[]>([]);
  const [luresSelected, setLuresSelected] = useState<string[]>([]);
  const [showLurePicker, setShowLurePicker] = useState(false);
  const [showLureForm, setShowLureForm] = useState(false);
  const [userLures, setUserLures] = useState<UserLure[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);

  // Preserved from the active trip in edit mode
  const [editTripId, setEditTripId] = useState<string | null>(null);
  const [editTripStartedAt, setEditTripStartedAt] = useState<string | null>(null);

  const companionInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!user?.id) return;
    loadLuresWithCache(user.id).then(setUserLures);
  }, [user?.id]);

  // Load frequent companions, then either active trip (edit) or prefill (relaunch) or GPS
  useEffect(() => {
    const init = async () => {
      const [freq, prefill] = await Promise.all([loadFrequentCompanions(), loadPrefillTrip()]);
      setFrequentCompanions(freq);

      if (isEditMode) {
        const activeTrip = await loadActiveTrip();
        if (activeTrip) {
          setEditTripId(activeTrip.id);
          setEditTripStartedAt(activeTrip.startedAt);
          setLakes(activeTrip.lakes.length > 0 ? activeTrip.lakes : [{ name: '', targetSpecies: [] }]);
          setCompanions(activeTrip.companions);
          setLuresSelected(activeTrip.luresSelected);
          setNotes(activeTrip.notes ?? '');
        }
      } else if (prefill) {
        await clearPrefillTrip();
        setLakes(prefill.lakes.length > 0 ? prefill.lakes : [{ name: '', targetSpecies: [] }]);
        setCompanions(prefill.companions);
        setLuresSelected(prefill.luresSelected);
        setNotes(prefill.notes ?? '');
      } else {
        // Auto-fill first lake name from GPS
        fetchGpsLakeName();
      }
    };
    init();
  }, [isEditMode]);

  const fetchGpsLakeName = async () => {
    setLocationLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setLocationLoading(false); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      // Try reverse geocoding for a lake name
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${loc.coords.latitude}&lon=${loc.coords.longitude}&format=json&zoom=14`;
        const res = await fetch(url, { headers: { 'User-Agent': 'PecheLog/1.0' } });
        if (res.ok) {
          const data = await res.json();
          const name = data?.address?.water || data?.address?.lake || data?.address?.reservoir || null;
          if (name) {
            setLakes((prev) => {
              const updated = [...prev];
              if (updated[0].name === '') updated[0] = { ...updated[0], name };
              return updated;
            });
          }
        }
      } catch {}
    } catch {}
    setLocationLoading(false);
  };

  // ── Lake helpers ────────────────────────────────────────────────────────────

  const updateLakeName = (index: number, name: string) => {
    setLakes((prev) => prev.map((l, i) => (i === index ? { ...l, name } : l)));
  };

  const toggleLakeSpecies = (index: number, species: string) => {
    setLakes((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l;
        const has = l.targetSpecies.includes(species);
        return {
          ...l,
          targetSpecies: has
            ? l.targetSpecies.filter((s) => s !== species)
            : [...l.targetSpecies, species],
        };
      }),
    );
  };

  const addLake = () => {
    setLakes((prev) => [...prev, { name: '', targetSpecies: [] }]);
  };

  const removeLake = (index: number) => {
    setLakes((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Companion helpers ───────────────────────────────────────────────────────

  const addCompanion = () => {
    const name = companionInput.trim();
    if (!name || companions.includes(name)) { setCompanionInput(''); return; }
    setCompanions((prev) => [...prev, name]);
    setCompanionInput('');
    companionInputRef.current?.focus();
  };

  const removeCompanion = (name: string) => {
    setCompanions((prev) => prev.filter((c) => c !== name));
  };

  const addFrequent = (name: string) => {
    if (!companions.includes(name)) setCompanions((prev) => [...prev, name]);
  };

  // ── Lure helpers ────────────────────────────────────────────────────────────

  const handleLureConfirm = (lure: UserLure) => {
    setLuresSelected((prev) =>
      prev.includes(lure.name) ? prev.filter((n) => n !== lure.name) : [...prev, lure.name],
    );
  };

  const removeLure = (lureName: string) => {
    setLuresSelected((prev) => prev.filter((n) => n !== lureName));
  };

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleStart = async () => {
    const validLakes = lakes.filter((l) => l.name.trim());
    if (validLakes.length === 0) {
      Alert.alert('Lac requis', 'Ajoute au moins un lac pour continuer.');
      return;
    }

    setSaving(true);
    try {
      await addFrequentCompanions(companions);
      await saveActiveTrip({
        id: isEditMode && editTripId ? editTripId : generateId(),
        startedAt: isEditMode && editTripStartedAt ? editTripStartedAt : new Date().toISOString(),
        lakes: validLakes,
        companions,
        luresSelected,
        notes: notes.trim() || undefined,
      });
      router.back();
    } catch (e) {
      console.warn('[PlanTrip] Erreur', e);
      Alert.alert('Erreur', isEditMode ? 'Impossible de modifier le voyage. Réessaie.' : "Impossible de démarrer le voyage. Réessaie.");
    } finally {
      setSaving(false);
    }
  };

  const suggestedCompanions = frequentCompanions.filter(
    (c) => !companions.includes(c) && c.toLowerCase().includes(companionInput.toLowerCase()),
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isEditMode ? 'Modifier le voyage' : 'Planifier un voyage'}</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* ── Lacs ──────────────────────────────────────────────────── */}
        <SectionTitle>🗺 Lacs visités</SectionTitle>

        {lakes.map((lake, index) => (
          <View key={index} style={styles.lakeCard}>
            <View style={styles.lakeHeader}>
              <Text style={styles.lakeNumber}>Lac {index + 1}</Text>
              {lakes.length > 1 && (
                <TouchableOpacity onPress={() => removeLake(index)} activeOpacity={0.7}>
                  <Ionicons name="close-circle-outline" size={20} color={colors.error} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.inputRow}>
              <Ionicons name="location-outline" size={16} color={colors.textMuted} />
              {locationLoading && index === 0 ? (
                <ActivityIndicator size="small" color={colors.accent} style={{ marginLeft: spacing.xs }} />
              ) : (
                <TextInput
                  style={styles.textInput}
                  placeholder="Nom du lac"
                  placeholderTextColor={colors.textMuted}
                  value={lake.name}
                  onChangeText={(t) => updateLakeName(index, t)}
                />
              )}
            </View>

            <Text style={styles.subLabel}>ESPÈCES CIBLES</Text>
            <View style={styles.chipRow}>
              {fishSpecies.map((s) => {
                const selected = lake.targetSpecies.includes(s);
                const cfg = SPECIES_CONFIG[s];
                const chipColor = cfg?.color ?? '#8899AA';
                const chipBgColor = cfg?.bgColor ?? 'rgba(136,153,170,0.15)';
                return (
                  <TouchableOpacity
                    key={s}
                    style={[
                      styles.chip,
                      selected && { backgroundColor: chipBgColor, borderColor: chipColor },
                    ]}
                    onPress={() => toggleLakeSpecies(index, s)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.chipText, selected && { color: chipColor }]}>{s}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        <TouchableOpacity style={styles.addLakeButton} onPress={addLake} activeOpacity={0.75}>
          <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
          <Text style={styles.addLakeText}>Ajouter un lac</Text>
        </TouchableOpacity>

        {/* ── Compagnons ────────────────────────────────────────────── */}
        <SectionTitle>👥 Compagnons</SectionTitle>

        <View style={styles.card}>
          <View style={styles.inputRow}>
            <Ionicons name="person-add-outline" size={16} color={colors.textMuted} />
            <TextInput
              ref={companionInputRef}
              style={styles.textInput}
              placeholder="Nom du compagnon"
              placeholderTextColor={colors.textMuted}
              value={companionInput}
              onChangeText={setCompanionInput}
              onSubmitEditing={addCompanion}
              returnKeyType="done"
            />
            {companionInput.trim().length > 0 && (
              <TouchableOpacity onPress={addCompanion} style={styles.addBtn}>
                <Text style={styles.addBtnText}>Ajouter</Text>
              </TouchableOpacity>
            )}
          </View>

          {companions.length > 0 && (
            <View style={[styles.chipRow, { marginTop: spacing.md }]}>
              {companions.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.chip, styles.chipSelected]}
                  onPress={() => removeCompanion(c)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.chipText, { color: colors.accent }]}>{c}</Text>
                  <Ionicons name="close" size={12} color={colors.accent} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {suggestedCompanions.length > 0 && (
            <View style={{ marginTop: spacing.sm }}>
              <Text style={styles.subLabel}>FRÉQUENTS</Text>
              <View style={styles.chipRow}>
                {suggestedCompanions.slice(0, 6).map((c) => (
                  <TouchableOpacity key={c} style={styles.chip} onPress={() => addFrequent(c)} activeOpacity={0.75}>
                    <Text style={styles.chipText}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>

        {/* ── Leurres ───────────────────────────────────────────────── */}
        <SectionTitle>🪝 Leurres amenés</SectionTitle>

        <View style={styles.card}>
          {luresSelected.length > 0 && (
            <LureChipList lureNames={luresSelected} onRemove={removeLure} />
          )}
          <TouchableOpacity style={styles.lurePickerButton} onPress={() => setShowLurePicker(true)} activeOpacity={0.75}>
            <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
            <Text style={styles.lurePickerText}>
              {luresSelected.length === 0 ? 'Sélectionner des leurres' : 'Ajouter un leurre'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Notes ─────────────────────────────────────────────────── */}
        <SectionTitle>📝 Notes (optionnel)</SectionTitle>

        <View style={styles.card}>
          <TextInput
            style={styles.notesInput}
            placeholder="Conditions prévues, objectifs de la journée..."
            placeholderTextColor={colors.textMuted}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>
      </ScrollView>

      {/* ── Footer bouton ─────────────────────────────────────────────── */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <TouchableOpacity
          style={[styles.startButton, saving && styles.startButtonDisabled]}
          onPress={saving ? undefined : handleStart}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <>
              <Ionicons name={isEditMode ? 'checkmark' : 'navigate'} size={20} color={colors.bg} />
              <Text style={styles.startButtonText}>{isEditMode ? 'Enregistrer les modifications' : 'Démarrer le voyage'}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Lure picker modal ───────────────────────────────────────── */}
      <LurePicker
        visible={showLurePicker}
        selectedLureName={null}
        selectedLureNames={luresSelected}
        userLures={userLures}
        onSelect={handleLureConfirm}
        onCreateNew={() => { setShowLurePicker(false); setShowLureForm(true); }}
        onClose={() => setShowLurePicker(false)}
      />
      <LureFormModal
        visible={showLureForm}
        onSave={async (data) => {
          if (!user?.id) return;
          setShowLureForm(false);
          const created = await createUserLure(user.id, data);
          if (created) {
            const updated = [...userLures, created].sort((a, b) => a.name.localeCompare(b.name));
            setUserLures(updated);
            await setCachedLures(user.id, updated);
            setLuresSelected((prev) => [...prev, created.name]);
          }
        }}
        onClose={() => setShowLureForm(false)}
      />
    </KeyboardAvoidingView>
  );
}

// ─── Lure chip list ───────────────────────────────────────────────────────────

function LureChipList({ lureNames, onRemove }: { lureNames: string[]; onRemove: (name: string) => void }) {
  return (
    <View style={[styles.chipRow, { marginBottom: spacing.md }]}>
      {lureNames.map((name) => (
        <TouchableOpacity
          key={name}
          style={[styles.chip, styles.chipSelected]}
          onPress={() => onRemove(name)}
          activeOpacity={0.75}
        >
          <Text style={[styles.chipText, { color: colors.accent }]}>
            🪝 {name}
          </Text>
          <Ionicons name="close" size={12} color={colors.accent} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Section title ────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: spacing.lg,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.xs,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },

  // Section
  sectionTitle: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  subLabel: {
    ...typography.caption,
    color: colors.accent,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },

  // Cards
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  lakeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  lakeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  lakeNumber: {
    ...typography.caption,
    color: colors.accent,
  },

  // Input
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  textInput: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
    paddingVertical: 4,
  },
  notesInput: {
    ...typography.body,
    color: colors.textPrimary,
    minHeight: 72,
    paddingVertical: spacing.xs,
  },

  // Companion add
  addBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
  },
  addBtnText: {
    ...typography.label,
    color: colors.accent,
  },

  // Chips
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipSelected: {
    backgroundColor: colors.accentSubtle,
    borderColor: colors.accent + '60',
  },
  chipText: {
    ...typography.bodySmall,
    color: colors.textPrimary,
  },

  // Add lake
  addLakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  addLakeText: {
    ...typography.body,
    color: colors.accent,
  },

  // Lure picker
  lurePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  lurePickerText: {
    ...typography.body,
    color: colors.accent,
  },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
  },
  startButtonDisabled: {
    opacity: 0.6,
  },
  startButtonText: {
    ...typography.h3,
    color: colors.bg,
    fontWeight: '700',
  },
});
