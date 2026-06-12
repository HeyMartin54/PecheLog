import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

import { getPositionSafe } from '@/lib/locationSafe';
import { fetchWithTimeout, isOnline } from '@/lib/net';

type UseLocationResult = {
  coords: Location.LocationObject | null;
  lakeName: string | null;
  speedKmh: number | null;
  loading: boolean;
  error: string | null;
  permissionStatus: Location.PermissionStatus | null;
};

export function useLocation(): UseLocationResult {
  const [coords, setCoords] = useState<Location.LocationObject | null>(null);
  const [lakeName, setLakeName] = useState<string | null>(null);
  const [speedKmh, setSpeedKmh] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] =
    useState<Location.PermissionStatus | null>(null);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const { status } = await Location.requestForegroundPermissionsAsync();
        if (!isMounted) return;

        setPermissionStatus(status);

        if (status !== 'granted') {
          setError("Permission de localisation refusée");
          setLoading(false);
          return;
        }

        const loc = await getPositionSafe();
        if (!isMounted) return;
        if (!loc) {
          setError('Impossible de récupérer la position actuelle');
          return;
        }

        setCoords(loc);

        const speed = typeof loc.coords.speed === 'number' ? loc.coords.speed : null;
        setSpeedKmh(speed != null ? speed * 3.6 : null);

        // Geocoding seulement si en ligne (Nominatim nécessite internet)
        if (await isOnline()) {
          const lake = await reverseGeocodeLakeName(
            loc.coords.latitude,
            loc.coords.longitude,
          );
          if (!isMounted) return;
          setLakeName(lake);
        }
      } catch (err) {
        console.warn('[useLocation] Erreur lors de la récupération de la position', err);
        if (isMounted) {
          setError("Impossible de récupérer la position actuelle");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      isMounted = false;
    };
  }, []);

  return {
    coords,
    lakeName,
    speedKmh,
    loading,
    error,
    permissionStatus,
  };
}

async function reverseGeocodeLakeName(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&zoom=14`;
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'PecheLog/1.0',
      },
    }, 8000);
    if (!res.ok) return null;
    const data = await res.json();
    const lake =
      data?.address?.water ||
      data?.address?.lake ||
      data?.address?.reservoir ||
      data?.name;
    return lake ?? null;
  } catch (err) {
    console.warn('[useLocation] Erreur reverse geocoding', err);
    return null;
  }
}

