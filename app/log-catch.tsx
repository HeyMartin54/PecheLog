import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '@/contexts/AuthContext';
import { DEV_TEST_USER_ID } from '@/lib/dev-test-user';
import { supabase } from '@/lib/supabase';

type SizeMode = 'approx' | 'weight' | 'length';
type SizeCategory = 'small' | 'medium' | 'large' | 'trophy';

type MediaItem = {
  uri: string;
  type: 'photo' | 'video';
};

type CatchPayload = {
  user_id: string;
  map_id: string | null;
  species: string;
  lure: string | null;
  latitude: number;
  longitude: number;
  lake_name: string | null;
  depth_meters: number | null;
  depth_source: 'manual' | 'sonar' | 'bathymetric' | null;
  temperature_c: number | null;
  wind_speed_kmh: number | null;
  speed_kmh: number | null;
  weather_conditions: string | null;
  size_category: SizeCategory | null;
  weight_lbs: number | null;
  length_inches: number | null;
  notes: string | null;
  local_id: string | null;
};

type OfflineQueuedCatch = {
  payload: CatchPayload;
  media: MediaItem[];
};

const OFFLINE_QUEUE_KEY = 'offline_catches_queue_v1';

const BG_COLOR = '#061425';
const CARD_COLOR = '#0E2236';
const ACCENT_COLOR = '#00D4AA';
const TEXT_PRIMARY = '#FFFFFF';
const TEXT_MUTED = 'rgba(255,255,255,0.6)';
const BORDER_COLOR = 'rgba(255,255,255,0.08)';

async function enqueueOfflineCatch(item: OfflineQueuedCatch) {
  try {
    const existing = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    const parsed: OfflineQueuedCatch[] = existing ? JSON.parse(existing) : [];
    parsed.push(item);
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(parsed));
  } catch (error) {
    console.warn('[Offline] Impossible d’enregistrer la prise hors-ligne', error);
  }
}

function buildCatchInsertPayload(payload: CatchPayload) {
  const { local_id: _localId, ...insertPayload } = payload;
  return insertPayload;
}

async function trySyncOfflineCatches(userId: string) {
  try {
    const existing = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!existing) return;

    const queue: OfflineQueuedCatch[] = JSON.parse(existing);
    if (!Array.isArray(queue) || queue.length === 0) return;

    const remaining: OfflineQueuedCatch[] = [];

    // On tente de pousser chaque entrée; en cas d’erreur réseau, on garde dans la file.
    // Note : pour l’instant on ne gère pas encore l’upload des médias vers Supabase Storage.
    for (const item of queue) {
      try {
        if (item.payload.user_id !== userId) {
          remaining.push(item);
          continue;
        }

        const { error } = await supabase
          .from('catches')
          .insert(buildCatchInsertPayload(item.payload));
        if (error) {
          console.warn('[Offline] Erreur lors de la sync catch hors-ligne', error);
          remaining.push(item);
        }
      } catch (err) {
        console.warn('[Offline] Erreur inattendue lors de la sync', err);
        remaining.push(item);
      }
    }

    if (remaining.length === 0) {
      await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
    } else {
      await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
    }
  } catch (error) {
    console.warn('[Offline] Impossible de synchroniser les prises hors-ligne', error);
  }
}

