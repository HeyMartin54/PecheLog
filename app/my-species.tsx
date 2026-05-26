import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import SpeciesDetailModal from '@/components/SpeciesDetailModal';
import { useActiveSpecies } from '@/lib/hooks/useActiveSpecies';
import { useCustomSpecies } from '@/lib/hooks/useCustomSpecies';
import { useSpeciesColors } from '@/lib/hooks/useSpeciesColors';
import { colors, radius, spacing, typography } from '@/lib/theme';

const PRESET_COLORS = [
  '#FFD700', '#F0B429', '#E8894A', '#E74C3C', '#FF6B6B',
  '#C77DDB', '#9B59B6', '#3498DB', '#4BAEE8', '#1ABC9C',
  '#00D4AA', '#3DBA78', '#2ECC71', '#27AE60', '#9BA8B5',
  '#BDC3C7', '#34495E', '#FF8C42', '#E91E63', '#FFFFFF',
];

export default function MySpeciesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [colorPickerSpecies, setColorPickerSpecies] = useState<string | null>(null);

  const { getColor, setColor, resetColor, customColors, refresh: refreshColors } = useSpeciesColors();
  const { isActive, toggleActive, allSpecies, refresh: refreshActive } = useActiveSpecies();
  const { isCustom, removeSpecies, refresh: refreshCustom } = useCustomSpecies();

  const handleCreateClose = async () => {
    setCreateModalVisible(false);
    await Promise.all([refreshColors(), refreshActive(), refreshCustom()]);
  };

  const handleColorSelect = async (species: string, hex: string) => {
    await setColor(species, hex);
    setColorPickerSpecies(null);
  };

  const handleReset = async (species: string) => {
    await resetColor(species);
    setColorPickerSpecies(null);
  };

  const handleDelete = (species: string) => {
    Alert.alert(
      'Supprimer cette espèce',
      `Supprimer "${species}" ? Cette action est irréversible.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            setColorPickerSpecies(null);
            await removeSpecies(species);
            await resetColor(species);
            await Promise.all([refreshActive(), refreshCustom()]);
          },
        },
      ],
    );
  };

  const pickerColor = colorPickerSpecies ? getColor(colorPickerSpecies) : null;
  const pickerHasCustom = colorPickerSpecies ? !!customColors[colorPickerSpecies] : false;
  const pickerIsCustom = colorPickerSpecies ? isCustom(colorPickerSpecies) : false;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Espèces & marqueurs</Text>
        <TouchableOpacity
          onPress={() => setCreateModalVisible(true)}
          style={styles.addBtn}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={18} color={colors.bg} />
          <Text style={styles.addBtnText}>Créer</Text>
        </TouchableOpacity>
      </View>

      {/* Liste des espèces */}
      <ScrollView
        contentContainerStyle={[styles.listContent, { paddingBottom: spacing.lg + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {allSpecies.map((name) => {
          const markerColor = getColor(name);
          const active = isActive(name);
          return (
            <View key={name} style={styles.row}>
              <Text style={[styles.rowName, !active && styles.rowNameInactive]} numberOfLines={1}>
                {name}
              </Text>

              {/* Pastille couleur tappable */}
              <TouchableOpacity
                style={[styles.colorSwatch, { backgroundColor: markerColor }]}
                onPress={() => setColorPickerSpecies(name)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                activeOpacity={0.75}
              />

              {/* Toggle actif/inactif */}
              <Switch
                value={active}
                onValueChange={() => toggleActive(name)}
                trackColor={{ false: colors.border, true: colors.accentStrong }}
                thumbColor={active ? colors.accent : colors.textMuted}
                style={Platform.OS === 'android' ? { transform: [{ scaleX: 0.9 }, { scaleY: 0.9 }] } : undefined}
              />
            </View>
          );
        })}
      </ScrollView>

      {/* Petit popup sélecteur de couleur */}
      <Modal
        visible={colorPickerSpecies !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setColorPickerSpecies(null)}
      >
        <Pressable style={styles.popupOverlay} onPress={() => setColorPickerSpecies(null)}>
          <Pressable style={styles.popupCard} onPress={() => {}}>
            {/* Titre */}
            <View style={styles.popupHeader}>
              <Text style={styles.popupTitle} numberOfLines={1}>
                {colorPickerSpecies}
              </Text>
              {pickerIsCustom && (
                <TouchableOpacity
                  onPress={() => colorPickerSpecies && handleDelete(colorPickerSpecies)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.75}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.error} />
                </TouchableOpacity>
              )}
            </View>

            {/* Grille de couleurs */}
            <View style={styles.colorGrid}>
              {PRESET_COLORS.map((hex) => {
                const selected = pickerColor === hex;
                return (
                  <TouchableOpacity
                    key={hex}
                    style={[
                      styles.colorCell,
                      { backgroundColor: hex },
                      selected && styles.colorCellSelected,
                    ]}
                    onPress={() => colorPickerSpecies && handleColorSelect(colorPickerSpecies, hex)}
                    activeOpacity={0.8}
                  />
                );
              })}
            </View>

            {/* Réinitialiser */}
            {pickerHasCustom && (
              <TouchableOpacity
                style={styles.resetBtn}
                onPress={() => colorPickerSpecies && handleReset(colorPickerSpecies)}
                activeOpacity={0.8}
              >
                <Ionicons name="refresh" size={13} color={colors.textMuted} />
                <Text style={styles.resetText}>Réinitialiser</Text>
              </TouchableOpacity>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal création d'espèce */}
      <SpeciesDetailModal
        visible={createModalVisible}
        species={null}
        onClose={handleCreateClose}
        onCreated={handleCreateClose}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
  },
  addBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.bg,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  rowName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  rowNameInactive: {
    color: colors.textMuted,
    fontWeight: '400',
  },
  colorSwatch: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
  },

  // Popup couleur
  popupOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  popupCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 340,
    gap: spacing.md,
  },
  popupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  popupTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    flex: 1,
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  colorCell: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  colorCellSelected: {
    borderWidth: 2.5,
    borderColor: colors.accent,
    transform: [{ scale: 1.15 }],
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  resetText: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
