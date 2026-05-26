import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export type UserLure = {
  id: string;
  user_id: string;
  name: string;
  size: string | null;
  color: string | null;
  notes: string | null;
  photo_url: string | null;
  created_at: string;
};

type LureInput = {
  name: string;
  size: string | null;
  color: string | null;
  notes: string | null;
  photo_url?: string | null;
};

const cacheKey = (userId: string) => `user_lures_cache_${userId}`;

export async function getCachedLures(userId: string): Promise<UserLure[]> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(userId));
    return raw ? (JSON.parse(raw) as UserLure[]) : [];
  } catch {
    return [];
  }
}

export async function setCachedLures(userId: string, lures: UserLure[]): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKey(userId), JSON.stringify(lures));
  } catch {}
}

export async function loadUserLures(userId: string): Promise<UserLure[]> {
  const { data, error } = await supabase
    .from('user_lures')
    .select('id, user_id, name, size, color, notes, photo_url, created_at')
    .eq('user_id', userId)
    .order('name');

  if (error || !data) return [];
  return data as UserLure[];
}

export async function loadLuresWithCache(userId: string): Promise<UserLure[]> {
  try {
    const lures = await loadUserLures(userId);
    await setCachedLures(userId, lures);
    return lures;
  } catch {
    return getCachedLures(userId);
  }
}

export async function createUserLure(userId: string, input: LureInput): Promise<UserLure | null> {
  const { data, error } = await supabase
    .from('user_lures')
    .insert({ user_id: userId, ...input })
    .select()
    .single();

  if (error || !data) return null;
  return data as UserLure;
}

export async function updateUserLure(id: string, input: Partial<LureInput>): Promise<boolean> {
  const { error } = await supabase
    .from('user_lures')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id);

  return !error;
}

export async function deleteUserLure(id: string): Promise<boolean> {
  const { error } = await supabase.from('user_lures').delete().eq('id', id);
  return !error;
}
