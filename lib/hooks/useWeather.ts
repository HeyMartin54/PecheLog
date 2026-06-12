import { useEffect, useState } from 'react';

import { fetchWithTimeout } from '@/lib/net';

type UseWeatherResult = {
  temperatureC: number | null;
  windKmh: number | null;
  windDirection: string | null;
  loading: boolean;
  error: string | null;
};

export function useWeather(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): UseWeatherResult {
  const [temperatureC, setTemperatureC] = useState<number | null>(null);
  const [windKmh, setWindKmh] = useState<number | null>(null);
  const [windDirection, setWindDirection] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (latitude == null || longitude == null) {
      return;
    }

    let isMounted = true;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const data = await fetchWeatherFromOpenWeather(latitude, longitude);
        if (!isMounted || !data) return;

        setTemperatureC(data.tempC);
        setWindKmh(data.windKmh);
        setWindDirection(data.windDirection);
      } catch (err) {
        console.warn('[useWeather] Erreur lors du chargement météo', err);
        if (isMounted) {
          setError("Impossible de récupérer la météo actuelle");
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
  }, [latitude, longitude]);

  return {
    temperatureC,
    windKmh,
    windDirection,
    loading,
    error,
  };
}

function degreesToCardinal(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return dirs[Math.round(deg / 45) % 8];
}

async function fetchWeatherFromOpenWeather(
  latitude: number,
  longitude: number,
): Promise<{ tempC: number | null; windKmh: number | null; windDirection: string | null } | null> {
  const apiKey = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY;
  if (!apiKey) {
    console.warn('[useWeather] EXPO_PUBLIC_OPENWEATHER_API_KEY manquante');
    return null;
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&units=metric&appid=${apiKey}`;
    const res = await fetchWithTimeout(url, {}, 8000);
    if (!res.ok) {
      console.warn('[useWeather] Réponse météo non OK', res.status);
      return null;
    }

    const data = await res.json();
    const tempC = typeof data?.main?.temp === 'number' ? data.main.temp : null;
    const windMs = typeof data?.wind?.speed === 'number' ? data.wind.speed : null;
    const windKmh = windMs != null ? windMs * 3.6 : null;
    const windDeg = typeof data?.wind?.deg === 'number' ? data.wind.deg : null;
    const windDirection = windDeg != null ? degreesToCardinal(windDeg) : null;

    return { tempC, windKmh, windDirection };
  } catch (err) {
    console.warn('[useWeather] Erreur lors du fetch météo', err);
    return null;
  }
}

