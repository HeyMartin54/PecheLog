import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import LocationPickerMap from '@/components/LocationPickerMap';
import StaticMapView from '@/components/StaticMapView';
import LurePicker from '@/components/LurePicker';
import { getLureByName } from '@/lib/lures';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

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

type OfflineQueuedCatch = {
  payload: CatchPayload;
  media: MediaItem[];
};

const OFFLINE_QUEUE_KEY = 'offline_catches_queue_v1';

import { colors, radius, spacing } from '@/lib/theme';

const BG_COLOR = colors.bg;
const CARD_COLOR = colors.surface;
const ACCENT_COLOR = colors.accent;
const TEXT_PRIMARY = colors.textPrimary;
const TEXT_MUTED = colors.textMuted;
const BORDER_COLOR = colors.border;

async function enqueueOfflineCatch(item: OfflineQueuedCatch) {
  try {
    const existing = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    const parsed: OfflineQueuedCatch[] = existing ? JSON.parse(existing) : [];
    parsed.push(item);
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(parsed));
  } catch (error) {
    console.warn(`[Offline] Impossible d'enregistrer la prise hors-ligne`, error);
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

    // On tente de pousser chaque entrée; en cas d'erreur réseau, on garde dans la file.
    // Note : pour l'instant on ne gère pas encore l'upload des médias vers Supabase Storage.
    for (const item of queue) {
      try {
        if (item.payload.user_id !== userId) {
          remaining.push(item);
          continue;
        }

        let payload = item.payload;

        // Si les données météo manquent (capture hors-ligne), tenter de les récupérer maintenant
        const weatherMissing =
          payload.weather_conditions == null &&
          payload.wind_speed_kmh == null &&
          payload.temperature_c == null;

        if (weatherMissing) {
          const weather = await fetchWeatherAtTime(payload.latitude, payload.longitude, payload.caught_at);
          if (weather) {
            payload = {
              ...payload,
              temperature_c: weather.tempC,
              wind_speed_kmh: weather.windKmh,
              wind_direction_deg: weather.windDeg,
              weather_conditions: weather.conditions,
            };
          }
        }

        const { error } = await supabase
          .from('catches')
          .insert(buildCatchInsertPayload(payload));
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

function wmoCodeToCondition(code: number): { label: string; icon: string } {
  if (code === 0) return { label: 'Ensoleillé', icon: '☀️' };
  if (code === 1) return { label: 'Peu nuageux', icon: '🌤' };
  if (code === 2) return { label: 'Partiellement nuageux', icon: '⛅' };
  if (code === 3) return { label: 'Nuageux', icon: '☁️' };
  if (code === 45 || code === 48) return { label: 'Brume', icon: '🌫' };
  if (code >= 51 && code <= 55) return { label: 'Bruine', icon: '🌦' };
  if (code >= 61 && code <= 65) return { label: 'Pluie', icon: '🌧' };
  if (code >= 71 && code <= 75) return { label: 'Neige', icon: '🌨' };
  if (code >= 80 && code <= 82) return { label: 'Averses', icon: '🌧' };
  if (code >= 95) return { label: 'Orage', icon: '⛈' };
  return { label: '—', icon: '🌡' };
}

// Récupère la météo historique pour une date/heure précise via Open-Meteo (gratuit, sans clé API).
// Utilise l'API forecast avec past_days pour les 16 derniers jours, l'archive au-delà.
async function fetchWeatherAtTime(
  latitude: number,
  longitude: number,
  isoDateTime: string,
): Promise<WeatherData | null> {
  try {
    const catchDate = new Date(isoDateTime);
    const dateStr = catchDate.toISOString().split('T')[0];
    const daysDiff = Math.floor((Date.now() - catchDate.getTime()) / (1000 * 60 * 60 * 24));

    const params = 'hourly=temperature_2m,windspeed_10m,winddirection_10m,weathercode&windspeed_unit=kmh&timezone=auto';
    const coords = `latitude=${latitude}&longitude=${longitude}`;

    const url =
      daysDiff <= 16
        ? `https://api.open-meteo.com/v1/forecast?${coords}&past_days=${Math.min(daysDiff + 1, 16)}&forecast_days=1&${params}`
        : `https://archive-api.open-meteo.com/v1/archive?${coords}&start_date=${dateStr}&end_date=${dateStr}&${params}`;

    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const times: string[] = data?.hourly?.time ?? [];
    if (times.length === 0) return null;

    // Trouver l'heure la plus proche de la prise
    const catchTs = catchDate.getTime();
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const diff = Math.abs(new Date(times[i]).getTime() - catchTs);
      if (diff < minDiff) { minDiff = diff; closestIdx = i; }
    }

    const tempC: number | null = data?.hourly?.temperature_2m?.[closestIdx] ?? null;
    const windKmh: number | null = data?.hourly?.windspeed_10m?.[closestIdx] ?? null;
    const windDeg: number | null = data?.hourly?.winddirection_10m?.[closestIdx] ?? null;
    const wmoCode: number = data?.hourly?.weathercode?.[closestIdx] ?? -1;
    const { label, icon } = wmoCodeToCondition(wmoCode);

    return { tempC, windKmh, windDeg, conditions: label, conditionsIcon: icon };
  } catch (error) {
    console.warn('[Weather] Erreur fetch historique Open-Meteo', error);
    return null;
  }
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
    const res = await fetch(url);
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

export default function LogCatchScreen() {
  const router = useRouter();
  const { user } = useAuth();

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

  // Manual fields
  const [speciesOptions, setSpeciesOptions] = useState<string[]>([
    'Doré jaune',
    'Brochet',
    'Truite mouchetée',
    'Touladi',
    'Site prometteur',
  ]);
  const [selectedSpecies, setSelectedSpecies] = useState<string | null>('Doré jaune');
  const [selectedLure, setSelectedLure] = useState<string | null>(null);
  const [showLurePicker, setShowLurePicker] = useState(false);
  const [customLures, setCustomLures] = useState<string[]>([]);

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
      if (!user?.id) return;
      await trySyncOfflineCatches(user.id);

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
        const computedSpeed = speed != null ? speed * 3.6 : null;
        setSpeedKmh(computedSpeed);
        // Pré-remplir le champ vitesse depuis le GPS seulement si l'utilisateur n'a pas déjà saisi
        if (computedSpeed != null) {
          setSpeedInput((prev) => (prev === '' ? computedSpeed.toFixed(1) : prev));
        }

        const [lake, weather] = await Promise.all([
          LAKE_NAME_FEATURE
            ? reverseGeocodeLakeName(loc.coords.latitude, loc.coords.longitude)
            : Promise.resolve(null),
          fetchWeatherFromOpenWeather(loc.coords.latitude, loc.coords.longitude),
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

  useEffect(() => {
    // Charger les préférences de l'utilisateur pour peupler espèces / leurres
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
            setCustomLures(arr);
          }
        }
      } catch (error) {
        console.warn('[LogCatch] Erreur inattendue chargement préférences', error);
      }
    };

    loadPreferences();
  }, [user?.id]);

  // Date et heure de la prise (éditables)
  const [catchDate, setCatchDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [catchTime, setCatchTime] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });

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
      fetchWeatherFromOpenWeather(pickerCoord.latitude, pickerCoord.longitude),
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
    const effectiveUserId = user?.id;
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
      species: selectedSpecies,
      lure: isSitePrometteur ? null : selectedLure,
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
      caught_at: (() => {
        try { return new Date(`${catchDate}T${catchTime}:00`).toISOString(); }
        catch { return new Date().toISOString(); }
      })(),
      local_id: `local_${Date.now()}`,
    };

    setSaving(true);
    try {
      const { error } = await supabase
        .from('catches')
        .insert(buildCatchInsertPayload(payload));

      if (error) {
        console.warn(`[LogCatch] Erreur lors de l'enregistrement en ligne, on bascule hors-ligne`, error);
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
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <AutoFieldText style={styles.headerTitle}>Nouvelle prise</AutoFieldText>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
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

              {/* Date éditable */}
              <View style={[styles.autoField, styles.autoFieldAuto, { marginTop: 8 }]}>
                <Text style={styles.badgeIconText}>📅</Text>
                <TextInput
                  style={styles.badgeTextInput}
                  value={catchDate}
                  onChangeText={setCatchDate}
                  placeholder="AAAA-MM-JJ"
                  placeholderTextColor={TEXT_MUTED}
                />
              </View>

              {/* Heure éditable */}
              <View style={[styles.autoField, styles.autoFieldAuto, { marginTop: 8 }]}>
                <Text style={styles.badgeIconText}>🕐</Text>
                <TextInput
                  style={styles.badgeTextInput}
                  value={catchTime}
                  onChangeText={setCatchTime}
                  placeholder="HH:MM"
                  placeholderTextColor={TEXT_MUTED}
                />
              </View>

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
                  placeholder={autoLoading ? 'GPS…' : '— km/h'}
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
                  <Text style={styles.lureButtonEmoji}>
                    {getLureByName(selectedLure)?.emoji ?? '🪝'}
                  </Text>
                  <View style={styles.lureButtonInfo}>
                    <AutoFieldText style={styles.lureButtonName}>{selectedLure}</AutoFieldText>
                    {getLureByName(selectedLure)?.brand ? (
                      <AutoFieldText style={styles.lureButtonBrand}>
                        {getLureByName(selectedLure)?.brand}
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
              selectedLure={selectedLure}
              customLures={customLures}
              onSelect={(name) => setSelectedLure(name)}
              onAddCustom={(name) => setCustomLures((prev) => [...prev, name])}
              onClose={() => setShowLurePicker(false)}
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

      <Modal visible={showLocationPicker} animationType="slide" statusBarTranslucent>
        <View style={styles.pickerContainer}>
          <View style={styles.pickerHeader}>
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

          <View style={styles.pickerFooter}>
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
    paddingTop: Platform.OS === 'ios' ? 50 : 24,
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
    paddingBottom: 100,
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
    bottom: Platform.OS === 'ios' ? 28 : 16,
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
    paddingTop: Platform.OS === 'ios' ? 56 : 28,
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
    paddingVertical: 14,
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

