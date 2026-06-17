import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography } from '@/lib/theme';
import { useSettings } from '@/contexts/SettingsContext';
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
  onSave: (data: {
    name: string;
    size: string | null;
    color: string | null;
    notes: string | null;
    localPhotoUri: string | null | undefined;
  }) => void;
  onDelete?: () => void;
  onClose: () => void;
};

export default function LureFormModal({ visible, lure, onSave, onDelete, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useSettings();
  const isEditing = !!lure;

  const [form, setForm] = useState<LureFormData>({ name: '', size: '', color: '', notes: '' });
  const [localPhotoUri, setLocalPhotoUri] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (visible) {
      setForm({
        name: lure?.name ?? '',
        size: lure?.size ?? '',
        color: lure?.color ?? '',
        notes: lure?.notes ?? '',
      });
      setLocalPhotoUri(lure?.photo_url ?? null);
    }
  }, [visible, lure]);

  const handleSave = () => {
    const name = form.name.trim();
    if (!name) {
      Alert.alert(t('lureForm.nameRequired'), t('lureForm.nameRequiredBody'));
      return;
    }
    onSave({
      name,
      size: form.size.trim() || null,
      color: form.color.trim() || null,
      notes: form.notes.trim() || null,
      localPhotoUri,
    });
  };

  const handleDelete = () => {
    Alert.alert(
      t('lureForm.delete'),
      t('lureForm.deleteConfirm', { name: lure?.name ?? '' }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: onDelete },
      ],
    );
  };

  const pickPhoto = async (useCamera: boolean) => {
    let result: ImagePicker.ImagePickerResult;
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    };

    if (useCamera) {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('detail.permDenied'), t('detail.cameraPerm'));
        return;
      }
      result = await ImagePicker.launchCameraAsync(options);
    } else {
      result = await ImagePicker.launchImageLibraryAsync(options);
    }

    if (!result.canceled && result.assets[0]) {
      setLocalPhotoUri(result.assets[0].uri);
    }
  };

  const handleAddPhoto = () => {
    if (Platform.OS === 'web') {
      pickPhoto(false);
      return;
    }
    Alert.alert(t('lureForm.photoTitle'), t('detail.chooseSource'), [
      { text: t('detail.takePhoto'), onPress: () => pickPhoto(true) },
      { text: t('detail.fromLibrary'), onPress: () => pickPhoto(false) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const handleChangePhoto = () => {
    if (Platform.OS === 'web') {
      Alert.alert(t('lureForm.photoTitle'), t('lureForm.editPhoto'), [
        { text: t('lureForm.change'), onPress: () => pickPhoto(false) },
        { text: t('common.delete'), style: 'destructive', onPress: () => setLocalPhotoUri(null) },
        { text: t('common.cancel'), style: 'cancel' },
      ]);
      return;
    }
    Alert.alert(t('lureForm.photoTitle'), t('lureForm.editPhoto'), [
      { text: t('detail.takePhoto'), onPress: () => pickPhoto(true) },
      { text: t('detail.fromLibrary'), onPress: () => pickPhoto(false) },
      { text: t('lureForm.deletePhoto'), style: 'destructive', onPress: () => setLocalPhotoUri(null) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
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
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isEditing ? 'Modifier le leurre' : 'Nouveau leurre'}</Text>
          <TouchableOpacity onPress={handleSave} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.saveText}>{t('detail.save')}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: spacing.lg + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Nom */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t('lureForm.name')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('lureForm.namePlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={form.name}
              onChangeText={(v) => setForm((p) => ({ ...p, name: v }))}
              returnKeyType="next"
              autoFocus={!isEditing}
            />
          </View>

          {/* Grosseur */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t('lureForm.size')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('lureForm.sizePlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={form.size}
              onChangeText={(v) => setForm((p) => ({ ...p, size: v }))}
              returnKeyType="next"
            />
          </View>

          {/* Couleur */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t('lureForm.color')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('lureForm.colorPlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={form.color}
              onChangeText={(v) => setForm((p) => ({ ...p, color: v }))}
              returnKeyType="next"
            />
          </View>

          {/* Photo */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t('lureForm.photo')}</Text>
            {localPhotoUri ? (
              <TouchableOpacity onPress={handleChangePhoto} activeOpacity={0.85}>
                <Image source={{ uri: localPhotoUri }} style={styles.photoPreview} resizeMode="cover" />
                <Text style={styles.photoChangeHint}>{t('lureForm.tapToEdit')}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.photoAddBtn} onPress={handleAddPhoto} activeOpacity={0.8}>
                <Text style={styles.photoAddIcon}>📷</Text>
                <Text style={styles.photoAddText}>{t('lureForm.addPhoto')}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Autres infos */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t('lureForm.other')}</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              placeholder={t('lureForm.notesPlaceholder')}
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
              <Text style={styles.deleteBtnText}>{t('lureForm.delete')}</Text>
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
  photoPreview: {
    width: 100,
    height: 100,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoChangeHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  photoAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
  },
  photoAddIcon: {
    fontSize: 18,
  },
  photoAddText: {
    fontSize: 14,
    color: colors.accent,
    fontWeight: '500',
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
