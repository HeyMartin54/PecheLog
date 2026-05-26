import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useActiveSpecies } from '@/lib/hooks/useActiveSpecies';
import { useCustomSpecies } from '@/lib/hooks/useCustomSpecies';
import { useSpeciesColors } from '@/lib/hooks/useSpeciesColors';
import { SPECIES_CONFIG } from '@/lib/species';
import { colors, radius, spacing, typography } from '@/lib/theme';

const PRESET_COLORS = [
  '#FFD700', '#F0B429', '#E8894A', '#E74C3C', '#FF6B6B',
  '#C77DDB', '#9B59B6', '#3498DB', '#4BAEE8', '#1ABC9C',
  '#00D4AA', '#3DBA78', '#2ECC71', '#27AE60', '#9BA8B5',
  '#BDC3C7', '#34495E', '#FF8C42', '#E91E63', '#FFFFFF',
];

type Props = {
  visible: boolean;
  /** Nom de l'espèce existante. null = mode création */
  species: string | null;
  onClose: () => void;
  /** Appelé après création d'une nouvelle espèce */
  onCreated?: (name: string) => void;
};

export default function SpeciesDetailModal({ visible, species, onClose, onCreated }: Props) {
  const insets = useSafeAreaInsets();
  const isCreating = species === null;

  const { getColor, setColor, resetColor, customColors } = useSpeciesColors();
  const { isActive, toggleActive, activateSpecies } = useActiveSpecies();
  const { customSpecies, addSpecies, removeSpecies, isCustom } = useCustomSpecies();

  const [newName, setNewName] = useState('');
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const cfg = species ? SPECIES_CONFIG[species] : null;
  const customDef = species ? customSpecies.find((c) => c.name === species) : null;
  const code = cfg?.code ?? customDef?.code ?? (species?.slice(0, 2).toUpperCase() ?? '?');
  const photoUrl = cfg?.photoUrl ?? '';
  const currentColor = species ? getColor(species) : (selectedColor ?? PRESET_COLORS[0]);
  const hasCustomColor = species ? !!customColors[species] : false;
  const isSpeciesCustom = species ? isCustom(species) : false;
  const active = species ? isActive(species) : true;

  useEffect(() => {
    if (visible) {
      setNewName('');
      setSelectedColor(null);
      setConfirmDelete(false);
    }
  }, [visible]);

  const handleColorPress = (hex: string) => {
    if (isCreating) {
      setSelectedColor(hex);
    } else if (species) {
      setColor(species, hex);
    }
  };

  const handleReset = () => {
    if (species) resetColor(species);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      Alert.alert('Nom requis', "L'espèce doit avoir un nom.");
      return;
    }
    const color = selectedColor ?? PRESET_COLORS[0];
    await addSpecies(name);
    await setColor(name, color);
    await activateSpecies(name);
    onCreated?.(name);
    onClose();
  };

  const handleDelete = () => {
    if (!species) return;
    Alert.alert(
      'Supprimer cette espèce',
      `Supprimer "${species}" ? Cette action est irréversible.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            await removeSpecies(species);
            await resetColor(species);
            onClose();
          },
        },
      ],
    );
  };

  const displayColor = isCreating ? (selectedColor ?? PRESET_COLORS[0]) : currentColor;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.cancelText}>Annuler</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {isCreating ? 'Nouvelle espèce' : species}
          </Text>
          {isCreating ? (
            <TouchableOpacity onPress={handleCreate} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.saveText}>Créer</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 55 }} />
          )}
        </View>

        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: spacing.xl + insets.bottom }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Photo / avatar */}
          <View style={styles.photoSection}>
            {!isCreating && photoUrl ? (
              <Image
                source={{ uri: photoUrl }}
                style={styles.photo}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.avatarCircle, { backgroundColor: displayColor }]}>
                {isCreating && !newName ? (
                  <Ionicons name="fish" size={32} color="#fff" />
                ) : (
                  <Text style={styles.avatarText}>
                    {isCreating
                      ? newName.slice(0, 2).toUpperCase() || '?'
                      : (species === 'Site prometteur' ? '📍' : code)}
                  </Text>
                )}
              </View>
            )}
          </View>

          {/* Champ nom (mode création) */}
          {isCreating && (
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Nom de l'espèce *</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: Ouananiche, Carpe, Achigan…"
                placeholderTextColor={colors.textMuted}
                value={newName}
                onChangeText={setNewName}
                autoFocus
                returnKeyType="done"
              />
            </View>
          )}

          {/* Toggle activer (mode édition) */}
          {!isCreating && (
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Espèce active</Text>
              <Switch
                value={active}
                onValueChange={() => { if (species) toggleActive(species); }}
                trackColor={{ false: colors.border, true: colors.accentStrong }}
                thumbColor={active ? colors.accent : colors.textMuted}
              />
            </View>
          )}

          {/* Couleur du marqueur */}
          <View style={styles.colorSection}>
            <Text style={styles.fieldLabel}>COULEUR DU MARQUEUR</Text>
            <View style={styles.colorGrid}>
              {PRESET_COLORS.map((hex) => {
                const isSelected = displayColor === hex;
                return (
                  <TouchableOpacity
                    key={hex}
                    style={[
                      styles.colorCell,
                      { backgroundColor: hex },
                      isSelected && styles.colorCellSelected,
                    ]}
                    onPress={() => handleColorPress(hex)}
                    activeOpacity={0.8}
                  />
                );
              })}
            </View>

            {!isCreating && hasCustomColor && (
              <TouchableOpacity style={styles.resetBtn} onPress={handleReset} activeOpacity={0.8}>
                <Ionicons name="refresh" size={14} color={colors.textMuted} />
                <Text style={styles.resetText}>Réinitialiser la couleur</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Supprimer (espèce custom seulement) */}
          {!isCreating && isSpeciesCustom && (
            <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.8}>
              <Ionicons name="trash-outline" size={16} color={colors.error} />
              <Text style={styles.deleteBtnText}>Supprimer cette espèce</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
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
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  cancelText: {
    fontSize: 15,
    color: colors.textMuted,
    minWidth: 55,
  },
  saveText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.accent,
    minWidth: 55,
    textAlign: 'right',
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.xl,
  },
  photoSection: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  photo: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  avatarCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
  },
  fieldGroup: {
    gap: spacing.sm,
  },
  fieldLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10,
    fontSize: 15,
    color: colors.textPrimary,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  colorSection: {
    gap: spacing.md,
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  colorCell: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  colorCellSelected: {
    borderWidth: 2.5,
    borderColor: colors.accent,
    transform: [{ scale: 1.18 }],
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  resetText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.errorSubtle,
    borderWidth: 1,
    borderColor: 'rgba(255,94,94,0.25)',
  },
  deleteBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.error,
  },
});
