// app.config.js — remplace app.json pour permettre l'interpolation des variables d'environnement
const IS_DEV = process.env.APP_VARIANT === 'development';

module.exports = {
  expo: {
    name: IS_DEV ? 'PecheLog (dev)' : 'PecheLog',
    slug: 'PecheLog',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'pechelog',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    splash: {
      image: './assets/images/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    ios: {
      supportsTablet: true,
    },
    android: {
      package: 'com.pechelog.app',
      versionCode: 1,
      adaptiveIcon: {
        foregroundImage: './assets/images/adaptive-icon.png',
        backgroundColor: '#0d1b2a',
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      permissions: [
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.CAMERA',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.INTERNET',
        'android.permission.BLUETOOTH',
        'android.permission.BLUETOOTH_CONNECT',
        'android.permission.BLUETOOTH_SCAN',
      ],
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [{ scheme: 'pechelog' }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
      config: {
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY,
        },
      },
    },
    web: {
      bundler: 'metro',
      output: 'single',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      'expo-sqlite',
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission: 'PêcheLog utilise votre position GPS pour enregistrer l\'emplacement de vos prises.',
          locationWhenInUsePermission: 'PêcheLog utilise votre position GPS pour enregistrer l\'emplacement de vos prises.',
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission: 'PêcheLog accède à vos photos pour que vous puissiez en ajouter à vos prises.',
          cameraPermission: 'PêcheLog utilise la caméra pour prendre des photos de vos prises.',
        },
      ],
      [
        'expo-camera',
        {
          cameraPermission: 'PêcheLog utilise la caméra pour prendre des photos de vos prises.',
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      eas: {
        projectId: '847a5a45-d06f-411f-8a69-4d6b7f1a7688',
      },
    },
  },
};
