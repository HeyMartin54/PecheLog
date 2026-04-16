import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qgkwbjnqzhcesxtucrvt.supabase.co';
const supabaseKey = 'sb_publishable_Xz50Y3urEx41FUph_sD_rg_SEOo1LNm'; // clé anon publique

/** localStorage avec garde SSR (pas de window en Node lors du rendu statique / build). */
const webAuthStorage = {
  getItem: (key: string) => {
    if (typeof window === 'undefined') return Promise.resolve(null);
    return Promise.resolve(window.localStorage.getItem(key));
  },
  setItem: (key: string, value: string) => {
    if (typeof window === 'undefined') return Promise.resolve();
    window.localStorage.setItem(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    if (typeof window === 'undefined') return Promise.resolve();
    window.localStorage.removeItem(key);
    return Promise.resolve();
  },
};

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: Platform.OS === 'web' ? webAuthStorage : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // detectSessionInUrl : Supabase scrute l'URL pour #access_token (implicit flow).
    // Sur web, c'est utile. Sur mobile, l'URL n'est pas accessible donc on désactive.
    detectSessionInUrl: Platform.OS === 'web',
  },
});

console.log('[Supabase] Client initialisé', {
  platform: Platform.OS,
  url: supabaseUrl,
  detectSessionInUrl: Platform.OS === 'web',
});

