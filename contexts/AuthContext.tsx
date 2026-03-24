import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { Session, User, AuthError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

type AuthContextType = {
  session: Session | null;
  user: User | null;
  initializing: boolean;
  signInWithEmail: (email: string, password: string) => Promise<AuthError | null>;
  signInWithFacebook: () => Promise<AuthError | null>;
  signOut: () => Promise<AuthError | null>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type AuthProviderProps = {
  children: ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const loadInitialSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();

        if (!isMounted) return;

        if (error) {
          console.warn('[Auth] Erreur lors du chargement de la session initiale', error);
          setSession(null);
          setUser(null);
        } else {
          setSession(data.session ?? null);
          setUser(data.session?.user ?? null);
        }
      } catch (err) {
        if (isMounted) {
          console.warn('[Auth] Erreur inattendue lors du chargement de la session', err);
          setSession(null);
          setUser(null);
        }
      } finally {
        if (isMounted) {
          setInitializing(false);
        }
      }
    };

    loadInitialSession();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const signInWithEmail = async (email: string, password: string): Promise<AuthError | null> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      console.warn('[Auth] Erreur de connexion par courriel', error);
      return error;
    }

    return null;
  };

  const signInWithFacebook = async (): Promise<AuthError | null> => {
    const redirectTo = Linking.createURL('/');

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'facebook',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error) {
      console.warn('[Auth] Erreur de connexion Facebook', error);
      return error;
    }

    if (data?.url) {
      // Sur mobile, on doit explicitement ouvrir le navigateur
      // avec l’URL fournie par Supabase.
      await WebBrowser.openBrowserAsync(data.url);
    }

    return null;
  };

  const signOut = async (): Promise<AuthError | null> => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.warn('[Auth] Erreur de déconnexion', error);
      return error;
    }

    return null;
  };

  const value: AuthContextType = {
    session,
    user,
    initializing,
    signInWithEmail,
    signInWithFacebook,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error('useAuth doit être utilisé à l’intérieur de AuthProvider');
  }

  return ctx;
}

