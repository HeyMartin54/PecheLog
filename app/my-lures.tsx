import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import LureFormModal from '@/components/LureFormModal';
import { useAuth } from '@/contexts/AuthContext';
import {
  createUserLure,
  deleteUserLure,
  loadLuresWithCache,
  setCachedLures,
  updateUserLure,
  type UserLure,
} from '@/lib/lureStorage';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';
import { uploadLureMedia } from '@/lib/uploadLureMedia';

export default function MyLuresScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [lures, setLures] = useState<UserLure[]>([]);
  const [loading, setLoading] = useState(true);
  const [formVisible, setFormVisible] = useState(false);
  const [editingLure, setEditingLure] = useState<UserLure | undefined>(undefined);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const result = await loadLuresWithCache(user.id);
    setLures(result);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingLure(undefined);
    setFormVisible(true);
  };

  const openEdit = (lure: UserLure) => {
    setEditingLure(lure);
    setFormVisible(true);
  };

  const resolvePhotoUrl = async (
    localPhotoUri: string | null | undefined,
    existingPhotoUrl: string | null | undefined,
    userId: string,
  ): Promise<string | null> => {
    if (localPhotoUri === null) return null;
    if (localPhotoUri === undefined) return existingPhotoUrl ?? null;
    if (localPhotoUri.startsWith('https://')) return localPhotoUri;
    try {
      const { storagePath } = await uploadLureMedia(localPhotoUri, userId);
      const { data: urlData } = supabase.storage.from('catch-media').getPublicUrl(storagePath);
      return urlData.publicUrl;
    } catch {
      Alert.alert('Avertissement', 'La photo n\'a pas pu être uploadée. Le leurre sera sauvegardé sans photo.');
      return existingPhotoUrl ?? null;
    }
  };

  const handleSave = async (data: {
    name: string;
    size: string | null;
    color: string | null;
    notes: string | null;
    localPhotoUri: string | null | undefined;
  }) => {
    if (!user?.id) return;
    setFormVisible(false);

    const { localPhotoUri, ...lureData } = data;
    const photo_url = await resolvePhotoUrl(localPhotoUri, editingLure?.photo_url, user.id);

    if (editingLure) {
      const ok = await updateUserLure(editingLure.id, { ...lureData, photo_url });
      if (!ok) {
        Alert.alert('Erreur', 'Impossible de modifier ce leurre.');
        return;
      }
      const updated = lures.map((l) =>
        l.id === editingLure.id ? { ...l, ...lureData, photo_url } : l,
      );
      setLures(updated);
      await setCachedLures(user.id, updated);
    } else {
      const created = await createUserLure(user.id, { ...lureData, photo_url });
      if (!created) {
        Alert.alert('Erreur', 'Impossible de créer ce leurre.');
        return;
      }
      const updated = [...lures, created].sort((a, b) => a.name.localeCompare(b.name));
      setLures(updated);
      await setCachedLures(user.id, updated);
    }
  };

  const handleDelete = async () => {
    if (!editingLure || !user?.id) return;
    setFormVisible(false);
    const ok = await deleteUserLure(editingLure.id);
    if (!ok) {
      Alert.alert('Erreur', 'Impossible de supprimer ce leurre.');
      return;
    }
    const updated = lures.filter((l) => l.id !== editingLure.id);
    setLures(updated);
    await setCachedLures(user.id, updated);
  };

  const renderItem = ({ item }: { item: UserLure }) => {
    const subtitle = [item.size, item.color].filter(Boolean).join(' · ');
    return (
      <TouchableOpacity style={styles.row} onPress={() => openEdit(item)} activeOpacity={0.8}>
        {item.photo_url ? (
          <Image source={{ uri: item.photo_url }} style={styles.lurePhoto} resizeMode="cover" />
        ) : (
          <View style={styles.lureIcon}>
            <Text style={styles.lureIconText}>🪝</Text>
          </View>
        )}
        <View style={styles.rowInfo}>
          <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
          {!!subtitle && (
            <Text style={styles.rowSubtitle} numberOfLines={1}>{subtitle}</Text>
          )}
          {!!item.notes && (
            <Text style={styles.rowNotes} numberOfLines={1}>{item.notes}</Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    );
  };

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
        <Text style={styles.headerTitle}>Mes leurres</Text>
        <TouchableOpacity
          onPress={openCreate}
          style={styles.addBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="add" size={24} color={colors.accent} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={lures}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.listContent,
            lures.length === 0 && styles.listEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🎣</Text>
              <Text style={styles.emptyTitle}>Aucun leurre</Text>
              <Text style={styles.emptySubtitle}>
                Appuyez sur + pour ajouter votre premier leurre.
              </Text>
              <TouchableOpacity style={styles.emptyCreateBtn} onPress={openCreate} activeOpacity={0.8}>
                <Text style={styles.emptyCreateBtnText}>Créer un leurre</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      <LureFormModal
        visible={formVisible}
        lure={editingLure}
        onSave={handleSave}
        onDelete={editingLure ? handleDelete : undefined}
        onClose={() => setFormVisible(false)}
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
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  listEmpty: {
    flex: 1,
    justifyContent: 'center',
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
  lureIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lureIconText: {
    fontSize: 22,
  },
  lurePhoto: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  rowSubtitle: {
    fontSize: 12,
    color: colors.accent,
  },
  rowNotes: {
    fontSize: 12,
    color: colors.textMuted,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
    gap: spacing.md,
  },
  emptyIcon: {
    fontSize: 56,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  emptySubtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyCreateBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  emptyCreateBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.bg,
  },
});
