import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColorScheme } from '@/components/useColorScheme';
import { AuthProvider } from '@/contexts/AuthContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNetworkStatus } from '@/lib/hooks/useNetworkStatus';
import { trySyncOfflineCatches } from '@/lib/offlineSync';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Lancer l'app sur l'écran de login par défaut.
  initialRouteName: 'login',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

// Détecte le retour en ligne et déclenche la synchronisation des prises hors-ligne
function SyncManager() {
  const { user } = useAuth();
  const isConnected = useNetworkStatus();
  const prevConnected = useRef<boolean | null>(null);

  useEffect(() => {
    // Transition offline → online : on synchronise
    if (isConnected === true && prevConnected.current === false && user?.id) {
      trySyncOfflineCatches(user.id);
    }
    prevConnected.current = isConnected;
  }, [isConnected, user?.id]);

  return null;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <View style={styles.root}>
            <Stack>
              <Stack.Screen name="login" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
              <Stack.Screen name="catch-detail" options={{ headerShown: false }} />
              <Stack.Screen name="plan-trip" options={{ headerShown: false }} />
              <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
            </Stack>
            <SyncManager />
          </View>
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

