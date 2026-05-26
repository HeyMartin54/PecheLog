import { useState, useMemo, useCallback } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography } from '@/lib/theme';
import type { UserLure } from '@/lib/lureStorage';

type Props = {
  visible: boolean;
  selectedLureName: string | null;
  selectedLureNames?: string[];
  userLures: UserLure[];
  onSelect: (lure: UserLure) => void;
  onCreateNew: () => void;
  onClose: () => void;
};

export default function LurePicker({
  visible,
  selectedLureName,
  selectedLureNames,
  userLures,
  onSelect,
  onCreateNew,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');

  const handleClose = useCallback(() => {
    setSearch('');
    onClose();
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return userLures;
    return userLures.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        (l.color ?? '').toLowerCase().includes(q) ||
        (l.size ?? '').toLowerCase().includes(q),
    );
  }, [userLures, search]);

  const renderItem = useCallback(
    ({ item }: { item: UserLure }) => {
      const isSelected = selectedLureNames != null
        ? selectedLureNames.includes(item.name)
        : selectedLureName === item.name;
      const subtitle = [item.size, item.color].filter(Boolean).join(' · ');
      return (
        <TouchableOpacity
          style={[styles.row, isSelected && styles.rowSelected]}
          onPress={() => { onSelect(item); if (selectedLureNames == null) handleClose(); }}
          activeOpacity={0.8}
        >
          {item.photo_url ? (
            <Image source={{ uri: item.photo_url }} style={styles.lurePhoto} resizeMode="cover" />
          ) : (
            <View style={[styles.lureIcon, isSelected && styles.lureIconSelected]}>
              <Text style={styles.lureIconText}>🪝</Text>
            </View>
          )}
          <View style={styles.rowInfo}>
            <Text style={[styles.rowName, isSelected && styles.rowNameSelected]} numberOfLines={1}>
              {item.name}
            </Text>
            {!!subtitle && (
              <Text style={styles.rowSubtitle} numberOfLines={1}>{subtitle}</Text>
            )}
          </View>
          {isSelected && (
            <View style={styles.checkBadge}>
              <Text style={styles.checkBadgeText}>✓</Text>
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [selectedLureName, selectedLureNames, onSelect, handleClose],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <Text style={styles.headerTitle}>🪝 Choisir un leurre</Text>
          <TouchableOpacity onPress={handleClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.closeBtn}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Recherche */}
        <View style={styles.searchRow}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher par nom, couleur, grosseur…"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {search.length > 0 && Platform.OS !== 'ios' && (
            <TouchableOpacity onPress={() => setSearch('')} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Liste */}
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🪝</Text>
              <Text style={styles.emptyText}>
                {userLures.length === 0 ? 'Aucun leurre dans votre boîte' : 'Aucun résultat'}
              </Text>
              <Text style={styles.emptySubtext}>
                {userLures.length === 0
                  ? 'Créez votre premier leurre ci-dessous.'
                  : 'Essayez d\'autres mots-clés.'}
              </Text>
            </View>
          }
        />

        {/* Bouton créer */}
        <View style={[styles.footer, { paddingBottom: spacing.md + insets.bottom }]}>
          <TouchableOpacity
            style={styles.createBtn}
            onPress={() => { handleClose(); onCreateNew(); }}
            activeOpacity={0.8}
          >
            <Text style={styles.createBtnText}>＋ Créer un nouveau leurre</Text>
          </TouchableOpacity>
        </View>
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
  closeBtn: {
    fontSize: 18,
    color: colors.textMuted,
    paddingHorizontal: 4,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 15,
    height: 44,
  },
  clearBtn: {
    padding: 4,
  },
  clearBtnText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  rowSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSubtle,
  },
  lureIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lureIconSelected: {
    backgroundColor: colors.accentStrong,
  },
  lureIconText: {
    fontSize: 20,
  },
  lurePhoto: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowInfo: {
    flex: 1,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  rowNameSelected: {
    color: colors.accent,
    fontWeight: '600',
  },
  rowSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
  },
  checkBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBadgeText: {
    color: colors.bg,
    fontSize: 13,
    fontWeight: '700',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: spacing.md,
  },
  emptyText: {
    ...typography.h3,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  emptySubtext: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  createBtn: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
  },
  createBtnText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
});
