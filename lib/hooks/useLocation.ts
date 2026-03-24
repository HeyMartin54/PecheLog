import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

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

        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        if (!isMounted) return;

        setCoords(loc);

        const speed = typeof loc.coords.speed === 'number' ? loc.coords.speed : null;
        setSpeedKmh(speed != null ? speed * 3.6 : null);

        const lake = await reverseGeocodeLakeName(
          loc.coords.latitude,
          loc.coords.longitude,
        );
        if (!isMounted) return;
        setLakeName(lake);
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
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'PecheLog/1.0',
      },
    });
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

