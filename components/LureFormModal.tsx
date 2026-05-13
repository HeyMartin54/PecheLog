import { useEffect, useState } from 'react';
import {
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
import { colors, radius, spacing, typography } from '@/lib/theme';
import type { UserLure } from '@/lib/lureStorage';

type LureFormData = {
  name: string;
  size: string;
  color: string;
  notes: string;
};

type Props = {
  visible: boolean;
  lure?: UserLure;
  onSave: (data: { name: string; size: string | null; color: string | null; notes: string | null }) => void;
  onDelete?: () => void;
  onClose: () => void;
};

export default function LureFormModal({ visible, lure, onSave, onDelete, onClose }: Props) {
  const isEditing = !!lure;

  const [form, setForm] = useState<LureFormData>({ name: '', size: '', color: '', notes: '' });

  useEffect(() => {
    if (visible) {
      setForm({
        name: lure?.name ?? '',
        size: lure?.size ?? '',
        color: lure?.color ?? '',
        notes: lure?.notes ?? '',
      });
    }
  }, [visible, lure]);

  const handleSave = () => {
    const name = form.name.trim();
    if (!name) {
      Alert.alert('Nom requis', 'Le leurre doit avoir un nom.');
      return;
    }
    onSave({
      name,
      size: form.size.trim() || null,
      color: form.color.trim() || null,
      notes: form.notes.trim() || null,
    });
  };

  const handleDelete = () => {
    Alert.alert(
      'Supprimer ce leurre',
      `Supprimer "${lure?.name}" ? Cette action est irréversible.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: onDelete },
      ],
    );
  };

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
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.cancelText}>Annuler</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isEditing ? 'Modifier le leurre' : 'Nouveau leurre'}</Text>
          <TouchableOpacity onPress={handleSave} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.saveText}>Sauvegarder</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Nom */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Nom *</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: Aglia #2, Rapala Original…"
              placeholderTextColor={colors.textMuted}
              value={form.name}
              onChangeText={(v) => setForm((p) => ({ ...p, name: v }))}
              returnKeyType="next"
              autoFocus={!isEditing}
            />
          </View>

          {/* Grosseur */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Grosseur</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: 7 cm, 3/8 oz, #3…"
              placeholderTextColor={colors.textMuted}
              value={form.size}
              onChangeText={(v) => setForm((p) => ({ ...p, size: v }))}
              returnKeyType="next"
            />
          </View>

          {/* Couleur */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Couleur</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: Perch, Chrome, Fire Tiger…"
              placeholderTextColor={colors.textMuted}
              value={form.color}
              onChangeText={(v) => setForm((p) => ({ ...p, color: v }))}
              returnKeyType="next"
            />
          </View>

          {/* Autres infos */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Autres informations</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              placeholder="Notes additionnelles…"
              placeholderTextColor={colors.textMuted}
              value={form.notes}
              onChangeText={(v) => setForm((p) => ({ ...p, notes: v }))}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {/* Supprimer (mode édition seulement) */}
          {isEditing && onDelete && (
            <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.8}>
              <Text style={styles.deleteBtnText}>Supprimer ce leurre</Text>
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
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  cancelText: {
    fontSize: 15,
    color: colors.textMuted,
  },
  saveText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.accent,
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.lg,
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
  notesInput: {
    height: 90,
    textAlignVertical: 'top',
  },
  deleteBtn: {
    marginTop: spacing.xl,
    paddingVertical: spacing.md,
    alignItems: 'center',
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
