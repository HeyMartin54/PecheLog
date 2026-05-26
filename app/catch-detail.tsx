import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import LocationPickerMap from '@/components/LocationPickerMap';
import LureFormModal from '@/components/LureFormModal';
import LurePicker from '@/components/LurePicker';
import { supabase } from '@/lib/supabase';
import { uploadMediaFile } from '@/lib/uploadMedia';
import { loadCatchesCache } from '@/lib/catchCache';
import { useNetworkStatus } from '@/lib/hooks/useNetworkStatus';
import { useAuth } from '@/contexts/AuthContext';
import {
  createUserLure,
  loadLuresWithCache,
  setCachedLures,
  type UserLure,
} from '@/lib/lureStorage';

type SizeCategory = 'small' | 'medium' | 'large' | 'trophy';
type SizeMode = 'approx' | 'measures';

type CatchMedia = {
  id: string;
  media_type: 'photo' | 'video';
  storage_path: string;
  thumbnail_path: string | null;
  local_uri: string | null;
  uploaded: boolean;
};

function windDegToCompass(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return dirs[Math.round(deg / 45) % 8];
}

type WeatherData = {
  tempC: number | null;
  windKmh: number | null;
  windDeg: number | null;
  conditions: string | null;
  conditionsIcon: string;
};

function getWeatherConditionFr(main: string, cloudiness: number): { label: string; icon: string } {
  switch (main) {
    case 'Clear': return { label: 'Ensoleillé', icon: '☀️' };
    case 'Clouds':
      if (cloudiness < 25) return { label: 'Peu nuageux', icon: '🌤' };
      if (cloudiness < 75) return { label: 'Partiellement nuageux', icon: '⛅' };
      return { label: 'Nuageux', icon: '☁️' };
    case 'Rain':
    case 'Drizzle': return { label: 'Pluie', icon: '🌧' };
    case 'Thunderstorm': return { label: 'Orage', icon: '⛈' };
    case 'Snow': return { label: 'Neige', icon: '🌨' };
    case 'Mist':
    case 'Fog':
    case 'Haze': return { label: 'Brume', icon: '🌫' };
    default: return { label: main, icon: '🌡' };
  }
}

async function fetchWeatherFromOpenWeather(lat: number, lon: number): Promise<WeatherData | null> {
  const apiKey = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const tempC = typeof data?.main?.temp === 'number' ? data.main.temp : null;
    const windMs = typeof data?.wind?.speed === 'number' ? data.wind.speed : null;
    const windKmh = windMs != null ? windMs * 3.6 : null;
    const windDeg = typeof data?.wind?.deg === 'number' ? data.wind.deg : null;
    const weatherMain: string = data?.weather?.[0]?.main ?? '';
    const cloudiness: number = typeof data?.clouds?.all === 'number' ? data.clouds.all : 50;
    const { label, icon } = weatherMain ? getWeatherConditionFr(weatherMain, cloudiness) : { label: null, icon: '🌡' };
    return { tempC, windKmh, windDeg, conditions: label, conditionsIcon: icon };
  } catch { return null; }
}

function dtFmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dtFmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function fetchWeatherForDatetime(lat: number, lon: number, datetime: Date): Promise<WeatherData | null> {
  const diffMs = Date.now() - datetime.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffMs < 60 * 60 * 1000) return fetchWeatherFromOpenWeather(lat, lon);

  try {
    const dateStr = datetime.toISOString().slice(0, 10);
    const baseUrl = diffDays <= 92
      ? `https://api.open-meteo.com/v1/forecast?past_days=${Math.ceil(diffDays)}&forecast_days=1`
      : `https://archive-api.open-meteo.com/v1/archive?start_date=${dateStr}&end_date=${dateStr}`;
    const url = `${baseUrl}&latitude=${lat}&longitude=${lon}&hourly=temperature_2m,windspeed_10m,winddirection_10m,cloudcover&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
    const data = await res.json();
    const times: string[] = data.hourly?.time ?? [];
    const targetHour = datetime.getHours();
    const idx = times.findIndex((t) => t.startsWith(dateStr) && new Date(t).getHours() === targetHour);
    if (idx === -1) throw new Error('Heure non trouvée');
    const tempC = data.hourly.temperature_2m?.[idx] ?? null;
    const windKmh = data.hourly.windspeed_10m?.[idx] ?? null;
    const windDeg = data.hourly.winddirection_10m?.[idx] ?? null;
    const cloudiness: number = data.hourly.cloudcover?.[idx] ?? 50;
    const weatherMain = cloudiness < 20 ? 'Clear' : cloudiness < 70 ? 'Clouds' : 'Overcast';
    const { label, icon } = getWeatherConditionFr(weatherMain, cloudiness);
    return { tempC, windKmh, windDeg, conditions: label, conditionsIcon: icon };
  } catch (e) {
    console.warn('[Weather] Open-Meteo historique échoué, fallback courant', e);
    return fetchWeatherFromOpenWeather(lat, lon);
  }
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
  const isWeb = Platform.OS === 'web';
  const { user } = useAuth();
  const isConnected = useNetworkStatus();
  const insets = useSafeAreaInsets();

  const [catch_, setCatch] = useState<CatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Editable fields
  const [species, setSpecies] = useState('');
  const [lure, setLure] = useState('');
  const [lakeName, setLakeName] = useState('');
  const [depthMeters, setDepthMeters] = useState('');
  const [sizeMode, setSizeMode] = useState<SizeMode>('approx');
  const [sizeCategory, setSizeCategory] = useState<SizeCategory | null>(null);
  const [weightLbs, setWeightLbs] = useState('');
  const [lengthInches, setLengthInches] = useState('');
  const [mediaItems, setMediaItems] = useState<CatchMedia[]>([]);
  const [newMedia, setNewMedia] = useState<{ uri: string; type: 'photo' | 'video' }[]>([]);
  const [notes, setNotes] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [pickerCoord, setPickerCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [showLurePicker, setShowLurePicker] = useState(false);
  const [showLureForm, setShowLureForm] = useState(false);
  const [userLures, setUserLures] = useState<UserLure[]>([]);

  // Date/heure éditable + météo associée
  const [editDateTime, setEditDateTime] = useState<Date>(() => new Date());
  const [showDateTimePicker, setShowDateTimePicker] = useState(false);
  const [datePickerMode, setDatePickerMode] = useState<'date' | 'time'>('date');
  const [editTempC, setEditTempC] = useState<number | null>(null);
  const [editWindKmh, setEditWindKmh] = useState<number | null>(null);
  const [editWindDeg, setEditWindDeg] = useState<number | null>(null);
  const [editConditions, setEditConditions] = useState<string | null>(null);
  // Web : états string intermédiaires
  const [webDate, setWebDate] = useState(() => dtFmtDate(new Date()));
  const [webTime, setWebTime] = useState(() => dtFmtTime(new Date()));

  useEffect(() => {
    if (!id) return;
    loadCatch();
  }, [id, isConnected]);

  useEffect(() => {
    if (!user?.id) return;
    loadLuresWithCache(user.id).then(setUserLures);
  }, [user?.id]);

  async function loadCatch() {
    setLoading(true);

    // Hors-ligne : chercher dans le cache local
    if (isConnected === false) {
      if (user?.id) {
        const cached = await loadCatchesCache(user.id);
        const found = cached?.find((c) => c.id === id);
        if (found) {
          const detail = found as unknown as CatchDetail;
          setCatch(detail);
          populateForm(detail);
          setFromCache(true);
          setLoading(false);
          return;
        }
      }
      Alert.alert('Hors-ligne', 'Cette prise n\'est pas disponible localement.');
      router.back();
      return;
    }

    setFromCache(false);
    try {
      const [catchRes, mediaRes] = await Promise.all([
        supabase
          .from('catches')
          .select(
            'id, species, lure, latitude, longitude, lake_name, depth_meters, depth_source, ' +
            'temperature_c, wind_speed_kmh, wind_direction_deg, speed_kmh, weather_conditions, ' +
            'size_category, weight_lbs, length_inches, notes, caught_at',
          )
          .eq('id', id)
          .single(),
        supabase
          .from('catch_media')
          .select('id, media_type, storage_path, thumbnail_path, local_uri, uploaded')
          .eq('catch_id', id)
          .order('created_at'),
      ]);

      if (catchRes.error || !catchRes.data) {
        // Tentative de fallback sur le cache
        if (user?.id) {
          const cached = await loadCatchesCache(user.id);
          const found = cached?.find((c) => c.id === id);
          if (found) {
            const detail = found as unknown as CatchDetail;
            setCatch(detail);
            populateForm(detail);
            setFromCache(true);
            return;
          }
        }
        Alert.alert('Erreur', 'Impossible de charger cette prise.');
        router.back();
        return;
      }

      setCatch(catchRes.data as unknown as CatchDetail);
      populateForm(catchRes.data as unknown as CatchDetail);
      setMediaItems((mediaRes.data ?? []) as CatchMedia[]);
    } finally {
      setLoading(false);
    }
  }

  function populateForm(data: CatchDetail) {
    setSpecies(data.species ?? '');
    setLure(data.lure ?? '');
    setLakeName(data.lake_name ?? '');
    setDepthMeters(data.depth_meters != null ? (data.depth_meters * 3.28084).toFixed(1) : '');
    const hasMeasures = data.weight_lbs != null || data.length_inches != null;
    setSizeMode(hasMeasures ? 'measures' : 'approx');
    setSizeCategory(data.size_category ?? null);
    setWeightLbs(data.weight_lbs != null ? String(data.weight_lbs) : '');
    setLengthInches(data.length_inches != null ? String(data.length_inches) : '');
    setNotes(data.notes ?? '');
    setLatitude(data.latitude ?? null);
    setLongitude(data.longitude ?? null);
    if (data.latitude != null && data.longitude != null) {
      setPickerCoord({ latitude: data.latitude, longitude: data.longitude });
    }
    const dt = new Date(data.caught_at);
    setEditDateTime(dt);
    setWebDate(dtFmtDate(dt));
    setWebTime(dtFmtTime(dt));
    setEditTempC(data.temperature_c ?? null);
    setEditWindKmh(data.wind_speed_kmh ?? null);
    setEditWindDeg(data.wind_direction_deg ?? null);
    setEditConditions(data.weather_conditions ?? null);
  }

  function handleEditToggle() {
    if (editing && catch_) {
      populateForm(catch_);
      setNewMedia([]);
    }
    setEditing((v) => !v);
  }

  const handleWebDateBlur = () => {
    const parts = webDate.trim().split('-').map(Number);
    if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
      const [y, m, d] = parts;
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        const dt = new Date(editDateTime);
        dt.setFullYear(y, m - 1, d);
        handleDateTimeCommit(dt);
      }
    }
  };

  const handleWebTimeBlur = () => {
    const parts = webTime.trim().split(':').map(Number);
    if (parts.length >= 2 && parts.every((n) => !isNaN(n))) {
      const [h, min] = parts;
      if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
        const dt = new Date(editDateTime);
        dt.setHours(h, min, 0, 0);
        handleDateTimeCommit(dt);
      }
    }
  };

  const handleDateTimeCommit = async (dt: Date) => {
    setEditDateTime(dt);
    setWebDate(dtFmtDate(dt));
    setWebTime(dtFmtTime(dt));
    if (latitude == null || longitude == null) return;
    const weather = await fetchWeatherForDatetime(latitude, longitude, dt);
    if (weather) {
      setEditTempC(weather.tempC);
      setEditWindKmh(weather.windKmh);
      setEditWindDeg(weather.windDeg);
      setEditConditions(weather.conditions);
    }
  };

  const refreshEditWeather = async (lat: number, lon: number) => {
    const w = await fetchWeatherForDatetime(lat, lon, editDateTime);
    if (w) {
      setEditTempC(w.tempC);
      setEditWindKmh(w.windKmh);
      setEditWindDeg(w.windDeg);
      setEditConditions(w.conditions);
    }
  };

  const handlePickerChange = (_: any, selected?: Date) => {
    if (Platform.OS === 'android') {
      setShowDateTimePicker(false);
      if (!selected) return;
      if (datePickerMode === 'date') {
        const merged = new Date(selected);
        merged.setHours(editDateTime.getHours(), editDateTime.getMinutes(), 0, 0);
        setEditDateTime(merged);
        setDatePickerMode('time');
        setShowDateTimePicker(true);
      } else {
        const merged = new Date(editDateTime);
        merged.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
        handleDateTimeCommit(merged);
        setDatePickerMode('date');
      }
    } else {
      if (selected) handleDateTimeCommit(selected);
    }
  };

  const pickMediaFile = async (useCamera: boolean) => {
    let result: ImagePicker.ImagePickerResult;
    const options = { mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 0.8 as const };
    if (useCamera) {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission refusée', "Autorisez l'accès à la caméra dans les réglages.");
        return;
      }
      result = await ImagePicker.launchCameraAsync(options);
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permissions', "Impossible d'accéder à ta galerie sans la permission de lecture.");
        return;
      }
      result = await ImagePicker.launchImageLibraryAsync(options);
    }
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const type: 'photo' | 'video' = asset.type === 'video' ? 'video' : 'photo';
      setNewMedia((prev) => [...prev, { uri: asset.uri, type }]);
    }
  };

  const handlePickMedia = () => {
    if (Platform.OS === 'web') {
      pickMediaFile(false);
      return;
    }
    Alert.alert('Ajouter un média', 'Choisir une source', [
      { text: 'Prendre une photo', onPress: () => pickMediaFile(true) },
      { text: 'Choisir dans la bibliothèque', onPress: () => pickMediaFile(false) },
      { text: 'Annuler', style: 'cancel' },
    ]);
  };

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
        depth_meters: depthMeters !== '' ? parseFloat(depthMeters) * 0.3048 : null,
        size_category: sizeMode === 'approx' ? sizeCategory : null,
        weight_lbs: sizeMode === 'measures' && weightLbs !== '' ? parseFloat(weightLbs) : null,
        length_inches: sizeMode === 'measures' && lengthInches !== '' ? parseFloat(lengthInches) : null,
        notes: notes.trim() || null,
        latitude,
        longitude,
        caught_at: editDateTime.toISOString(),
        temperature_c: editTempC,
        wind_speed_kmh: editWindKmh,
        wind_direction_deg: editWindDeg,
        weather_conditions: editConditions,
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

      // Upload des nouveaux médias ajoutés en mode édition
      for (const item of newMedia) {
        try {
          const { storagePath } = await uploadMediaFile(item.uri, user!.id, catch_.id, item.type);
          const { data: inserted } = await supabase
            .from('catch_media')
            .insert({ catch_id: catch_.id, media_type: item.type, storage_path: storagePath, uploaded: true })
            .select()
            .single();
          if (inserted) setMediaItems((prev) => [...prev, inserted as CatchMedia]);
        } catch (mediaErr) {
          console.warn('[CatchDetail] Erreur upload media', mediaErr);
        }
      }
      setNewMedia([]);
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
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Retour</Text>
        </TouchableOpacity>
        {fromCache ? (
          <View style={styles.offlineBadge}>
            <Ionicons name="cloud-offline-outline" size={12} color={colors.warning} />
            <Text style={styles.offlineBadgeText}>Lecture seule</Text>
          </View>
        ) : (
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
        )}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 48 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
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
          {/* Carte dans la card — hauteur fixe, aucun problème de flex */}
          {pickerCoord != null && (
            <View style={styles.cardMap}>
              <LocationPickerMap
                coordinate={pickerCoord}
                height={280}
                onCoordinateChange={(c) => {
                  if (!editing) return;
                  setPickerCoord(c);
                  setLatitude(c.latitude);
                  setLongitude(c.longitude);
                  refreshEditWeather(c.latitude, c.longitude);
                }}
              />
              {/* Overlay bloquant les interactions hors mode édition */}
              {!editing && (
                <View style={[StyleSheet.absoluteFill, { zIndex: 500 }]} />
              )}
              {/* Bouton Modifier visible en mode édition — mobile uniquement */}
              {!isWeb && editing && (
                <TouchableOpacity
                  style={styles.cardMapEditBtn}
                  onPress={() => setShowLocationPicker(true)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.cardMapEditBtnText}>✏️ Choisir sur la carte</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <View style={styles.lieuContent}>
            <View style={{ flex: 1 }}>
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
              {editing ? (
                Platform.OS === 'web' ? (
                  <View style={styles.dateTimeButton}>
                    <Text style={styles.dateTimeBtnIcon}>📅</Text>
                    <TextInput
                      style={[styles.dateTimeBtnDate, { flex: 1, padding: 0 }]}
                      value={webDate}
                      onChangeText={setWebDate}
                      onBlur={handleWebDateBlur}
                      placeholder="AAAA-MM-JJ"
                      placeholderTextColor={ACCENT}
                      maxLength={10}
                    />
                    <Text style={[styles.dateTimeBtnTime, { marginHorizontal: 8, opacity: 1 }]}>🕐</Text>
                    <TextInput
                      style={[styles.dateTimeBtnTime, { padding: 0, opacity: 1 }]}
                      value={webTime}
                      onChangeText={setWebTime}
                      onBlur={handleWebTimeBlur}
                      placeholder="HH:MM"
                      placeholderTextColor={ACCENT}
                      maxLength={5}
                    />
                  </View>
                ) : (
                  <>
                    <TouchableOpacity
                      style={styles.dateTimeButton}
                      onPress={() => { setDatePickerMode('date'); setShowDateTimePicker(true); }}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.dateTimeBtnIcon}>📅</Text>
                      <View style={styles.dateTimeBtnText}>
                        <Text style={styles.dateTimeBtnDate}>
                          {editDateTime.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
                        </Text>
                        <Text style={styles.dateTimeBtnTime}>
                          🕐 {editDateTime.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </View>
                      <Text style={styles.dateTimeBtnChevron}>›</Text>
                    </TouchableOpacity>
                    {showDateTimePicker && (
                      <DateTimePicker
                        value={editDateTime}
                        mode={Platform.OS === 'ios' ? 'datetime' : datePickerMode}
                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                        maximumDate={new Date()}
                        onChange={handlePickerChange}
                        locale="fr-CA"
                      />
                    )}
                  </>
                )
              ) : (
                <View style={styles.dateTimeBlock}>
                  <View style={styles.dateTimeBlockRow}>
                    <Ionicons name="calendar-outline" size={15} color={ACCENT} />
                    <Text style={styles.dateTimeBlockDate}>{caughtDate}</Text>
                  </View>
                  <View style={styles.dateTimeBlockRow}>
                    <Ionicons name="time-outline" size={15} color={TEXT_MUTED} />
                    <Text style={styles.dateTimeBlockTime}>{caughtTime}</Text>
                  </View>
                </View>
              )}
            </View>
          </View>
        </SectionCard>

        {/* Section: Prise */}
        <SectionCard title="Détails de la prise">
          {editing ? (
            <>
              {/* Toggle Approximatif / Mesures */}
              <View style={[styles.fieldRow, { borderTopWidth: 0, paddingBottom: 4 }]}>
                {(['approx', 'measures'] as SizeMode[]).map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.sizeChip, sizeMode === m && styles.sizeChipActive]}
                    onPress={() => setSizeMode(m)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.sizeChipText, sizeMode === m && styles.sizeChipTextActive]}>
                      {m === 'approx' ? 'P / M / G' : 'Poids / Longueur'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {sizeMode === 'approx' ? (
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
                <>
                  <EditableRow label="Poids (lb)" value={weightLbs} editing onChangeText={setWeightLbs} placeholder="0.0" keyboardType="decimal-pad" />
                  <EditableRow label="Longueur (po)" value={lengthInches} editing onChangeText={setLengthInches} placeholder="0.0" keyboardType="decimal-pad" />
                </>
              )}
            </>
          ) : (
            <>
              {catch_.size_category && (
                <InfoRow label="Taille" value={SIZE_LABELS[catch_.size_category]} />
              )}
              {catch_.weight_lbs != null && (
                <InfoRow label="Poids" value={`${catch_.weight_lbs.toFixed(1)} lb`} />
              )}
              {catch_.length_inches != null && (
                <InfoRow label="Longueur" value={`${catch_.length_inches.toFixed(1)} po`} />
              )}
              {!catch_.size_category && catch_.weight_lbs == null && catch_.length_inches == null && (
                <InfoRow label="Taille" value="—" />
              )}
            </>
          )}

          {/* Thumbnails des médias */}
          {(mediaItems.length > 0 || newMedia.length > 0 || editing) && (
            <View style={styles.mediaThumbnailRow}>
              {mediaItems.map((item) => {
                const uri = item.uploaded
                  ? supabase.storage.from('catch-media').getPublicUrl(item.thumbnail_path ?? item.storage_path).data.publicUrl
                  : item.local_uri ?? undefined;
                return (
                  <View key={item.id} style={styles.mediaThumbnail}>
                    {uri ? (
                      <Image source={{ uri }} style={styles.mediaThumbnailImg} />
                    ) : null}
                    {item.media_type === 'video' && (
                      <View style={styles.videoOverlay}>
                        <Text style={styles.videoIcon}>▶</Text>
                      </View>
                    )}
                  </View>
                );
              })}
              {newMedia.map((item, idx) => (
                <View key={`new-${idx}`} style={styles.mediaThumbnail}>
                  <Image source={{ uri: item.uri }} style={styles.mediaThumbnailImg} />
                  {editing && (
                    <TouchableOpacity
                      style={styles.mediaThumbnailDelete}
                      onPress={() => setNewMedia((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <Text style={styles.mediaThumbnailDeleteText}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {editing && (
                <TouchableOpacity style={styles.mediaAddBtn} onPress={handlePickMedia} activeOpacity={0.8}>
                  <Text style={styles.mediaAddIcon}>📷</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </SectionCard>

        {/* Section: Technique */}
        <SectionCard title="🎣 Technique">
          {editing ? (
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Leurre</Text>
              <TouchableOpacity
                style={styles.lurePickerBtn}
                onPress={() => setShowLurePicker(true)}
                activeOpacity={0.8}
              >
                <Text style={lure ? styles.lurePickerBtnValue : styles.lurePickerBtnPlaceholder}>
                  {lure || 'Choisir un leurre…'}
                </Text>
                <Text style={styles.lurePickerBtnChevron}>›</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <InfoRow label="Leurre" value={catch_.lure ?? '—'} />
          )}
          <LurePicker
            visible={showLurePicker}
            selectedLureName={lure || null}
            userLures={userLures}
            onSelect={(l) => { setLure(l.name); setShowLurePicker(false); }}
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
                setLure(created.name);
              }
            }}
            onClose={() => setShowLureForm(false)}
          />
          <EditableRow
            label="Profondeur (pi)"
            value={editing ? depthMeters : catch_.depth_meters != null ? `${(catch_.depth_meters * 3.28084).toFixed(1)} pi` : '—'}
            editing={editing}
            onChangeText={setDepthMeters}
            placeholder="0.0"
            keyboardType="decimal-pad"
          />
          <InfoRow
            label="Vitesse bateau"
            value={catch_.speed_kmh != null ? `${catch_.speed_kmh.toFixed(1)} km/h` : '—'}
          />
        </SectionCard>

        {/* Section: Météo */}
        <SectionCard title="🌤 Météo">
          <InfoRow
            label="Ciel"
            value={(editing ? editConditions : catch_.weather_conditions) ?? '—'}
          />
          <InfoRow
            label="Température"
            value={
              (editing ? editTempC : catch_.temperature_c) != null
                ? `${(editing ? editTempC : catch_.temperature_c)!.toFixed(1)} °C`
                : '—'
            }
          />
          <InfoRow
            label="Vent"
            value={
              (editing ? editWindKmh : catch_.wind_speed_kmh) != null
                ? (editing ? editWindDeg : catch_.wind_direction_deg) != null
                  ? `${windDegToCompass((editing ? editWindDeg : catch_.wind_direction_deg)!)} ${(editing ? editWindKmh : catch_.wind_speed_kmh)!.toFixed(1)} km/h`
                  : `${(editing ? editWindKmh : catch_.wind_speed_kmh)!.toFixed(1)} km/h`
                : '—'
            }
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

        {!editing && !confirmDelete && !fromCache && (
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

      {/* Modal sélection GPS — mobile uniquement */}
      <Modal visible={!isWeb && showLocationPicker} animationType="slide" statusBarTranslucent>
        <View style={styles.pickerContainer}>
          <View style={[styles.pickerHeader, { paddingTop: insets.top + 12 }]}>
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

          <View style={[styles.pickerFooter, { paddingBottom: 14 + insets.bottom }]}>
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
                  refreshEditWeather(pickerCoord.latitude, pickerCoord.longitude);
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

import { colors } from '@/lib/theme';

const BG = colors.bg;
const CARD_BG = colors.surface;
const ACCENT = colors.accent;
const TEXT_PRIMARY = colors.textPrimary;
const TEXT_MUTED = colors.textMuted;
const BORDER = colors.border;

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
    paddingTop: 0,
    paddingBottom: 14,
    backgroundColor: BG,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  backBtn: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: BORDER,
  },
  backBtnText: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: '600',
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.warningSubtle,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.35)',
  },
  offlineBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.warning,
  },
  editBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.accentSubtle,
    borderWidth: 1,
    borderColor: ACCENT,
    minWidth: 95,
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
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  emojiText: {
    fontSize: 30,
  },
  speciesTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    letterSpacing: -0.4,
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
    borderRadius: 16,
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
    letterSpacing: 1,
    paddingTop: 12,
    paddingBottom: 6,
  },

  // Field rows
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    gap: 8,
  },
  fieldLabel: {
    fontSize: 14,
    color: TEXT_MUTED,
    minWidth: 110,
  },
  fieldValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  fieldValue: {
    fontSize: 14,
    color: TEXT_PRIMARY,
    flex: 1,
  },
  autoBadge: {
    fontSize: 10,
    color: ACCENT,
    backgroundColor: colors.accentSubtle,
    borderWidth: 1,
    borderColor: colors.accentGlow,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
    fontWeight: '700',
  },
  lurePickerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  lurePickerBtnValue: {
    fontSize: 14,
    color: TEXT_PRIMARY,
    flex: 1,
  },
  lurePickerBtnPlaceholder: {
    fontSize: 14,
    color: TEXT_MUTED,
    flex: 1,
  },
  lurePickerBtnChevron: {
    fontSize: 16,
    color: ACCENT,
    marginLeft: 8,
  },

  // Inline input
  inlineInput: {
    flex: 1,
    textAlign: 'left',
    fontSize: 14,
    color: TEXT_PRIMARY,
    borderBottomWidth: 1,
    borderBottomColor: ACCENT,
    paddingBottom: 2,
  },

  // Size chips
  sizeChipsRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
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
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  cancelBtnText: {
    color: TEXT_MUTED,
    fontSize: 15,
    fontWeight: '500',
  },
  deleteBtn: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  deleteBtnText: {
    color: colors.error,
    fontSize: 14,
    fontWeight: '500',
  },
  confirmDeleteCard: {
    backgroundColor: colors.errorSubtle,
    borderWidth: 1,
    borderColor: 'rgba(255,94,94,0.25)',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  confirmDeleteText: {
    color: colors.error,
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '500',
  },
  confirmDeleteRow: {
    flexDirection: 'row',
    gap: 10,
  },
  confirmDeleteCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
  },
  confirmDeleteCancelText: {
    color: TEXT_MUTED,
    fontSize: 14,
    fontWeight: '500',
  },
  confirmDeleteConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.error,
    alignItems: 'center',
  },
  confirmDeleteConfirmText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
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
    paddingTop: 0,
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
    paddingTop: 14,
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
  // Carte dans la card Lieu (hauteur fixe, évite tous les problèmes de flex web)
  cardMap: {
    height: 280,
    borderRadius: 10,
    overflow: 'hidden',
    marginTop: 8,
    marginBottom: 4,
  },
  cardMapEditBtn: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    zIndex: 501,
    backgroundColor: 'rgba(0,212,170,0.9)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  cardMapEditBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },

  // Thumbnails médias
  mediaThumbnailRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  mediaThumbnail: {
    width: 72,
    height: 72,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  mediaThumbnailImg: {
    width: '100%',
    height: '100%',
  },
  mediaThumbnailDelete: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaThumbnailDeleteText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  mediaAddBtn: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: BORDER,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaAddIcon: {
    fontSize: 26,
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoIcon: {
    color: '#fff',
    fontSize: 20,
  },

  // Section Lieu
  lieuContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },

  // Bloc date/heure — mode vue (read-only)
  dateTimeBlock: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: CARD_BG,
    borderLeftWidth: 3,
    borderLeftColor: ACCENT,
    gap: 4,
  },
  dateTimeBlockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateTimeBlockDate: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  dateTimeBlockTime: {
    fontSize: 13,
    color: TEXT_MUTED,
  },

  // Bouton date/heure — mode édition
  dateTimeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.accentSubtle,
    borderWidth: 1,
    borderColor: colors.accentGlow,
  },
  dateTimeBtnIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  dateTimeBtnText: {
    flex: 1,
  },
  dateTimeBtnDate: {
    fontSize: 13,
    fontWeight: '700',
    color: ACCENT,
  },
  dateTimeBtnTime: {
    fontSize: 12,
    color: ACCENT,
    marginTop: 2,
    opacity: 0.8,
  },
  dateTimeBtnChevron: {
    fontSize: 20,
    color: ACCENT,
    marginLeft: 6,
    fontWeight: '300',
  },
});