async function reverseGeocodeLakeName(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&zoom=14`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'PecheLog/1.0',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    // On tente de trouver un champ pertinent dans l’adresse.
    const lake =
      data?.address?.water ||
      data?.address?.lake ||
      data?.address?.reservoir ||
      data?.name;
    return lake ?? null;
  } catch (error) {
    console.warn('[Geocoding] Erreur reverse geocoding', error);
    return null;
  }
}

async function fetchWeatherFromOpenWeather(
  latitude: number,
  longitude: number,
): Promise<{ tempC: number | null; windKmh: number | null } | null> {
  const apiKey = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY;
  if (!apiKey) {
    console.warn('[Weather] EXPO_PUBLIC_OPENWEATHER_API_KEY manquante');
    return null;
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&units=metric&appid=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('[Weather] Réponse non OK', res.status);
      return null;
    }

    const data = await res.json();
    const tempC = typeof data?.main?.temp === 'number' ? data.main.temp : null;
    const windMs = typeof data?.wind?.speed === 'number' ? data.wind.speed : null;
    const windKmh = windMs != null ? windMs * 3.6 : null;

    return { tempC, windKmh };
  } catch (error) {
    console.warn('[Weather] Erreur lors du fetch météo', error);
    return null;
  }
}

export default function LogCatchScreen() {
  const router = useRouter();
  const { user } = useAuth();

  // Auto-captured
  const [coords, setCoords] = useState<Location.LocationObject | null>(null);
  const [lakeName, setLakeName] = useState<string | null>(null);
  const [temperatureC, setTemperatureC] = useState<number | null>(null);
  const [windSpeedKmh, setWindSpeedKmh] = useState<number | null>(null);
  const [speedKmh, setSpeedKmh] = useState<number | null>(null);
  const [autoLoading, setAutoLoading] = useState(true);

  // Manual fields
  const [speciesOptions, setSpeciesOptions] = useState<string[]>([
    'Doré jaune',
    'Brochet',
    'Truite',
    'Ouananiche',
    'Achigan',
    'Autre…',
  ]);
  const [lureOptions, setLureOptions] = useState<string[]>([
    'Rapala X-Rap',
    'Cuillère Mepps',
    'Jig 1/4oz',
    'Mouche',
    'Ver',
    '+ Ajouter',
  ]);

  const [selectedSpecies, setSelectedSpecies] = useState<string | null>('Doré jaune');
  const [selectedLure, setSelectedLure] = useState<string | null>('Rapala X-Rap');

  const [depthMeters, setDepthMeters] = useState<string>('');
  const [sonarDepthMeters] = useState<number | null>(null); // TODO: brancher sur useSonar quand dispo

  const [sizeMode, setSizeMode] = useState<SizeMode>('approx');
  const [sizeCategory, setSizeCategory] = useState<SizeCategory | null>('medium');
  const [weightLbs, setWeightLbs] = useState<string>('');
  const [lengthInches, setLengthInches] = useState<string>('');

  const [media, setMedia] = useState<MediaItem[]>([]);

  const [selectedMapOption, setSelectedMapOption] = useState<'personal' | 'shared'>(
    'personal',
  );

  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);

  const hasLocation = !!coords;

  useEffect(() => {
    // Au montage, on tente de :
    // 1) Charger la localisation + vitesse
    // 2) Faire du reverse geocoding pour le lac
    // 3) Récupérer la météo
    // 4) Synchroniser les prises hors-ligne en attente
    let isMounted = true;

    const init = async () => {
      const uid = user?.id ?? DEV_TEST_USER_ID;
      await trySyncOfflineCatches(uid);

      try {
        setAutoLoading(true);
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.warn('[Location] Permission refusée');
          return;
        }

        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        if (!isMounted) return;

        setCoords(loc);

        const speed = typeof loc.coords.speed === 'number' ? loc.coords.speed : null;
        setSpeedKmh(speed != null ? speed * 3.6 : null);

        const [lake, weather] = await Promise.all([
          reverseGeocodeLakeName(loc.coords.latitude, loc.coords.longitude),
          fetchWeatherFromOpenWeather(loc.coords.latitude, loc.coords.longitude),
        ]);

        if (!isMounted) return;
        setLakeName(lake);
        if (weather) {
          setTemperatureC(weather.tempC);
          setWindSpeedKmh(weather.windKmh);
        }
      } catch (error) {
        console.warn('[AutoFields] Erreur lors de la capture auto', error);
      } finally {
        if (isMounted) {
          setAutoLoading(false);
        }
      }
    };

    init();

    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  useEffect(() => {
    // Charger les préférences de l’utilisateur pour peupler espèces / leurres
    const loadPreferences = async () => {
      if (!user?.id) return;
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('preferred_species, preferred_lures')
          .eq('id', user.id)
          .maybeSingle();

        if (error) {
          console.warn('[LogCatch] Erreur chargement préférences', error);
          return;
        }

        if (data?.preferred_species && Array.isArray(data.preferred_species)) {
          const arr = data.preferred_species.filter((s: unknown) => typeof s === 'string');
          if (arr.length > 0) {
            setSpeciesOptions(arr);
            setSelectedSpecies(arr[0]);
          }
        }

        if (data?.preferred_lures && Array.isArray(data.preferred_lures)) {
          const arr = data.preferred_lures.filter((s: unknown) => typeof s === 'string');
          if (arr.length > 0) {
            setLureOptions(arr);
            setSelectedLure(arr[0]);
          }
        }
      } catch (error) {
        console.warn('[LogCatch] Erreur inattendue chargement préférences', error);
      }
    };

    loadPreferences();
  }, [user?.id]);

  const now = useMemo(() => new Date(), []);

  const formattedTime = useMemo(() => {
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [now]);

  const formattedDate = useMemo(() => {
    return now.toLocaleDateString('fr-CA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }, [now]);

  const speedBadgeValue = useMemo(() => {
    if (speedKmh == null) return null;
    return `${speedKmh.toFixed(1)} km/h`;
  }, [speedKmh]);

  const handlePickMedia = async (type: 'photo' | 'video') => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert(
          'Permissions',
          "Impossible d’accéder à ta galerie sans la permission de lecture.",
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes:
          type === 'photo'
            ? ImagePicker.MediaTypeOptions.Images
            : ImagePicker.MediaTypeOptions.Videos,
        quality: 0.8,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      if (!asset.uri) return;

      setMedia((prev) => [...prev, { uri: asset.uri, type }]);
    } catch (error) {
      console.warn('[Media] Erreur lors de la sélection', error);
    }
  };

  const handleSave = async () => {
    const effectiveUserId = user?.id ?? DEV_TEST_USER_ID;

    if (!selectedSpecies) {
      Alert.alert('Espèce', 'Sélectionne une espèce.');
      return;
    }

    if (!coords) {
      Alert.alert(
        'Localisation',
        "Impossible de récupérer ta position. Vérifie que le GPS est activé et réessaie.",
      );
      return;
    }

    const depthValue =
      depthMeters.trim().length > 0 ? Number.parseFloat(depthMeters.replace(',', '.')) : null;
    const weightValue =
      weightLbs.trim().length > 0 ? Number.parseFloat(weightLbs.replace(',', '.')) : null;
    const lengthValue =
      lengthInches.trim().length > 0 ? Number.parseFloat(lengthInches.replace(',', '.')) : null;

    const sizeCategoryValue: SizeCategory | null =
      sizeMode === 'approx' ? sizeCategory : null;

    const payload: CatchPayload = {
      user_id: effectiveUserId,
      map_id: null, // TODO: brancher sur la carte sélectionnée (personnelle / partagée)
      species: selectedSpecies,
      lure: selectedLure,
      latitude: coords.coords.latitude,
      longitude: coords.coords.longitude,
      lake_name: lakeName,
      depth_meters: depthValue,
      depth_source: depthValue != null ? 'manual' : sonarDepthMeters != null ? 'sonar' : null,
      temperature_c: temperatureC,
      wind_speed_kmh: windSpeedKmh,
      speed_kmh: speedKmh,
      weather_conditions: null,
      size_category: sizeCategoryValue,
      weight_lbs: sizeMode === 'weight' ? weightValue : null,
      length_inches: sizeMode === 'length' ? lengthValue : null,
      notes: notes.trim().length > 0 ? notes.trim() : null,
      local_id: `local_${Date.now()}`,
    };

    setSaving(true);
    try {
      const { error } = await supabase
        .from('catches')
        .insert(buildCatchInsertPayload(payload));

      if (error) {
        console.warn('[LogCatch] Erreur lors de l’enregistrement en ligne, on bascule hors-ligne', error);
        await enqueueOfflineCatch({ payload, media });
        Alert.alert(
          'Mode hors-ligne',
          'Prise enregistrée localement. Elle sera synchronisée au retour du signal.',
        );
        router.back();
        return;
      }

      Alert.alert('Prise enregistrée', 'Ta prise a été enregistrée avec succès.');
      router.back();
    } catch (error) {
      console.warn('[LogCatch] Erreur inattendue, stockage hors-ligne', error);
      await enqueueOfflineCatch({ payload, media });
      Alert.alert(
        'Mode hors-ligne',
        'Prise enregistrée localement. Elle sera synchronisée au retour du signal.',
      );
      router.back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <View>
            {/* Simple flèche retour stylée */}
            <View>
              <AutoFieldText style={styles.backButtonText}>{'←'}</AutoFieldText>
            </View>
          </View>
        </TouchableOpacity>
        <AutoFieldText style={styles.headerTitle}>Nouvelle prise</AutoFieldText>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Auto-captured section */}
        <View style={styles.section}>
          <SectionTitle>📍 Capturé automatiquement</SectionTitle>

          {autoLoading && (
            <View style={styles.autoLoadingRow}>
              <ActivityIndicator size="small" color={ACCENT_COLOR} />
              <AutoFieldText style={styles.autoLoadingText}>
                Récupération de ta position…
              </AutoFieldText>
            </View>
          )}

          <View style={styles.autoFieldsRow}>
            <AutoFieldBadge icon="📍" value={hasLocation ? `${coords?.coords.latitude.toFixed(4)}, ${coords?.coords.longitude.toFixed(4)}` : 'GPS…'} />
            <AutoFieldBadge icon="🏔" value={lakeName ?? 'Lac inconnu'} />
            <AutoFieldBadge
              icon="🌡"
              value={temperatureC != null ? `${temperatureC.toFixed(1)} °C` : 'Météo…'}
            />
            <AutoFieldBadge
              icon="🕐"
              value={formattedTime}
            />
            <AutoFieldBadge icon="📅" value={formattedDate} />
            {speedBadgeValue && <AutoFieldBadge icon="🚤" value={speedBadgeValue} />}
          </View>
        </View>

        {/* Species */}
        <View style={styles.section}>
          <SectionTitle>🐟 Espèce</SectionTitle>
          <View style={styles.chipRow}>
            {speciesOptions.map((s) => (
              <Chip
                key={s}
                label={s}
                selected={selectedSpecies === s}
                onPress={() => setSelectedSpecies(s)}
              />
            ))}
          </View>
        </View>

        {/* Lure */}
        <View style={styles.section}>
          <SectionTitle>🪝 Leurre</SectionTitle>
          <View style={styles.chipRow}>
            {lureOptions.map((lure) => (
              <Chip
                key={lure}
                label={lure}
                selected={selectedLure === lure}
                onPress={() => setSelectedLure(lure)}
              />
            ))}
          </View>
        </View>

        {/* Depth */}
        <View style={styles.section}>
          <SectionTitle>📏 Profondeur</SectionTitle>

          {sonarDepthMeters != null && (
            <View style={styles.autoFieldsRow}>
              <View style={styles.autoField}>
                <AutoFieldText style={styles.autoFieldIcon}>📡</AutoFieldText>
                <AutoFieldText style={styles.autoFieldLabel}>Sonar:</AutoFieldText>
                <AutoFieldText style={styles.autoFieldValue}>
                  {sonarDepthMeters.toFixed(1)} m
                </AutoFieldText>
              </View>
            </View>
          )}

          <View style={styles.inputGroup}>
            <TextInput
              style={styles.input}
              placeholder="Corriger manuellement (ex: 5.5m)"
              placeholderTextColor={TEXT_MUTED}
              keyboardType="decimal-pad"
              value={depthMeters}
              onChangeText={setDepthMeters}
            />
          </View>
        </View>

        {/* Size */}
        <View style={styles.section}>
          <SectionTitle>📐 Grosseur</SectionTitle>

          <View style={styles.sizeToggleRow}>
            <SizeToggleButton
              label="P / M / G"
              active={sizeMode === 'approx'}
              onPress={() => setSizeMode('approx')}
            />
            <SizeToggleButton
              label="Poids (lb)"
              active={sizeMode === 'weight'}
              onPress={() => setSizeMode('weight')}
            />
            <SizeToggleButton
              label="Longueur (po)"
              active={sizeMode === 'length'}
              onPress={() => setSizeMode('length')}
            />
          </View>

          {sizeMode === 'approx' && (
            <View style={styles.chipRow}>
              <Chip
                label="🐟 Petit"
                selected={sizeCategory === 'small'}
                onPress={() => setSizeCategory('small')}
              />
              <Chip
                label="🐠 Moyen"
                selected={sizeCategory === 'medium'}
                onPress={() => setSizeCategory('medium')}
              />
              <Chip
                label="🐋 Gros"
                selected={sizeCategory === 'large'}
                onPress={() => setSizeCategory('large')}
              />
              <Chip
                label="🏆 Trophée"
                selected={sizeCategory === 'trophy'}
                onPress={() => setSizeCategory('trophy')}
              />
            </View>
          )}

          {sizeMode === 'weight' && (
            <View style={styles.inputGroup}>
              <TextInput
                style={styles.input}
                placeholder="Poids en livres (ex: 4.2)"
                placeholderTextColor={TEXT_MUTED}
                keyboardType="decimal-pad"
                value={weightLbs}
                onChangeText={setWeightLbs}
              />
            </View>
          )}

          {sizeMode === 'length' && (
            <View style={styles.inputGroup}>
              <TextInput
                style={styles.input}
                placeholder="Longueur en pouces (ex: 18.5)"
                placeholderTextColor={TEXT_MUTED}
                keyboardType="decimal-pad"
                value={lengthInches}
                onChangeText={setLengthInches}
              />
            </View>
          )}
        </View>

        {/* Photos / Vidéos */}
        <View style={styles.section}>
          <SectionTitle>📸 Photos / Vidéos</SectionTitle>
          <View style={styles.photoRow}>
            <PhotoSlot label="Photo" icon="📷" onPress={() => handlePickMedia('photo')} />
            <PhotoSlot label="Vidéo" icon="🎥" onPress={() => handlePickMedia('video')} />
            <PhotoSlot label="Ajouter" icon="➕" onPress={() => handlePickMedia('photo')} />
          </View>
        </View>

        {/* Map selection */}
        <View style={styles.section}>
          <SectionTitle>🗺 Ajouter à quelle carte</SectionTitle>
          <View style={styles.mapSelector}>
            <MapOptionCard
              title="📌 Ma carte personnelle"
              description="Visible uniquement par vous"
              selected={selectedMapOption === 'personal'}
              onPress={() => setSelectedMapOption('personal')}
            />
            <MapOptionCard
              title="🤝 Carte partagée"
              description="Partagée avec vos partenaires de pêche"
              selected={selectedMapOption === 'shared'}
              onPress={() => setSelectedMapOption('shared')}
            />
          </View>
        </View>

        {/* Notes */}
        <View style={styles.section}>
          <SectionTitle>📝 Notes additionnelles</SectionTitle>
          <TextInput
            style={[styles.input, styles.notesInput]}
            multiline
            numberOfLines={4}
            placeholder="Ex: vent léger du nord, eau claire, fond de sable..."
            placeholderTextColor={TEXT_MUTED}
            value={notes}
            onChangeText={setNotes}
          />
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      <TouchableOpacity
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        activeOpacity={0.9}
        onPress={saving ? undefined : handleSave}
      >
        {saving ? (
          <ActivityIndicator color="#0B1A2B" />
        ) : (
          <AutoFieldText style={styles.saveButtonText}>✓ Enregistrer la prise</AutoFieldText>
        )}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

type SectionTitleProps = {
  children: React.ReactNode;
};

function SectionTitle({ children }: SectionTitleProps) {
  return (
    <AutoFieldText style={styles.sectionTitleText}>
      {children}
    </AutoFieldText>
  );
}

type ChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

function Chip({ label, selected, onPress }: ChipProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
      activeOpacity={0.85}
    >
      <AutoFieldText style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </AutoFieldText>
    </TouchableOpacity>
  );
}

type SizeToggleButtonProps = {
  label: string;
  active: boolean;
  onPress: () => void;
};

function SizeToggleButton({ label, active, onPress }: SizeToggleButtonProps) {
  return (
    <TouchableOpacity
      style={[styles.sizeToggleButton, active && styles.sizeToggleButtonActive]}
      onPress={onPress}
      activeOpacity={0.9}
    >
      <AutoFieldText
        style={[styles.sizeToggleButtonText, active && styles.sizeToggleButtonTextActive]}
      >
        {label}
      </AutoFieldText>
    </TouchableOpacity>
  );
}

type MapOptionCardProps = {
  title: string;
  description: string;
  selected: boolean;
  onPress: () => void;
};

function MapOptionCard({ title, description, selected, onPress }: MapOptionCardProps) {
  return (
    <TouchableOpacity
      style={[styles.mapOption, selected && styles.mapOptionSelected]}
      onPress={onPress}
      activeOpacity={0.9}
    >
      <View style={[styles.mapRadio, selected && styles.mapRadioSelected]} />
      <View style={styles.mapInfo}>
        <AutoFieldText style={styles.mapTitle}>{title}</AutoFieldText>
        <AutoFieldText style={styles.mapDescription}>{description}</AutoFieldText>
      </View>
    </TouchableOpacity>
  );
}

type PhotoSlotProps = {
  label: string;
  icon: string;
  onPress: () => void;
};

function PhotoSlot({ label, icon, onPress }: PhotoSlotProps) {
  return (
    <TouchableOpacity style={styles.photoSlot} onPress={onPress} activeOpacity={0.9}>
      <AutoFieldText style={styles.photoSlotIcon}>{icon}</AutoFieldText>
      <AutoFieldText style={styles.photoSlotText}>{label}</AutoFieldText>
    </TouchableOpacity>
  );
}

type AutoFieldTextProps = {
  children: React.ReactNode;
  style?: object;
};

function AutoFieldText({ children, style }: AutoFieldTextProps) {
  return <ActivityIndicatorText style={style}>{children}</ActivityIndicatorText>;
}

// Petit wrapper pour avoir un composant texte unique si l’app utilise un composant Thème plus tard.
function ActivityIndicatorText({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object;
}) {
  // On utilise simplement TextInput pour garder le Text natif sans importer de Themed.Text ici.
  // Cela permet d’éviter les conflits de thème tout en restant simple.
  // eslint-disable-next-line react-native/no-inline-styles
  return (
    // @ts-expect-error – on réutilise TextInput comme conteneur de texte non éditable
    <TextInput style={[{ color: TEXT_PRIMARY }, style]} editable={false} value={String(children)} />
  );
}

type AutoFieldBadgeProps = {
  icon: string;
  value: string;
};

function AutoFieldBadge({ icon, value }: AutoFieldBadgeProps) {
  return (
    <View style={[styles.autoField, styles.autoFieldAuto]}>
      <AutoFieldText style={styles.autoFieldIcon}>{icon}</AutoFieldText>
      <AutoFieldText style={styles.autoFieldValue}>{value}</AutoFieldText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG_COLOR,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 24,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER_COLOR,
    backgroundColor: BG_COLOR,
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  backButtonText: {
    fontSize: 18,
    color: TEXT_PRIMARY,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 16,
    paddingBottom: 96,
  },
  section: {
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  sectionTitleText: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: TEXT_MUTED,
    marginBottom: 10,
    fontWeight: '600',
  },
  autoFieldsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  autoField: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: CARD_COLOR,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
  },
  autoFieldAuto: {
    borderColor: 'rgba(0,212,170,0.3)',
  },
  autoFieldIcon: {
    fontSize: 14,
    marginRight: 4,
  },
  autoFieldLabel: {
    fontSize: 11,
    color: TEXT_MUTED,
    marginRight: 4,
  },
  autoFieldValue: {
    fontSize: 13,
    fontWeight: '500',
    color: ACCENT_COLOR,
  },
  autoLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  autoLoadingText: {
    fontSize: 13,
    color: TEXT_MUTED,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    backgroundColor: CARD_COLOR,
  },
  chipSelected: {
    borderColor: ACCENT_COLOR,
    backgroundColor: 'rgba(0,212,170,0.12)',
  },
  chipText: {
    fontSize: 13,
    color: TEXT_MUTED,
  },
  chipTextSelected: {
    color: ACCENT_COLOR,
    fontWeight: '600',
  },
  inputGroup: {
    marginBottom: 14,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    backgroundColor: CARD_COLOR,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 14,
    color: TEXT_PRIMARY,
  },
  notesInput: {
    height: 100,
    textAlignVertical: 'top',
  },
  sizeToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  sizeToggleButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    backgroundColor: CARD_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeToggleButtonActive: {
    borderColor: ACCENT_COLOR,
    backgroundColor: 'rgba(0,212,170,0.16)',
  },
  sizeToggleButtonText: {
    fontSize: 12,
    color: TEXT_MUTED,
  },
  sizeToggleButtonTextActive: {
    color: ACCENT_COLOR,
    fontWeight: '600',
  },
  photoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  photoSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    backgroundColor: CARD_COLOR,
  },
  photoSlotIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  photoSlotText: {
    fontSize: 13,
    color: TEXT_MUTED,
  },
  mapSelector: {
    gap: 10,
  },
  mapOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    backgroundColor: CARD_COLOR,
  },
  mapOptionSelected: {
    borderColor: ACCENT_COLOR,
  },
  mapRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: TEXT_MUTED,
    marginRight: 10,
  },
  mapRadioSelected: {
    borderColor: ACCENT_COLOR,
    backgroundColor: 'rgba(0,212,170,0.2)',
  },
  mapInfo: {
    flex: 1,
  },
  mapTitle: {
    fontSize: 14,
    color: TEXT_PRIMARY,
    marginBottom: 2,
  },
  mapDescription: {
    fontSize: 12,
    color: TEXT_MUTED,
  },
  bottomSpacer: {
    height: 40,
  },
  saveButton: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: Platform.OS === 'ios' ? 24 : 16,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: ACCENT_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00D4AA',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 6,
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0B1A2B',
  },
});

