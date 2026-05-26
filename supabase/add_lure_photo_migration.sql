-- Migration : ajout de la colonne photo_url sur user_lures
-- À exécuter dans le Supabase SQL Editor (Dashboard > SQL Editor)

ALTER TABLE user_lures ADD COLUMN IF NOT EXISTS photo_url TEXT;
