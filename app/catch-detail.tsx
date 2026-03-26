import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import LocationPickerMap from '@/components/LocationPickerMap';
import StaticMapView from '@/components/StaticMapView';
import { supabase } from '@/lib/supabase';

type SizeCategory = 'small' | 'medium' | 'large' | 'trophy';

function windDegToCompass(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return dirs[Math.round(deg / 45) % 8];
}

type CatchDetail = {
  id: string;
  species: string;
  lure: string | null;
  latitude: number | null;
  longitude: number | null;
  lake_name: string | null;
  depth_meters: number | null;
  depth_source: string | null;
  temperature_c: number | null;
  wind_speed_kmh: number | null;
  wind_direction_deg: number | null;
  speed_kmh: number | null;
  weather_conditions: string | null;
  size_category: SizeCategory | null;
  weight_lbs: number | null;
  length_inches: number | null;
  notes: string | null;
  caught_at: string;
};

const SIZE_LABELS: Record<SizeCategory, string> = {
  small: 'Petit',
  medium: 'Moyen',
  large: 'Grand',
  trophy: 'Trophée',
};

const SIZE_OPTIONS: SizeCategory[] = ['small', 'medium', 'large', 'trophy'];

export default function CatchDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [catch_, setCatch] = useState<CatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Editable fields
  const [species, setSpecies] = useState('');
  const [lure, setLure] = useState('');
  const [lakeName, setLakeName] = useState('');
  const [depthMeters, setDepthMeters] = useState('');
  const [sizeCategory, setSizeCategory] = useState<SizeCategory | null>(null);
  const [weightLbs, setWeightLbs] = useState('');
  const [lengthInches, setLengthInches] = useState('');
  const [notes, setNotes] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [pickerCoord, setPickerCoord] = useState<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    if (!id) return;
    loadCatch();
  }, [id]);

  async function loadCatch() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('catches')
        .select(
          'id, species, lure, latitude, longitude, lake_name, depth_meters, depth_source, ' +
          'temperature_c, wind_speed_kmh, wind_direction_deg, speed_kmh, weather_conditions, ' +
          'size_category, weight_lbs, length_inches, notes, caught_at',
        )
        .eq('id', id)
        .single();

      if (error || !data) {
        Alert.alert('Erreur', 'Impossible de charger cette prise.');
        router.back();
        return;
      }

      setCatch(data as unknown as CatchDetail);
      populateForm(data as unknown as CatchDetail);
    } finally {
      setLoading(false);
    }
  }

  function populateForm(data: CatchDetail) {
    setSpecies(data.species ?? '');
    setLure(data.lure ?? '');
    setLakeName(data.lake_name ?? '');
    setDepthMeters(data.depth_meters != null ? String(data.depth_meters) : '');
    setSizeCategory(data.size_category ?? null);
    setWeightLbs(data.weight_lbs != null ? String(data.weight_lbs) : '');
    setLengthInches(data.length_inches != null ? String(data.length_inches) : '');
    setNotes(data.notes ?? '');
    setLatitude(data.latitude ?? null);
    setLongitude(data.longitude ?? null);
    if (data.latitude != null && data.longitude != null) {
      setPickerCoord({ latitude: data.latitude, longitude: data.longitude });
    }
  }

  function handleEditToggle() {
    if (editing && catch_) {
      // Cancel — reset form
      populateForm(catch_);
    }
    setEditing((v) => !v);
  }

  async function handleSave() {
    if (!catch_) return;
    if (!species.trim()) {
      Alert.alert('Validation', 'L\'espèce est obligatoire.');
      return;
    }

    setSaving(true);
    try {
      const updates = {
        species: species.trim(),
        lure: lure.trim() || null,
        lake_name: lakeName.trim() || null,
        depth_meters: depthMeters !== '' ? parseFloat(depthMeters) : null,
        size_category: sizeCategory,
        weight_lbs: weightLbs !== '' ? parseFloat(weightLbs) : null,
        length_inches: lengthInches !== '' ? parseFloat(lengthInches) : null,
        notes: notes.trim() || null,
        latitude,
        longitude,
      };

      const { error } = await supabase
        .from('catches')
        .update(updates)
        .eq('id', catch_.id);

      if (error) {
        Alert.alert('Erreur', 'Impossible de sauvegarder les modifications.');
        return;
      }

      setCatch({ ...catch_, ...updates });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const { error } = await supabase.from('catches').delete().eq('id', catch_!.id);
      if (error) {
        setConfirmDelete(false);
        Alert.alert('Erreur', 'Impossible de supprimer cette prise.');
      } else {
        router.back();
      }
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={ACCENT} size="large" />
      </View>
    );
  }

  if (!catch_) return null;

  const caughtDate = new Date(catch_.caught_at).toLocaleDateString('fr-CA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const caughtTime = new Date(catch_.caught_at).toLocaleTimeString('fr-CA', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Retour</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={editing ? handleSave : handleEditToggle}
          style={[styles.editBtn, editing && styles.saveBtn]}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={[styles.editBtnText, editing && { color: '#fff' }]}>{editing ? 'Sauvegarder' : 'Modifier'}</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title row */}
        <View style={styles.titleRow}>
          <View style={styles.emojiCircle}>
            <Text style={styles.emojiText}>🐟</Text>
          </View>
          <View style={{ flex: 1 }}>
            {editing ? (
              <TextInput
                style={styles.speciesInput}
                value={species}
                onChangeText={setSpecies}
                placeholder="Espèce"
                placeholderTextColor={TEXT_MUTED}
              />
            ) : (
              <Text style={styles.speciesTitle}>{catch_.species}</Text>
            )}
          </View>
        </View>

        {/* Section: Lieu */}
        <SectionCard title="📍 Lieu">
          {latitude != null && longitude != null && (
            <StaticMapView
              coordinate={{ latitude, longitude }}
              height={160}
              onPress={editing ? () => setShowLocationPicker(true) : undefined}
            />
          )}
          {editing ? (
            <TextInput
              style={styles.lakeNameInput}
              value={lakeName}
              onChangeText={setLakeName}
              placeholder="Nom du lac"
              placeholderTextColor={TEXT_MUTED}
            />
          ) : (
            <Text style={styles.lakeNameTitle}>
              {catch_.lake_name ?? '—'}
            </Text>
          )}
          <InfoRow
            label="Coordonnées GPS"
            value={
              latitude != null && longitude != null
                ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
                : '—'
            }
          />
          <InfoRow label="Date" value={caughtDate} />
          <InfoRow label="Heure" value={caughtTime} />
        </SectionCard>

        {/* Section: Prise */}
        <SectionCard title="Détails de la prise">
          <EditableRow
            label="Leurre"
            value={editing ? lure : catch_.lure ?? '—'}
            editing={editing}
            onChangeText={setLure}
            placeholder="Leurre utilisé"
          />
          <EditableRow
            label="Profondeur (m)"
            value={editing ? depthMeters : catch_.depth_meters != null ? `${catch_.depth_meters} m` : '—'}
            editing={editing}
            onChangeText={setDepthMeters}
            placeholder="0.0"
            keyboardType="decimal-pad"
          />

          {/* Taille */}
          {editing ? (
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Taille</Text>
              <View style={styles.sizeChipsRow}>
                {SIZE_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.sizeChip, sizeCategory === opt && styles.sizeChipActive]}
                    onPress={() => setSizeCategory(sizeCategory === opt ? null : opt)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.sizeChipText, sizeCategory === opt && styles.sizeChipTextActive]}>
                      {SIZE_LABELS[opt]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : (
            <InfoRow
              label="Taille"
              value={catch_.size_category ? SIZE_LABELS[catch_.size_category] : '—'}
            />
          )}

          <EditableRow
            label="Poids (lb)"
            value={editing ? weightLbs : catch_.weight_lbs != null ? `${catch_.weight_lbs.toFixed(1)} lb` : '—'}
            editing={editing}
            onChangeText={setWeightLbs}
            placeholder="0.0"
            keyboardType="decimal-pad"
          />
          <EditableRow
            label="Longueur (po)"
            value={editing ? lengthInches : catch_.length_inches != null ? `${catch_.length_inches.toFixed(1)} po` : '—'}
            editing={editing}
            onChangeText={setLengthInches}
            placeholder="0.0"
            keyboardType="decimal-pad"
          />
        </SectionCard>

        {/* Section: Météo */}
        <SectionCard title="🌤 Météo">
          <InfoRow
            label="Ciel"
            value={catch_.weather_conditions ?? '—'}
            auto
          />
          <InfoRow
            label="Température"
            value={catch_.temperature_c != null ? `${catch_.temperature_c.toFixed(1)} °C` : '—'}
            auto
          />
          <InfoRow
            label="Vent"
            value={
              catch_.wind_speed_kmh != null
                ? catch_.wind_direction_deg != null
                  ? `${windDegToCompass(catch_.wind_direction_deg)} — ${catch_.wind_speed_kmh.toFixed(1)} km/h`
                  : `${catch_.wind_speed_kmh.toFixed(1)} km/h`
                : '—'
            }
            auto
          />
          <InfoRow
            label="Vitesse bateau"
            value={catch_.speed_kmh != null ? `${catch_.speed_kmh.toFixed(1)} km/h` : '—'}
            auto
          />
        </SectionCard>

        {/* Section: Notes */}
        <SectionCard title="Notes">
          {editing ? (
            <TextInput
              style={styles.notesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder="Ajouter des notes..."
              placeholderTextColor={TEXT_MUTED}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          ) : (
            <Text style={[styles.fieldValue, !catch_.notes && { color: TEXT_MUTED }]}>
              {catch_.notes || 'Aucune note'}
            </Text>
          )}
        </SectionCard>

        {/* Cancel / Delete */}
        {editing && (
          <TouchableOpacity style={styles.cancelBtn} onPress={handleEditToggle}>
            <Text style={styles.cancelBtnText}>Annuler</Text>
          </TouchableOpacity>
        )}

        {!editing && !confirmDelete && (
          <TouchableOpacity style={styles.deleteBtn} onPress={() => setConfirmDelete(true)}>
            <Text style={styles.deleteBtnText}>🗑 Supprimer cette prise</Text>
          </TouchableOpacity>
        )}

        {!editing && confirmDelete && (
          <View style={styles.confirmDeleteCard}>
            <Text style={styles.confirmDeleteText}>
              Supprimer définitivement cette prise ?
            </Text>
            <View style={styles.confirmDeleteRow}>
              <TouchableOpacity
                style={styles.confirmDeleteCancelBtn}
                onPress={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                <Text style={styles.confirmDeleteCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmDeleteConfirmBtn}
                onPress={handleDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.confirmDeleteConfirmText}>Oui, supprimer</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Modal sélection GPS */}
      <Modal visible={showLocationPicker} animationType="slide" statusBarTranslucent>
        <View style={styles.pickerContainer}>
          <View style={styles.pickerHeader}>
            <TouchableOpacity onPress={() => setShowLocationPicker(false)}>
              <Text style={styles.backBtnText}>← Annuler</Text>
            </TouchableOpacity>
            <Text style={styles.pickerHeaderTitle}>Choisir la position</Text>
            <View style={{ width: 70 }} />
          </View>

          <Text style={styles.pickerHint}>Appuyez sur la carte ou faites glisser le marqueur</Text>

          {pickerCoord && (
            <LocationPickerMap
              coordinate={pickerCoord}
              onCoordinateChange={setPickerCoord}
            />
          )}

          <View style={styles.pickerFooter}>
            <Text style={styles.pickerCoordsText}>
              {pickerCoord
                ? `${pickerCoord.latitude.toFixed(5)}, ${pickerCoord.longitude.toFixed(5)}`
                : ''}
            </Text>
            <TouchableOpacity
              style={styles.pickerConfirmBtn}
              onPress={() => {
                if (pickerCoord) {
                  setLatitude(pickerCoord.latitude);
                  setLongitude(pickerCoord.longitude);
                }
                setShowLocationPicker(false);
              }}
            >
              <Text style={styles.pickerConfirmBtnText}>Confirmer la position</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function InfoRow({ label, value, auto }: { label: string; value: string; auto?: boolean }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldValueRow}>
        {auto && <Text style={styles.autoBadge}>auto</Text>}
        <Text style={styles.fieldValue}>{value}</Text>
      </View>
    </View>
  );
}

function EditableRow({
  label,
  value,
  editing,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  editing: boolean;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad';
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {editing ? (
        <TextInput
          style={styles.inlineInput}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={TEXT_MUTED}
          keyboardType={keyboardType ?? 'default'}
        />
      ) : (
        <Text style={styles.fieldValue}>{value}</Text>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const BG = '#061425';
const CARD_BG = '#0E2236';
const ACCENT = '#00E6B5';
const TEXT_PRIMARY = '#FFFFFF';
const TEXT_MUTED = 'rgba(255,255,255,0.5)';
const BORDER = 'rgba(255,255,255,0.07)';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 56 : 20,
    paddingBottom: 14,
    backgroundColor: BG,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  backBtn: {
    paddingVertical: 6,
    paddingRight: 12,
  },
  backBtnText: {
    color: ACCENT,
    fontSize: 15,
    fontWeight: '500',
  },
  editBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0,230,181,0.12)',
    borderWidth: 1,
    borderColor: ACCENT,
    minWidth: 90,
    alignItems: 'center',
  },
  saveBtn: {
    backgroundColor: ACCENT,
  },
  editBtnText: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: '600',
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 48,
    gap: 16,
  },

  // Title row
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 4,
  },
  emojiCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: CARD_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiText: {
    fontSize: 28,
  },
  speciesTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  speciesInput: {
    fontSize: 22,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    borderBottomWidth: 1,
    borderBottomColor: ACCENT,
    paddingBottom: 2,
    marginBottom: 4,
  },
  dateSubtitle: {
    fontSize: 13,
    color: TEXT_MUTED,
    marginTop: 3,
    textTransform: 'capitalize',
  },

  // Section card
  sectionCard: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 2,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: ACCENT,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingTop: 10,
    paddingBottom: 6,
  },

  // Field rows
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  fieldLabel: {
    fontSize: 14,
    color: TEXT_MUTED,
    flex: 1,
  },
  fieldValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fieldValue: {
    fontSize: 14,
    color: TEXT_PRIMARY,
    textAlign: 'right',
    flex: 1,
  },
  autoBadge: {
    fontSize: 10,
    color: ACCENT,
    backgroundColor: 'rgba(0,230,181,0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
    fontWeight: '600',
  },

  // Inline input
  inlineInput: {
    flex: 1,
    textAlign: 'right',
    fontSize: 14,
    color: TEXT_PRIMARY,
    borderBottomWidth: 1,
    borderBottomColor: ACCENT,
    paddingBottom: 2,
    marginLeft: 12,
  },

  // Size chips
  sizeChipsRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    flex: 1,
    marginLeft: 8,
  },
  sizeChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  sizeChipActive: {
    borderColor: ACCENT,
    backgroundColor: 'rgba(0,230,181,0.15)',
  },
  sizeChipText: {
    fontSize: 12,
    color: TEXT_MUTED,
    fontWeight: '500',
  },
  sizeChipTextActive: {
    color: ACCENT,
  },

  lakeNameTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  lakeNameInput: {
    fontSize: 20,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    borderBottomWidth: 1,
    borderBottomColor: ACCENT,
  },

  // Notes input
  notesInput: {
    fontSize: 14,
    color: TEXT_PRIMARY,
    paddingTop: 4,
    paddingBottom: 8,
    minHeight: 80,
    lineHeight: 20,
  },

  // Buttons
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  cancelBtnText: {
    color: TEXT_MUTED,
    fontSize: 15,
  },
  deleteBtn: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  deleteBtnText: {
    color: '#FF5E5E',
    fontSize: 14,
  },
  confirmDeleteCard: {
    backgroundColor: 'rgba(255,94,94,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,94,94,0.3)',
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  confirmDeleteText: {
    color: '#FF5E5E',
    fontSize: 14,
    textAlign: 'center',
  },
  confirmDeleteRow: {
    flexDirection: 'row',
    gap: 10,
  },
  confirmDeleteCancelBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
  },
  confirmDeleteCancelText: {
    color: TEXT_MUTED,
    fontSize: 14,
  },
  confirmDeleteConfirmBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#FF5E5E',
    alignItems: 'center',
  },
  confirmDeleteConfirmText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  gpsPickerBtn: {
    flex: 1,
    marginLeft: 12,
    alignItems: 'flex-end',
    gap: 2,
  },
  gpsPickerBtnText: {
    fontSize: 12,
    color: TEXT_MUTED,
    textAlign: 'right',
  },
  gpsPickerBtnAction: {
    fontSize: 13,
    color: ACCENT,
    fontWeight: '600',
  },
  // Location picker modal
  pickerContainer: {
    flex: 1,
    backgroundColor: BG,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 56 : 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  pickerHeaderTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  pickerHint: {
    textAlign: 'center',
    fontSize: 13,
    color: TEXT_MUTED,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  pickerFooter: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    gap: 10,
  },
  pickerCoordsText: {
    fontSize: 13,
    color: TEXT_MUTED,
    textAlign: 'center',
  },
  pickerConfirmBtn: {
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  pickerConfirmBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
