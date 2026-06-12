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
import LocationPickerMap from '@/components/LocationPickerMap';
import StaticMapView from '@/components/StaticMapView';
import LureFormModal from '@/components/LureFormModal';
import LurePicker from '@/components/LurePicker';
import {
  createUserLure,
  loadLuresWithCache,
  setCachedLures,
  type UserLure,
} from '@/lib/lureStorage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';

import { useAuth } from '@/contexts/AuthContext';
import { useActiveSpecies } from '@/lib/hooks/useActiveSpecies';
import { getPositionSafe } from '@/lib/locationSafe';
import { fetchWithTimeout, isOnline } from '@/lib/net';
import { supabase } from '@/lib/supabase';
import { enqueueOfflineCatch, trySyncOfflineCatches, persistMediaForOffline } from '@/lib/offlineSync';
import { uploadMediaFile } from '@/lib/uploadMedia';
import { loadActiveTrip, saveLastCatchSettings, type Trip } from '@/lib/tripStorage';

// ─── FONCTIONNALITÉ NOM DU LAC (désactivée) ──────────────────────────────────
// Nominatim + Overpass : trop lent et peu fiable en production.
// Pour réactiver : mettre LAKE_NAME_FEATURE = true
const LAKE_NAME_FEATURE = false;
// ─────────────────────────────────────────────────────────────────────────────

type SizeMode = 'approx' | 'weight' | 'length';
type SizeCategory = 'small' | 'medium' | 'large' | 'trophy';

type MediaItem = {
  uri: string;
  type: 'photo' | 'video';
};

type CatchPayload = {
  user_id: string;
  map_id: string | null;
  trip_id: string | null;
  species: string;
  lure: string | null;
  latitude: number;
  longitude: number;
  lake_name: string | null;
  depth_meters: number | null;
  depth_source: 'manual' | 'sonar' | 'bathymetric' | null;
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
  local_id: string | null;
};

import { colors, radius, spacing } from '@/lib/theme';

const BG_COLOR = colors.bg;
const CARD_COLOR = colors.surface;
const ACCENT_COLOR = colors.accent;
const TEXT_PRIMARY = colors.textPrimary;
const TEXT_MUTED = colors.textMuted;
const BORDER_COLOR = colors.border;

function buildCatchInsertPayload(payload: CatchPayload) {
  const { local_id: _localId, ...insertPayload } = payload;
  return insertPayload;
}

const WATER_CLASSES = new Set(['water', 'waterway', 'natural']);
const WATER_TYPES = new Set(['water', 'lake', 'reservoir', 'pond', 'bay', 'river', 'stream']);

