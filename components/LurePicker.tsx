// ─── LurePicker ───────────────────────────────────────────────────────────────
// Modal de sélection de leurre avec grille visuelle, filtres par catégorie,
// barre de recherche et ajout de leurre custom.

import { useState, useMemo, useCallback, memo } from 'react';
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
  ScrollView,
  KeyboardAvoidingView,
  Alert,
} from 'react-native';
import {
  ALL_LURE_CATEGORIES,
  LURES_CATALOG,
  filterLures,
  type LureCategory,
  type LureConfig,
} from '@/lib/lures';
import { colors, radius, spacing, typography } from '@/lib/theme';

// ─── Types ────────────────────────────────────────────────────────────────────
type Props = {
  visible: boolean;
  /** Nom du leurre actuellement sélectionné (peut être un custom) */
  selectedLure: string | null;
  /** Leurres custom ajoutés par l'utilisateur (noms simples) */
  customLures?: string[];
  onSelect: (lureName: string) => void;
  onAddCustom?: (lureName: string) => void;
  onClose: () => void;
};

// ─── Constantes ───────────────────────────────────────────────────────────────
const CARD_GAP = 10;
const NUM_COLUMNS = 2;

// ─── Vignette avec fallback emoji si l'image ne charge pas ────────────────────
const LureThumbnail = memo(function LureThumbnail({
  photoUrl,
  emoji,
  bgColor,
}: {
  photoUrl: string | null;
  emoji: string;
  bgColor: string;
}) {
  const [imgError, setImgError] = useState(false);

  if (photoUrl && !imgError) {
    return (
      <Image
        source={{ uri: photoUrl }}
        style={[styles.cardPhoto, { backgroundColor: bgColor }]}
        resizeMode="cover"
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <View style={[styles.cardEmoji, { backgroundColor: bgColor }]}>
      <Text style={styles.cardEmojiText}>{emoji}</Text>
    </View>
  );
});

// ─── Composant principal ──────────────────────────────────────────────────────
export default function LurePicker({
  visible,
  selectedLure,
  customLures = [],
  onSelect,
  onAddCustom,
  onClose,
}: Props) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<LureCategory | null>(null);
  const [customInput, setCustomInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  // Réinitialiser la recherche à l'ouverture
  const handleClose = useCallback(() => {
    setSearch('');
    setActiveCategory(null);
    setShowCustomInput(false);
    setCustomInput('');
    onClose();
  }, [onClose]);

  // Résultats filtrés du catalogue
  const catalogResults = useMemo(
    () => filterLures(search, activeCategory),
    [search, activeCategory],
  );

  // Leurres custom filtrés
  const filteredCustom = useMemo(() => {
    if (activeCategory) return []; // Les customs n'ont pas de catégorie
    if (!search.trim()) return customLures;
    const q = search.toLowerCase();
    return customLures.filter((l) => l.toLowerCase().includes(q));
  }, [customLures, search, activeCategory]);

  const handleAddCustom = () => {
    const name = customInput.trim();
    if (!name) return;
    if (LURES_CATALOG.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      Alert.alert('Leurre existant', 'Ce leurre existe déjà dans le catalogue.');
      return;
    }
    onAddCustom?.(name);
    onSelect(name);
    setCustomInput('');
    setShowCustomInput(false);
    handleClose();
  };

  const renderCatalogItem = useCallback(
    ({ item }: { item: LureConfig }) => {
      const isSelected = selectedLure === item.name;
      return (
        <TouchableOpacity
          style={[styles.card, isSelected && styles.cardSelected]}
          onPress={() => { onSelect(item.name); handleClose(); }}
          activeOpacity={0.8}
        >
          {/* Photo ou emoji (avec fallback automatique) */}
          <LureThumbnail
            photoUrl={item.photoUrl}
            emoji={item.emoji}
            bgColor={item.bgColor}
          />
          {/* Infos */}
          <View style={styles.cardInfo}>
            <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
            <Text style={styles.cardBrand} numberOfLines={1}>{item.brand}</Text>
          </View>
          {/* Badge catégorie */}
          <View style={[styles.categoryDot, { backgroundColor: item.color }]} />
          {/* Checkmark si sélectionné */}
          {isSelected && (
            <View style={styles.checkBadge}>
              <Text style={styles.checkBadgeText}>✓</Text>
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [selectedLure, onSelect, handleClose],
  );

  const renderCustomItem = useCallback(
    (name: string) => {
      const isSelected = selectedLure === name;
      return (
        <TouchableOpacity
          key={name}
          style={[styles.card, styles.cardCustom, isSelected && styles.cardSelected]}
          onPress={() => { onSelect(name); handleClose(); }}
          activeOpacity={0.8}
        >
          <View style={[styles.cardEmoji, { backgroundColor: 'rgba(255,255,255,0.06)' }]}>
            <Text style={styles.cardEmojiText}>🪝</Text>
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.cardName} numberOfLines={2}>{name}</Text>
            <Text style={styles.cardBrand}>Custom</Text>
          </View>
          {isSelected && (
            <View style={styles.checkBadge}>
              <Text style={styles.checkBadgeText}>✓</Text>
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [selectedLure, onSelect, handleClose],
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
        {/* ── En-tête ─────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>🪝 Choisir un leurre</Text>
          <TouchableOpacity onPress={handleClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.closeBtn}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* ── Barre de recherche ──────────────────────────────────────────── */}
        <View style={styles.searchRow}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher un leurre ou une marque…"
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

        {/* ── Filtres catégorie ───────────────────────────────────────────── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoryScroll}
          contentContainerStyle={styles.categoryScrollContent}
        >
          <TouchableOpacity
            style={[styles.categoryChip, activeCategory === null && styles.categoryChipActive]}
            onPress={() => setActiveCategory(null)}
          >
            <Text style={[styles.categoryChipText, activeCategory === null && styles.categoryChipTextActive]}>
              Tous
            </Text>
          </TouchableOpacity>
          {ALL_LURE_CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[styles.categoryChip, activeCategory === cat && styles.categoryChipActive]}
              onPress={() => setActiveCategory(activeCategory === cat ? null : cat)}
            >
              <Text style={[styles.categoryChipText, activeCategory === cat && styles.categoryChipTextActive]}>
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── Grille de leurres ───────────────────────────────────────────── */}
        <FlatList
          data={catalogResults}
          keyExtractor={(item) => item.id}
          renderItem={renderCatalogItem}
          numColumns={NUM_COLUMNS}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            filteredCustom.length > 0 ? (
              <View style={styles.customSection}>
                <Text style={styles.sectionLabel}>MES LEURRES</Text>
                <View style={styles.gridRow}>
                  {filteredCustom.map((name) => renderCustomItem(name))}
                </View>
                <Text style={styles.sectionLabel}>CATALOGUE</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyText}>Aucun leurre trouvé</Text>
              <Text style={styles.emptySubtext}>
                Essaie d'autres mots-clés ou ajoute un leurre custom ci-dessous.
              </Text>
            </View>
          }
        />

        {/* ── Ajout leurre custom ─────────────────────────────────────────── */}
        <View style={styles.customFooter}>
          {showCustomInput ? (
            <View style={styles.customInputRow}>
              <TextInput
                style={styles.customTextInput}
                placeholder="Nom du leurre custom…"
                placeholderTextColor={colors.textMuted}
                value={customInput}
                onChangeText={setCustomInput}
                onSubmitEditing={handleAddCustom}
                returnKeyType="done"
                autoFocus
              />
              <TouchableOpacity
                style={[styles.customAddBtn, !customInput.trim() && styles.customAddBtnDisabled]}
                onPress={handleAddCustom}
                disabled={!customInput.trim()}
              >
                <Text style={styles.customAddBtnText}>Ajouter</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setShowCustomInput(false); setCustomInput(''); }}
                style={styles.customCancelBtn}
              >
                <Text style={styles.customCancelBtnText}>Annuler</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.addCustomBtn}
              onPress={() => setShowCustomInput(true)}
              activeOpacity={0.8}
            >
              <Text style={styles.addCustomBtnText}>+ Ajouter un leurre custom</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  // Header
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
  closeBtn: {
    fontSize: 18,
    color: colors.textMuted,
    paddingHorizontal: 4,
  },

  // Recherche
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

  // Catégories
  categoryScroll: {
    flexShrink: 0,
    marginBottom: spacing.sm,
  },
  categoryScrollContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  categoryChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryChipActive: {
    backgroundColor: colors.accentSubtle,
    borderColor: colors.accent,
  },
  categoryChipText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
  },
  categoryChipTextActive: {
    color: colors.accent,
    fontWeight: '600',
  },

  // Grille
  gridContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  gridRow: {
    gap: CARD_GAP,
    marginBottom: CARD_GAP,
  },

  // Carte leurre
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    position: 'relative',
  },
  cardSelected: {
    borderColor: colors.accent,
    borderWidth: 2,
  },
  cardCustom: {
    borderStyle: 'dashed',
  },
  cardPhoto: {
    width: '100%',
    height: 90,
  },
  cardEmoji: {
    width: '100%',
    height: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardEmojiText: {
    fontSize: 38,
  },
  cardInfo: {
    padding: spacing.sm,
  },
  cardName: {
    ...typography.label,
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 17,
    marginBottom: 2,
  },
  cardBrand: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '400',
  },
  categoryDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  checkBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBadgeText: {
    color: '#0B1A2B',
    fontSize: 13,
    fontWeight: '700',
  },

  // Section labels
  sectionLabel: {
    ...typography.caption,
    color: colors.textSubtle,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  customSection: {
    marginBottom: spacing.sm,
  },

  // État vide
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

  // Footer custom
  customFooter: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  addCustomBtn: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
  },
  addCustomBtnText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  customInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  customTextInput: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 44,
    color: colors.textPrimary,
    fontSize: 14,
  },
  customAddBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customAddBtnDisabled: {
    opacity: 0.4,
  },
  customAddBtnText: {
    color: '#0B1A2B',
    fontWeight: '700',
    fontSize: 14,
  },
  customCancelBtn: {
    paddingHorizontal: spacing.sm,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customCancelBtnText: {
    color: colors.textMuted,
    fontSize: 14,
  },
});