function extractLakeFromNominatim(data: any): string | null {
  // Champs d'adresse explicitement liés à l'eau — toujours fiables
  const fromAddress =
    data?.address?.water ||
    data?.address?.lake ||
    data?.address?.reservoir ||
    data?.address?.bay ||
    data?.address?.river;
  if (fromAddress) return fromAddress;

  // data.name n'est utilisé que si l'objet Nominatim est lui-même un plan d'eau
  if (
    WATER_CLASSES.has(data?.class) ||
    WATER_TYPES.has(data?.type)
  ) {
    return data?.name ?? null;
  }
  return null;
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Résout dès qu'une des promesses retourne une valeur non-null.
// Évite d'attendre le plus lent quand le plus rapide a déjà répondu.
function raceNonNull<T>(promises: Promise<T | null>[]): Promise<T | null> {
  return new Promise((resolve) => {
    let remaining = promises.length;
    if (remaining === 0) { resolve(null); return; }
    for (const p of promises) {
      p.then((val) => {
        if (val != null) resolve(val);
        else if (--remaining === 0) resolve(null);
      }).catch(() => {
        if (--remaining === 0) resolve(null);
      });
    }
  });
}

// Requête bbox petite (~5 km) : rapide et précise pour petits ET grands lacs.
async function findLakeOverpassBbox(latitude: number, longitude: number): Promise<string | null> {
  const d = 0.05; // ~5 km de chaque côté
  const bbox = `${latitude - d},${longitude - d},${latitude + d},${longitude + d}`;
  const q =
    `[out:json][timeout:10];` +
    `(way["natural"="water"]["name"](${bbox});` +
    `relation["natural"="water"]["name"](${bbox});` +
    `way["water"="lake"]["name"](${bbox});` +
    `relation["water"="lake"]["name"](${bbox}););` +
    `out tags center 10;`;

  function pickNearest(data: any): string | null {
    const elements: any[] = data?.elements ?? [];
    let best: { name: string; distM: number } | null = null;
    for (const el of elements) {
      const name: string | undefined = el?.tags?.name;
      if (!name) continue;
      const lat: number | undefined = el?.center?.lat ?? el?.lat;
      const lon: number | undefined = el?.center?.lon ?? el?.lon;
      if (lat == null || lon == null) continue;
      const latDiff = (lat - latitude) * 111_000;
      const lonDiff = (lon - longitude) * 111_000 * Math.cos(latitude * (Math.PI / 180));
      const distM = Math.sqrt(latDiff ** 2 + lonDiff ** 2);
      if (!best || distM < best.distM) best = { name, distM };
    }
    return best?.name ?? null;
  }

  // Prendre le premier endpoint qui répond avec un résultat
  return raceNonNull(
    OVERPASS_ENDPOINTS.map((endpoint) =>
      fetch(`${endpoint}?data=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data) => pickNearest(data))
        .catch(() => null),
    ),
  );
}

async function reverseGeocodeLakeName(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  const base = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`;
  const headers = { 'User-Agent': 'PecheLog/1.0' };

  try {
    // Lancer Nominatim z18 et Overpass bbox en parallèle — s'arrête dès le premier résultat
    const [data18, overpassName] = await Promise.all([
      fetch(`${base}&zoom=18`, { headers }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      findLakeOverpassBbox(latitude, longitude),
    ]);

    // Priorité 1 : point directement sur un plan d'eau (Nominatim précis)
    const nom18 = data18 ? extractLakeFromNominatim(data18) : null;
    if (nom18) return nom18;

    // Priorité 2 : plan d'eau dans les 5 km (Overpass bbox)
    if (overpassName) return overpassName;

    return null;
  } catch (error) {
    console.warn('[Geocoding] Erreur reverse geocoding', error);
    return null;
  }
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
    case 'Clear':
      return { label: 'Ensoleillé', icon: '☀️' };
    case 'Clouds':
      if (cloudiness < 25) return { label: 'Peu nuageux', icon: '🌤' };
      if (cloudiness < 75) return { label: 'Partiellement nuageux', icon: '⛅' };
      return { label: 'Nuageux', icon: '☁️' };
    case 'Rain':
    case 'Drizzle':
      return { label: 'Pluie', icon: '🌧' };
    case 'Thunderstorm':
      return { label: 'Orage', icon: '⛈' };
    case 'Snow':
      return { label: 'Neige', icon: '🌨' };
    case 'Mist':
    case 'Fog':
    case 'Haze':
      return { label: 'Brume', icon: '🌫' };
    default:
      return { label: main, icon: '🌡' };
  }
}

function windDegToCompass(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return dirs[Math.round(deg / 45) % 8];
}

async function fetchWeatherForDatetime(
  latitude: number,
  longitude: number,
  datetime: Date,
): Promise<WeatherData | null> {
  const diffMs = Date.now() - datetime.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffMs < 60 * 60 * 1000) {
    return fetchWeatherFromOpenWeather(latitude, longitude);
  }

  try {
    const dateStr = datetime.toISOString().slice(0, 10);
    const baseUrl = diffDays <= 92
      ? `https://api.open-meteo.com/v1/forecast?past_days=${Math.ceil(diffDays)}&forecast_days=1`
      : `https://archive-api.open-meteo.com/v1/archive?start_date=${dateStr}&end_date=${dateStr}`;

    const url =
      `${baseUrl}&latitude=${latitude}&longitude=${longitude}` +
      `&hourly=temperature_2m,windspeed_10m,winddirection_10m,cloudcover&timezone=auto`;

    const res = await fetchWithTimeout(url, {}, 8000);
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);

    const data = await res.json();
    const times: string[] = data.hourly?.time ?? [];
    const targetHour = datetime.getHours();
    const idx = times.findIndex(
      (t) => t.startsWith(dateStr) && new Date(t).getHours() === targetHour,
    );
    if (idx === -1) throw new Error('Heure non trouvée dans Open-Meteo');

    const tempC = data.hourly.temperature_2m?.[idx] ?? null;
    const windKmh = data.hourly.windspeed_10m?.[idx] ?? null;
    const windDeg = data.hourly.winddirection_10m?.[idx] ?? null;
    const cloudiness: number = data.hourly.cloudcover?.[idx] ?? 50;
    const weatherMain = cloudiness < 20 ? 'Clear' : cloudiness < 70 ? 'Clouds' : 'Overcast';
    const { label, icon } = getWeatherConditionFr(weatherMain, cloudiness);

    return { tempC, windKmh, windDeg, conditions: label, conditionsIcon: icon };
  } catch (e) {
    console.warn('[Weather] Open-Meteo historique échoué, fallback météo courante', e);
    return fetchWeatherFromOpenWeather(latitude, longitude);
  }
}

async function fetchWeatherFromOpenWeather(
  latitude: number,
  longitude: number,
): Promise<WeatherData | null> {
  const apiKey = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY;
  if (!apiKey) {
    console.warn('[Weather] EXPO_PUBLIC_OPENWEATHER_API_KEY manquante');
    return null;
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&units=metric&appid=${apiKey}`;
    const res = await fetchWithTimeout(url, {}, 8000);
    if (!res.ok) {
      console.warn('[Weather] Réponse non OK', res.status);
      return null;
    }

    const data = await res.json();
    const tempC = typeof data?.main?.temp === 'number' ? data.main.temp : null;
    const windMs = typeof data?.wind?.speed === 'number' ? data.wind.speed : null;
    const windKmh = windMs != null ? windMs * 3.6 : null;
    const windDeg = typeof data?.wind?.deg === 'number' ? data.wind.deg : null;

    const weatherMain: string = data?.weather?.[0]?.main ?? '';
    const cloudiness: number = typeof data?.clouds?.all === 'number' ? data.clouds.all : 50;
    const { label, icon } = weatherMain
      ? getWeatherConditionFr(weatherMain, cloudiness)
      : { label: null, icon: '🌡' };

    return { tempC, windKmh, windDeg, conditions: label, conditionsIcon: icon };
  } catch (error) {
    console.warn('[Weather] Erreur lors du fetch météo', error);
    return null;
  }
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function LogCatchScreen() {
  const router = useRouter();
  const { user, cachedUserId } = useAuth();
  const insets = useSafeAreaInsets();
  const { activeSpecies } = useActiveSpecies();
  const { prefillSpecies, prefillLure, returnTo } = useLocalSearchParams<{
    prefillSpecies?: string;
    prefillLure?: string;
    returnTo?: string;
  }>();

  const navigateAfterSave = () => {
    if (returnTo === 'trip') {
      router.replace('/(tabs)/trip');
    } else {
      router.back();
    }
  };

  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);

  // Auto-captured
  const [coords, setCoords] = useState<Location.LocationObject | null>(null);
  const [lakeName, setLakeName] = useState<string | null>(null);       // inutilisé si LAKE_NAME_FEATURE = false
  // lakeLoading : conservé pour réactivation, toujours false quand LAKE_NAME_FEATURE = false
  const lakeLoading = false;
  const [temperatureC, setTemperatureC] = useState<number | null>(null);
  const [windSpeedKmh, setWindSpeedKmh] = useState<number | null>(null);
  const [windDirectionDeg, setWindDirectionDeg] = useState<number | null>(null);
  const [weatherConditions, setWeatherConditions] = useState<string | null>(null);
  const [weatherConditionsIcon, setWeatherConditionsIcon] = useState<string>('🌡');
  const [speedKmh, setSpeedKmh] = useState<number | null>(null);
  const [speedInput, setSpeedInput] = useState('');       // valeur affichée (GPS pré-rempli, éditable)
  const [speedModified, setSpeedModified] = useState(false); // true si l'utilisateur a modifié
  const [autoLoading, setAutoLoading] = useState(true);

  // Manual fields — espèces actives depuis les réglages utilisateur
  const [selectedSpecies, setSelectedSpecies] = useState<string | null>(null);
  const [selectedLure, setSelectedLure] = useState<UserLure | null>(null);
  const [showLurePicker, setShowLurePicker] = useState(false);
  const [showLureForm, setShowLureForm] = useState(false);
  const [userLures, setUserLures] = useState<UserLure[]>([]);

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

  const [manualLocation, setManualLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [pickerCoord, setPickerCoord] = useState<{ latitude: number; longitude: number } | null>(null);

  const effectiveCoords = manualLocation ?? (coords ? { latitude: coords.coords.latitude, longitude: coords.coords.longitude } : null);
  const hasLocation = !!effectiveCoords;

  useEffect(() => {
    // Au montage, on tente de :
    // 1) Charger la localisation + vitesse
    // 2) Faire du reverse geocoding pour le lac
    // 3) Récupérer la météo
    // 4) Synchroniser les prises hors-ligne en attente
    let isMounted = true;

    const init = async () => {
      // Sync hors-ligne et voyage actif en arrière-plan : ils ne doivent
      // JAMAIS bloquer la capture GPS (le pêcheur a un poisson dans les mains).
      if (user?.id) {
        trySyncOfflineCatches(user.id).catch(() => {});
      }
      loadActiveTrip()
        .then((trip) => { if (isMounted) setActiveTrip(trip); })
        .catch(() => {});

      try {
        setAutoLoading(true);
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.warn('[Location] Permission refusée');
          return;
        }

        const loc = await getPositionSafe();
        if (!isMounted) return;
        if (!loc) {
          console.warn('[Location] Aucune position disponible');
          return;
        }

        setCoords(loc);

        const speed = typeof loc.coords.speed === 'number' ? loc.coords.speed : null;
        const computedSpeed = speed != null ? speed * 3.6 : null;
        setSpeedKmh(computedSpeed);
        // Pré-remplir le champ vitesse depuis le GPS seulement si l'utilisateur n'a pas déjà saisi
        if (computedSpeed != null) {
          setSpeedInput((prev) => (prev === '' ? computedSpeed.toFixed(1) : prev));
        }

        // Hors-ligne : on saute la météo/geocoding (la sync les complétera plus tard)
        const online = await isOnline();
        const [lake, weather] = await Promise.all([
          LAKE_NAME_FEATURE && online
            ? reverseGeocodeLakeName(loc.coords.latitude, loc.coords.longitude)
            : Promise.resolve(null),
          online
            ? fetchWeatherFromOpenWeather(loc.coords.latitude, loc.coords.longitude)
            : Promise.resolve(null),
        ]);

        if (!isMounted) return;
        if (LAKE_NAME_FEATURE) setLakeName(lake);
        if (weather) {
          setTemperatureC(weather.tempC);
          setWindSpeedKmh(weather.windKmh);
          setWindDirectionDeg(weather.windDeg);
          setWeatherConditions(weather.conditions);
          setWeatherConditionsIcon(weather.conditionsIcon);
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

  // Initialise l'espèce sélectionnée quand la liste active change
  useEffect(() => {
    if (activeSpecies.length === 0) return;
    setSelectedSpecies((prev) => {
      if (prev && activeSpecies.includes(prev)) return prev;
      return prefillSpecies && activeSpecies.includes(prefillSpecies)
        ? prefillSpecies
        : activeSpecies[0];
    });
  }, [activeSpecies, prefillSpecies]);

  useEffect(() => {
    const loadPreferences = async () => {
      if (!user?.id) return;
      try {
        const lures = await loadLuresWithCache(user.id);
        setUserLures(lures);

        if (prefillLure) {
          const lureObj = lures.find((l) => l.name === prefillLure);
          if (lureObj) setSelectedLure(lureObj);
        }
      } catch (error) {
        console.warn('[LogCatch] Erreur chargement leurres', error);
      }
    };

    loadPreferences();
  }, [user?.id]);

  // Date et heure de la prise
  const [catchDateTime, setCatchDateTime] = useState<Date>(() => new Date());
  const [showDateTimePicker, setShowDateTimePicker] = useState(false);
  const [datePickerMode, setDatePickerMode] = useState<'date' | 'time'>('date');
  // Web : états string intermédiaires pour les TextInput
  const [webDate, setWebDate] = useState(() => fmtDate(new Date()));
  const [webTime, setWebTime] = useState(() => fmtTime(new Date()));

  // "Site prometteur" : aucun poisson — masque météo, leurre, grosseur, photos
  const isSitePrometteur = selectedSpecies === 'Site prometteur';


  const handleOpenLocationPicker = () => {
    const initial = effectiveCoords;
    if (!initial) return;
    setPickerCoord({ latitude: initial.latitude, longitude: initial.longitude });
    setShowLocationPicker(true);
  };

  const handleConfirmLocation = async () => {
    if (!pickerCoord) return;
    setShowLocationPicker(false);
    setManualLocation(pickerCoord);
    const [lake, weather] = await Promise.all([
      LAKE_NAME_FEATURE
        ? reverseGeocodeLakeName(pickerCoord.latitude, pickerCoord.longitude)
        : Promise.resolve(null),
      fetchWeatherForDatetime(pickerCoord.latitude, pickerCoord.longitude, catchDateTime),
    ]);
    if (LAKE_NAME_FEATURE) setLakeName(lake);
    if (weather) {
      setTemperatureC(weather.tempC);
      setWindSpeedKmh(weather.windKmh);
      setWindDirectionDeg(weather.windDeg);
      setWeatherConditions(weather.conditions);
      setWeatherConditionsIcon(weather.conditionsIcon);
    }
  };

  const handleResetLocation = () => {
    setManualLocation(null);
    if (coords) {
      setPickerCoord({ latitude: coords.coords.latitude, longitude: coords.coords.longitude });
    }
  };

  const handleWebDateBlur = () => {
    const parts = webDate.trim().split('-').map(Number);
    if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
      const [y, m, d] = parts;
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        const dt = new Date(catchDateTime);
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
        const dt = new Date(catchDateTime);
        dt.setHours(h, min, 0, 0);
        handleDateTimeCommit(dt);
      }
    }
  };

  const handleDateTimeCommit = async (dt: Date) => {
    setCatchDateTime(dt);
    setWebDate(fmtDate(dt));
    setWebTime(fmtTime(dt));
    if (!effectiveCoords) return;
    const weather = await fetchWeatherForDatetime(effectiveCoords.latitude, effectiveCoords.longitude, dt);
    if (weather) {
      setTemperatureC(weather.tempC);
      setWindSpeedKmh(weather.windKmh);
      setWindDirectionDeg(weather.windDeg);
      setWeatherConditions(weather.conditions);
      setWeatherConditionsIcon(weather.conditionsIcon);
    }
  };

  const handlePickerChange = (_: any, selected?: Date) => {
    if (Platform.OS === 'android') {
      setShowDateTimePicker(false);
      if (!selected) return;
      if (datePickerMode === 'date') {
        const merged = new Date(selected);
        merged.setHours(catchDateTime.getHours(), catchDateTime.getMinutes(), 0, 0);
        setCatchDateTime(merged);
        setDatePickerMode('time');
        setShowDateTimePicker(true);
      } else {
        const merged = new Date(catchDateTime);
        merged.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
        handleDateTimeCommit(merged);
        setDatePickerMode('date');
      }
    } else {
      if (selected) handleDateTimeCommit(selected);
    }
  };

  const handlePickMedia = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert('Permissions', "Impossible d'accéder à ta galerie sans la permission de lecture.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        quality: 0.8,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const asset = result.assets[0];
      if (!asset.uri) return;

      const type: 'photo' | 'video' = asset.type === 'video' ? 'video' : 'photo';
      setMedia((prev) => [...prev, { uri: asset.uri, type }]);
    } catch (error) {
      console.warn('[Media] Erreur lors de la sélection', error);
    }
  };

  const handleSave = async () => {
    // Hors-ligne sans session active : cachedUserId permet de mettre la prise
    // en file d'attente — elle sera envoyée quand la session sera restaurée.
    const effectiveUserId = user?.id ?? cachedUserId;
    if (!effectiveUserId) {
      Alert.alert('Erreur', 'Tu dois être connecté pour enregistrer une prise.');
      return;
    }

    if (!selectedSpecies) {
      Alert.alert('Espèce', 'Sélectionne une espèce.');
      return;
    }

    if (!effectiveCoords) {
      Alert.alert(
        'Localisation',
        "Impossible de récupérer ta position. Vérifie que le GPS est activé et réessaie.",
      );
      return;
    }

    const depthFeet =
      depthMeters.trim().length > 0 ? Number.parseFloat(depthMeters.replace(',', '.')) : null;
    const depthValue = depthFeet != null ? depthFeet * 0.3048 : null; // converti pieds → mètres
    const weightValue =
      weightLbs.trim().length > 0 ? Number.parseFloat(weightLbs.replace(',', '.')) : null;
    const lengthValue =
      lengthInches.trim().length > 0 ? Number.parseFloat(lengthInches.replace(',', '.')) : null;

    const sizeCategoryValue: SizeCategory | null =
      sizeMode === 'approx' ? sizeCategory : null;

    const payload: CatchPayload = {
      user_id: effectiveUserId,
      map_id: null, // TODO: brancher sur la carte sélectionnée (personnelle / partagée)
      trip_id: activeTrip?.id ?? null,
      species: selectedSpecies,
      lure: isSitePrometteur ? null : (selectedLure?.name ?? null),
      latitude: effectiveCoords.latitude,
      longitude: effectiveCoords.longitude,
      lake_name: LAKE_NAME_FEATURE ? lakeName : null,
      depth_meters: depthValue,
      depth_source: depthValue != null ? 'manual' : sonarDepthMeters != null ? 'sonar' : null,
      temperature_c: isSitePrometteur ? null : temperatureC,
      wind_speed_kmh: isSitePrometteur ? null : windSpeedKmh,
      wind_direction_deg: isSitePrometteur ? null : windDirectionDeg,
      speed_kmh: speedInput.trim() ? Number.parseFloat(speedInput.replace(',', '.')) : speedKmh,
      weather_conditions: isSitePrometteur ? null : weatherConditions,
      size_category: isSitePrometteur ? null : sizeCategoryValue,
      weight_lbs: isSitePrometteur ? null : (sizeMode === 'weight' ? weightValue : null),
      length_inches: isSitePrometteur ? null : (sizeMode === 'length' ? lengthValue : null),
      notes: notes.trim().length > 0 ? notes.trim() : null,
      caught_at: catchDateTime.toISOString(),
      local_id: `local_${Date.now()}`,
    };

    setSaving(true);
    try {
      // Hors-ligne (ou session absente) → file d'attente directement, sans
      // attendre un échec réseau qui peut prendre des minutes sur Android.
      const online = await isOnline();
      if (!online || !user?.id) {
        const persistedMedia = await persistMediaForOffline(media);
        await enqueueOfflineCatch({ payload, media: persistedMedia });
        await saveLastCatchSettings({ species: payload.species, lure: selectedLure?.name ?? undefined, sizeCategory: sizeCategoryValue ?? undefined });
        Alert.alert(
          'Mode hors-ligne',
          'Prise enregistrée localement. Elle sera synchronisée au retour du signal.',
        );
        navigateAfterSave();
        return;
      }

      // En ligne : insert avec annulation réelle après 20 s (signal faible →
      // la requête est abandonnée et la prise bascule en file hors-ligne).
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      let insertedCatch: { id: string } | null = null;
      let error: unknown = null;
      try {
        const res = await supabase
          .from('catches')
          .insert(buildCatchInsertPayload(payload))
          .select('id')
          .abortSignal(controller.signal)
          .single();
        insertedCatch = res.data;
        error = res.error;
      } catch (e) {
        error = e;
      } finally {
        clearTimeout(timer);
      }

      if (error) {
        console.warn(`[LogCatch] Erreur lors de l'enregistrement en ligne, on bascule hors-ligne`, error);
        const persistedMedia = await persistMediaForOffline(media);
        await enqueueOfflineCatch({ payload, media: persistedMedia });
        await saveLastCatchSettings({ species: payload.species, lure: selectedLure?.name ?? undefined, sizeCategory: sizeCategoryValue ?? undefined });
        Alert.alert(
          'Mode hors-ligne',
          'Prise enregistrée localement. Elle sera synchronisée au retour du signal.',
        );
        navigateAfterSave();
        return;
      }

      // Upload des médias vers Supabase Storage
      if (insertedCatch && media.length > 0) {
        for (const item of media) {
          try {
            const { storagePath } = await uploadMediaFile(item.uri, effectiveUserId, insertedCatch.id, item.type);
            await supabase.from('catch_media').insert({
              catch_id: insertedCatch.id,
              media_type: item.type,
              storage_path: storagePath,
              uploaded: true,
            });
          } catch (mediaErr) {
            console.warn('[LogCatch] Erreur upload media', mediaErr);
          }
        }
      }

      await saveLastCatchSettings({ species: payload.species, lure: selectedLure?.name ?? undefined, sizeCategory: sizeCategoryValue ?? undefined });
      Alert.alert('Prise enregistrée', 'Ta prise a été enregistrée avec succès.');
      navigateAfterSave();
    } catch (error) {
      console.warn('[LogCatch] Erreur inattendue, stockage hors-ligne', error);
      const persistedMedia = await persistMediaForOffline(media);
      await enqueueOfflineCatch({ payload, media: persistedMedia });
      await saveLastCatchSettings({ species: payload.species, lure: selectedLure?.name ?? undefined, sizeCategory: sizeCategoryValue ?? undefined });
      Alert.alert(
        'Mode hors-ligne',
        'Prise enregistrée localement. Elle sera synchronisées au retour du signal.',
      );
      navigateAfterSave();
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <AutoFieldText style={styles.headerTitle}>Nouvelle prise</AutoFieldText>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Section Emplacement */}
        <View style={styles.section}>
          <SectionTitle>📍 Emplacement</SectionTitle>

          {autoLoading && !hasLocation && (
            <View style={styles.autoLoadingRow}>
              <ActivityIndicator size="small" color={ACCENT_COLOR} />
              <AutoFieldText style={styles.autoLoadingText}>Récupération de ta position…</AutoFieldText>
            </View>
          )}

          <View style={styles.emplacementRow}>
            {/* Colonne gauche : badges GPS + date/heure éditables */}
            <View style={styles.emplacementLeft}>
              {LAKE_NAME_FEATURE && (
                <Text style={styles.lakeNameTitle}>
                  {lakeLoading || autoLoading ? '🏔  Récupération du lac…' : lakeName ?? '🏔  Lac inconnu'}
                </Text>
              )}

              <AutoFieldBadge
                icon="📍"
                value={hasLocation ? `${effectiveCoords!.latitude.toFixed(4)}, ${effectiveCoords!.longitude.toFixed(4)}` : 'GPS…'}
                onPress={hasLocation ? handleOpenLocationPicker : undefined}
                modified={!!manualLocation}
              />

              {/* Date et heure */}
              {Platform.OS === 'web' ? (
                <View style={styles.dateTimeButton}>
                  <Text style={styles.dateTimeBtnIcon}>📅</Text>
                  <TextInput
                    style={[styles.dateTimeBtnDate, { flex: 1, padding: 0 }]}
                    value={webDate}
                    onChangeText={setWebDate}
                    onBlur={handleWebDateBlur}
                    placeholder="AAAA-MM-JJ"
                    placeholderTextColor={ACCENT_COLOR}
                    maxLength={10}
                  />
                  <Text style={[styles.dateTimeBtnTime, { marginHorizontal: 8, opacity: 1 }]}>🕐</Text>
                  <TextInput
                    style={[styles.dateTimeBtnTime, { padding: 0, opacity: 1 }]}
                    value={webTime}
                    onChangeText={setWebTime}
                    onBlur={handleWebTimeBlur}
                    placeholder="HH:MM"
                    placeholderTextColor={ACCENT_COLOR}
                    maxLength={5}
                  />
                </View>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.dateTimeButton}
                    onPress={() => {
                      setDatePickerMode('date');
                      setShowDateTimePicker(true);
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.dateTimeBtnIcon}>📅</Text>
                    <View style={styles.dateTimeBtnText}>
                      <Text style={styles.dateTimeBtnDate}>
                        {catchDateTime.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
                      </Text>
                      <Text style={styles.dateTimeBtnTime}>
                        🕐 {catchDateTime.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                    <Text style={styles.dateTimeBtnChevron}>›</Text>
                  </TouchableOpacity>
                  {showDateTimePicker && (
                    <DateTimePicker
                      value={catchDateTime}
                      mode={Platform.OS === 'ios' ? 'datetime' : datePickerMode}
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      maximumDate={new Date()}
                      onChange={handlePickerChange}
                      locale="fr-CA"
                    />
                  )}
                </>
              )}

              {/* Vitesse — pré-remplie par GPS, éditable manuellement */}
              <View style={[
                styles.autoField,
                speedModified ? styles.autoFieldModified : styles.autoFieldAuto,
                { marginTop: 8 },
              ]}>
                <Text style={styles.badgeIconText}>🚤</Text>
                <TextInput
                  style={styles.badgeTextInput}
                  value={speedInput}
                  onChangeText={(v) => { setSpeedInput(v); setSpeedModified(true); }}
                  placeholder={autoLoading ? 'GPS…' : '—'}
                  placeholderTextColor={TEXT_MUTED}
                  keyboardType="decimal-pad"
                />
                <Text style={[styles.badgeIconText, { marginLeft: 2, marginRight: 0 }]}>km/h</Text>
              </View>
            </View>

            {/* Colonne droite : miniature de la carte */}
            {hasLocation && (
              <View style={styles.emplacementRight}>
                <StaticMapView
                  key={`${effectiveCoords!.latitude.toFixed(5)},${effectiveCoords!.longitude.toFixed(5)}`}
                  coordinate={effectiveCoords!}
                  height={225}
                  onPress={handleOpenLocationPicker}
                />
              </View>
            )}
          </View>
        </View>

        {/* Section Météo — masquée pour "Site prometteur" */}
        {!isSitePrometteur && (
          <View style={styles.section}>
            <SectionTitle>🌤 Météo</SectionTitle>
            <View style={styles.autoFieldsRow}>
              <AutoFieldBadge
                icon={weatherConditionsIcon}
                value={weatherConditions ?? (autoLoading ? 'Météo…' : '—')}
              />
              <AutoFieldBadge
                icon="🌡"
                value={temperatureC != null ? `${temperatureC.toFixed(1)} °C` : (autoLoading ? 'Météo…' : '—')}
              />
              <AutoFieldBadge
                icon="💨"
                value={
                  windSpeedKmh != null
                    ? windDirectionDeg != null
                      ? `${windDegToCompass(windDirectionDeg)} ${windSpeedKmh.toFixed(0)} km/h`
                      : `${windSpeedKmh.toFixed(0)} km/h`
                    : autoLoading ? 'Météo…' : '—'
                }
              />
            </View>
          </View>
        )}

        {/* Species */}
        <View style={styles.section}>
          <SectionTitle>🐟 Espèce</SectionTitle>
          <View style={styles.chipRow}>
            {activeSpecies.map((s) => (
              <Chip
                key={s}
                label={s}
                selected={selectedSpecies === s}
                onPress={() => setSelectedSpecies(s)}
              />
            ))}
          </View>
        </View>

        {/* Leurre — masqué pour "Site prometteur" */}
        {!isSitePrometteur && (
          <View style={styles.section}>
            <SectionTitle>🪝 Leurre</SectionTitle>
            <TouchableOpacity
              style={styles.lureButton}
              onPress={() => setShowLurePicker(true)}
              activeOpacity={0.8}
            >
              {selectedLure ? (
                <>
                  <Text style={styles.lureButtonEmoji}>🪝</Text>
                  <View style={styles.lureButtonInfo}>
                    <AutoFieldText style={styles.lureButtonName}>{selectedLure.name}</AutoFieldText>
                    {(selectedLure.size || selectedLure.color) ? (
                      <AutoFieldText style={styles.lureButtonBrand}>
                        {[selectedLure.size, selectedLure.color].filter(Boolean).join(' · ')}
                      </AutoFieldText>
                    ) : null}
                  </View>
                  <AutoFieldText style={styles.lureButtonChange}>Changer ›</AutoFieldText>
                </>
              ) : (
                <>
                  <Text style={styles.lureButtonEmoji}>🪝</Text>
                  <AutoFieldText style={styles.lureButtonPlaceholder}>
                    Choisir un leurre…
                  </AutoFieldText>
                  <AutoFieldText style={styles.lureButtonChange}>›</AutoFieldText>
                </>
              )}
            </TouchableOpacity>
            <LurePicker
              visible={showLurePicker}
              selectedLureName={selectedLure?.name ?? null}
              userLures={userLures}
              onSelect={(lure) => { setSelectedLure(lure); setShowLurePicker(false); }}
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
                  setSelectedLure(created);
                }
              }}
              onClose={() => setShowLureForm(false)}
            />
          </View>
        )}

        {/* Depth */}
        <View style={styles.section}>
          <SectionTitle>📏 Profondeur</SectionTitle>

          {sonarDepthMeters != null && (
            <View style={styles.autoFieldsRow}>
              <View style={styles.autoField}>
                <AutoFieldText style={styles.autoFieldIcon}>📡</AutoFieldText>
                <AutoFieldText style={styles.autoFieldLabel}>Sonar:</AutoFieldText>
                <AutoFieldText style={styles.autoFieldValue}>
                  {(sonarDepthMeters * 3.28084).toFixed(1)} pi
                </AutoFieldText>
              </View>
            </View>
          )}

          <View style={[styles.inputGroup, { maxWidth: 260 }]}>
            <TextInput
              style={styles.input}
              placeholder="Profondeur en pieds (ex: 18)"
              placeholderTextColor={TEXT_MUTED}
              keyboardType="decimal-pad"
              value={depthMeters}
              onChangeText={setDepthMeters}
            />
          </View>
        </View>

        {/* Grosseur — masquée pour "Site prometteur" */}
        {!isSitePrometteur && <View style={styles.section}>
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
        </View>}

        {/* Photos / Vidéos — masquées pour "Site prometteur" */}
        {!isSitePrometteur && (
          <View style={styles.section}>
            <SectionTitle>📸 Photos / Vidéos</SectionTitle>
            <TouchableOpacity style={styles.mediaButton} onPress={handlePickMedia} activeOpacity={0.85}>
              <Text style={{ fontSize: 22 }}>📸</Text>
              <Text style={styles.mediaButtonText}>Ajouter photos / vidéos</Text>
            </TouchableOpacity>
            {media.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
                {media.map((item, idx) => (
                  <View key={idx} style={styles.mediaThumbnailContainer}>
                    <Image source={{ uri: item.uri }} style={styles.mediaThumbnailPreview} />
                    {item.type === 'video' && (
                      <View style={styles.mediaThumbnailVideoOverlay}>
                        <Text style={{ color: '#fff', fontSize: 14 }}>▶</Text>
                      </View>
                    )}
                    <TouchableOpacity
                      style={styles.mediaThumbnailRemove}
                      onPress={() => setMedia((prev) => prev.filter((_, i) => i !== idx))}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* Assignation de carte — désactivée, à réactiver plus tard */}
        {false && (
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
        )}

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
        style={[styles.saveButton, { bottom: insets.bottom + 16 }, saving && styles.saveButtonDisabled]}
        activeOpacity={0.9}
        onPress={saving ? undefined : handleSave}
      >
        {saving ? (
          <ActivityIndicator color="#0B1A2B" />
        ) : (
          <AutoFieldText style={styles.saveButtonText}>✓ Enregistrer la prise</AutoFieldText>
        )}
      </TouchableOpacity>

      <Modal visible={showLocationPicker} animationType="slide" statusBarTranslucent>
        <View style={styles.pickerContainer}>
          <View style={[styles.pickerHeader, { paddingTop: insets.top + 12 }]}>
            <TouchableOpacity onPress={() => setShowLocationPicker(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.pickerCancel}>Annuler</Text>
            </TouchableOpacity>
            <Text style={styles.pickerTitle}>Modifier l'emplacement</Text>
            <TouchableOpacity onPress={handleConfirmLocation} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.pickerConfirm}>Confirmer</Text>
            </TouchableOpacity>
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
            {manualLocation && (
              <TouchableOpacity
                onPress={() => {
                  handleResetLocation();
                  setShowLocationPicker(false);
                }}
                style={styles.pickerResetBtn}
              >
                <Text style={styles.pickerResetText}>Réinitialiser au GPS</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
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


type AutoFieldTextProps = {
  children: React.ReactNode;
  style?: object;
};

function AutoFieldText({ children, style }: AutoFieldTextProps) {
  return <ActivityIndicatorText style={style}>{children}</ActivityIndicatorText>;
}

// Petit wrapper pour avoir un composant texte unique si l'app utilise un composant Thème plus tard.
function ActivityIndicatorText({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object;
}) {
  // On utilise simplement TextInput pour garder le Text natif sans importer de Themed.Text ici.
  // Cela permet d'éviter les conflits de thème tout en restant simple.
  // eslint-disable-next-line react-native/no-inline-styles
  return (
    <TextInput style={[{ color: TEXT_PRIMARY }, style]} editable={false} value={String(children)} />
  );
}

type AutoFieldBadgeProps = {
  icon: string;
  value: string;
  onPress?: () => void;
  modified?: boolean;
};

function AutoFieldBadge({ icon, value, onPress, modified }: AutoFieldBadgeProps) {
  const inner = (
    <View style={[styles.autoField, styles.autoFieldAuto, modified && styles.autoFieldModified]}>
      <AutoFieldText style={styles.autoFieldIcon}>{icon}</AutoFieldText>
      <AutoFieldText style={styles.autoFieldValue}>{value}</AutoFieldText>
      {onPress && <Text style={styles.autoFieldEditIcon}>✏️</Text>}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.75}>
        {inner}
      </TouchableOpacity>
    );
  }
  return inner;
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
    paddingTop: 0,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER_COLOR,
    backgroundColor: BG_COLOR,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
  },
  backButtonText: {
    fontSize: 17,
    color: TEXT_PRIMARY,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    letterSpacing: -0.2,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 20,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  sectionTitleText: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: ACCENT_COLOR,
    marginBottom: 12,
    fontWeight: '700',
  },
  autoFieldsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  autoField: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: CARD_COLOR,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
  },
  autoFieldAuto: {
    borderColor: colors.accentGlow,
    backgroundColor: colors.accentSubtle,
  },
  autoFieldIcon: {
    fontSize: 13,
    marginRight: 5,
    width: 22,
    flexShrink: 0,
  },
  autoFieldLabel: {
    fontSize: 11,
    color: TEXT_MUTED,
    marginRight: 4,
  },
  autoFieldValue: {
    fontSize: 12,
    fontWeight: '600',
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
  lakeNameTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    marginBottom: 12,
    letterSpacing: -0.3,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // ── Emplacement 2 colonnes ───────────────────────────────────────────────────
  emplacementRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  emplacementLeft: {
    flex: 1,
    maxWidth: 310,
  },
  emplacementRight: {
    width: 225,
    maxWidth: 225,
    borderRadius: 14,
    overflow: 'hidden',
  },
  badgeIconText: {
    fontSize: 13,
    marginRight: 5,
  },
  badgeTextInput: {
    fontSize: 12,
    fontWeight: '600',
    color: ACCENT_COLOR,
    flex: 1,
    padding: 0,
  },
  // ── Bouton média unique ──────────────────────────────────────────────────────
  mediaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    borderStyle: 'dashed',
    backgroundColor: CARD_COLOR,
    maxWidth: 360,
    alignSelf: 'flex-start',
  },
  mediaButtonText: {
    fontSize: 14,
    color: TEXT_MUTED,
    fontWeight: '500',
  },
  mediaThumbnailContainer: {
    width: 72,
    height: 72,
    marginRight: 8,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  mediaThumbnailPreview: {
    width: 72,
    height: 72,
  },
  mediaThumbnailVideoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  mediaThumbnailRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Chips ────────────────────────────────────────────────────────────────────
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    backgroundColor: CARD_COLOR,
    maxWidth: 180,
  },
  chipSelected: {
    borderColor: ACCENT_COLOR,
    backgroundColor: colors.accentSubtle,
  },
  chipText: {
    fontSize: 13,
    color: TEXT_MUTED,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: ACCENT_COLOR,
    fontWeight: '700',
  },
  inputGroup: {
    marginBottom: 14,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    backgroundColor: CARD_COLOR,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10,
    fontSize: 15,
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
    maxWidth: 160,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    backgroundColor: CARD_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeToggleButtonActive: {
    borderColor: ACCENT_COLOR,
    backgroundColor: colors.accentSubtle,
  },
  sizeToggleButtonText: {
    fontSize: 12,
    color: TEXT_MUTED,
    fontWeight: '500',
  },
  sizeToggleButtonTextActive: {
    color: ACCENT_COLOR,
    fontWeight: '700',
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
    paddingVertical: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    borderStyle: 'dashed',
    backgroundColor: CARD_COLOR,
  },
  photoSlotIcon: {
    fontSize: 22,
    marginBottom: 6,
  },
  photoSlotText: {
    fontSize: 12,
    color: TEXT_MUTED,
    fontWeight: '500',
  },
  mapSelector: {
    gap: 10,
  },
  mapOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
    backgroundColor: CARD_COLOR,
  },
  mapOptionSelected: {
    borderColor: ACCENT_COLOR,
    backgroundColor: colors.accentSubtle,
  },
  mapRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: TEXT_MUTED,
    marginRight: 12,
  },
  mapRadioSelected: {
    borderColor: ACCENT_COLOR,
    backgroundColor: colors.accentStrong,
  },
  mapInfo: {
    flex: 1,
  },
  mapTitle: {
    fontSize: 14,
    fontWeight: '600',
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
    bottom: 0,
    paddingVertical: 16,
    borderRadius: 999,
    backgroundColor: ACCENT_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 8,
  },
  saveButtonDisabled: {
    opacity: 0.65,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.bg,
  },

  dateTimeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
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
    color: ACCENT_COLOR,
  },
  dateTimeBtnTime: {
    fontSize: 12,
    color: ACCENT_COLOR,
    marginTop: 2,
    opacity: 0.8,
  },
  dateTimeBtnChevron: {
    fontSize: 20,
    color: ACCENT_COLOR,
    marginLeft: 6,
    fontWeight: '300',
  },

  // Auto-field badge: modified state
  autoFieldModified: {
    borderColor: colors.warning,
    backgroundColor: colors.warningSubtle,
  },
  autoFieldEditIcon: {
    fontSize: 10,
    marginLeft: 4,
  },

  // Location picker modal
  pickerContainer: {
    flex: 1,
    backgroundColor: BG_COLOR,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 0,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER_COLOR,
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  pickerCancel: {
    fontSize: 15,
    color: TEXT_MUTED,
  },
  pickerConfirm: {
    fontSize: 15,
    fontWeight: '600',
    color: ACCENT_COLOR,
  },
  pickerHint: {
    textAlign: 'center',
    fontSize: 12,
    color: TEXT_MUTED,
    paddingVertical: 8,
  },
  pickerMap: { flex: 1 },
  pickerFooter: {
    paddingHorizontal: 18,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER_COLOR,
    gap: 10,
  },
  pickerCoordsText: {
    fontSize: 13,
    color: TEXT_MUTED,
    textAlign: 'center',
  },
  pickerResetBtn: {
    alignSelf: 'center',
    paddingVertical: 7,
    paddingHorizontal: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warningSubtle,
  },
  pickerResetText: {
    fontSize: 13,
    color: colors.warning,
    fontWeight: '500',
  },

  // ── Bouton de sélection de leurre ─────────────────────────────────────────
  lureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    minHeight: 52,
  },
  lureButtonEmoji: {
    fontSize: 26,
    marginRight: spacing.md,
  },
  lureButtonInfo: {
    flex: 1,
  },
  lureButtonName: {
    fontSize: 15,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  lureButtonBrand: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  lureButtonPlaceholder: {
    flex: 1,
    fontSize: 15,
    color: colors.textMuted,
  },
  lureButtonChange: {
    fontSize: 14,
    color: colors.accent,
    fontWeight: '600',
    marginLeft: spacing.sm,
  },
});

