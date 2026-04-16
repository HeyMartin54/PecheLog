-- ═══════════════════════════════════════════════════════════════════════════════
-- PêcheLog — Script de réinitialisation complète de la base de données
-- Supabase SQL Editor → New Query → Run
--
-- ⚠  Ce script DÉTRUIT toutes les données existantes et repart de zéro.
--    À n'utiliser qu'en développement ou pour une remise à plat complète.
--
-- Ordre d'exécution :
--   1. Extensions
--   2. Nettoyage (drop tout dans l'ordre inverse des FK)
--   3. Tables
--   4. Index
--   5. Fonctions + Triggers
--   6. Row Level Security
--   7. Fonctions utilitaires (stats)
--   8. Table lures + seed data
-- ═══════════════════════════════════════════════════════════════════════════════


-- ─── 1. Extensions ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";    -- gen_random_uuid() (fallback)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";     -- gen_random_bytes() pour invite_code
CREATE EXTENSION IF NOT EXISTS "postgis";      -- Index géospatial sur catches


-- ─── 2. Nettoyage complet ─────────────────────────────────────────────────────

-- 2a. Triggers sur auth.users (doit être supprimé avant de dropper les fonctions)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_profile_created   ON profiles;

-- 2b. Fonctions (après les triggers qui les utilisent)
DROP FUNCTION IF EXISTS handle_new_user()      CASCADE;
DROP FUNCTION IF EXISTS create_default_map()   CASCADE;
DROP FUNCTION IF EXISTS get_user_stats(UUID)   CASCADE;
DROP FUNCTION IF EXISTS get_catches_by_month(UUID, INT) CASCADE;

-- 2c. Tables dans l'ordre inverse des clés étrangères
DROP TABLE IF EXISTS catch_media  CASCADE;
DROP TABLE IF EXISTS map_shares   CASCADE;
DROP TABLE IF EXISTS catches      CASCADE;
DROP TABLE IF EXISTS maps         CASCADE;
DROP TABLE IF EXISTS lures        CASCADE;
DROP TABLE IF EXISTS profiles     CASCADE;


-- ─── 3. Tables ────────────────────────────────────────────────────────────────

-- 3a. profiles — Profils utilisateurs
--     Liée à auth.users via FK. Créée automatiquement par trigger à l'inscription.
CREATE TABLE profiles (
  id                UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name      TEXT,
  avatar_url        TEXT,
  preferred_species TEXT[]      DEFAULT '{}',
  preferred_lures   TEXT[]      DEFAULT '{}',
  preferred_lakes   TEXT[]      DEFAULT '{}',
  custom_lures      JSONB       DEFAULT '[]',   -- Leurres personnalisés ajoutés par l'utilisateur
  units_temp        TEXT        DEFAULT 'C'  CHECK (units_temp   IN ('C', 'F')),
  units_weight      TEXT        DEFAULT 'lb' CHECK (units_weight IN ('lb', 'kg')),
  units_length      TEXT        DEFAULT 'in' CHECK (units_length IN ('in', 'cm')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 3b. maps — Cartes (personnelles, partagées, publiques)
CREATE TABLE maps (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  type        TEXT        NOT NULL CHECK (type IN ('personal', 'shared', 'public')),
  scope       TEXT        CHECK (scope IN ('lake', 'region', 'all')),
  scope_value TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3c. catches — Prises de pêche (table principale)
CREATE TABLE catches (
  id                  UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID             NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  map_id              UUID             REFERENCES maps(id) ON DELETE SET NULL,

  -- Espèce et leurre
  species             TEXT             NOT NULL,
  lure                TEXT,

  -- Localisation
  latitude            DOUBLE PRECISION NOT NULL,
  longitude           DOUBLE PRECISION NOT NULL,
  lake_name           TEXT,

  -- Conditions
  depth_meters        REAL,
  depth_source        TEXT             CHECK (depth_source IN ('manual', 'sonar', 'bathymetric')),
  temperature_c       REAL,
  wind_speed_kmh      REAL,
  wind_direction_deg  INTEGER,
  speed_kmh           REAL,
  weather_conditions  TEXT,

  -- Taille du poisson
  size_category       TEXT             CHECK (size_category IN ('small', 'medium', 'large', 'trophy')),
  weight_lbs          REAL,
  length_inches       REAL,

  -- Métadonnées
  notes               TEXT,
  caught_at           TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

  -- Synchronisation hors-ligne
  local_id            TEXT,
  synced_at           TIMESTAMPTZ,

  created_at          TIMESTAMPTZ      DEFAULT NOW(),
  updated_at          TIMESTAMPTZ      DEFAULT NOW()
);

-- 3d. catch_media — Photos et vidéos associées à une prise
CREATE TABLE catch_media (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  catch_id       UUID        NOT NULL REFERENCES catches(id) ON DELETE CASCADE,
  media_type     TEXT        NOT NULL CHECK (media_type IN ('photo', 'video')),
  storage_path   TEXT        NOT NULL,
  thumbnail_path TEXT,
  local_uri      TEXT,
  uploaded       BOOLEAN     DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- 3e. map_shares — Partages de cartes entre utilisateurs
CREATE TABLE map_shares (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id      UUID        NOT NULL REFERENCES maps(id)     ON DELETE CASCADE,
  shared_by   UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  shared_with UUID        REFERENCES profiles(id)          ON DELETE CASCADE,
  permission  TEXT        DEFAULT 'read' CHECK (permission IN ('read', 'write')),
  invite_code TEXT        UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
  accepted    BOOLEAN     DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3f. lures — Catalogue de référence des leurres
CREATE TABLE lures (
  id         TEXT        PRIMARY KEY,            -- ex: 'rapala-xrap-10'
  name       TEXT        NOT NULL,
  brand      TEXT        NOT NULL DEFAULT '',
  category   TEXT        NOT NULL,
  emoji      TEXT        NOT NULL DEFAULT '🪝',
  color      TEXT        NOT NULL DEFAULT '#4BAEE8',
  bg_color   TEXT        NOT NULL DEFAULT 'rgba(75,174,232,0.15)',
  photo_url  TEXT,
  is_custom  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ─── 4. Index ─────────────────────────────────────────────────────────────────

-- catches
CREATE INDEX idx_catches_user_id   ON catches(user_id);
CREATE INDEX idx_catches_lake_name ON catches(lake_name);
CREATE INDEX idx_catches_species   ON catches(species);
CREATE INDEX idx_catches_caught_at ON catches(caught_at DESC);
CREATE INDEX idx_catches_map_id    ON catches(map_id);
CREATE INDEX idx_catches_location  ON catches USING GIST (
  ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
);

-- catch_media
CREATE INDEX idx_catch_media_catch_id ON catch_media(catch_id);

-- map_shares
CREATE INDEX idx_map_shares_shared_with ON map_shares(shared_with);
CREATE INDEX idx_map_shares_invite_code ON map_shares(invite_code);

-- lures
CREATE INDEX lures_category_idx ON lures(category);
CREATE INDEX lures_name_idx     ON lures USING GIN (to_tsvector('french', name || ' ' || brand));


-- ─── 5. Fonctions et Triggers ─────────────────────────────────────────────────

-- 5a. Crée automatiquement un profil quand un nouvel utilisateur s'inscrit.
--     Déclenché par Supabase Auth après INSERT dans auth.users.
--     SECURITY DEFINER : s'exécute avec les droits du créateur (contourne le RLS).
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1),  -- Fallback sur la partie locale de l'email
      'Pêcheur'
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture'
    )
  )
  ON CONFLICT (id) DO NOTHING;   -- Idempotent : pas d'erreur si le profil existe déjà
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 5b. Crée automatiquement une carte personnelle quand un profil est créé.
CREATE OR REPLACE FUNCTION create_default_map()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.maps (owner_id, name, type)
  VALUES (NEW.id, 'Ma carte personnelle', 'personal');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_profile_created ON profiles;
CREATE TRIGGER on_profile_created
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION create_default_map();

-- 5c. Met à jour updated_at automatiquement sur profiles et catches.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS catches_set_updated_at ON catches;
CREATE TRIGGER catches_set_updated_at
  BEFORE UPDATE ON catches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─── 6. Row Level Security ────────────────────────────────────────────────────

ALTER TABLE profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE maps       ENABLE ROW LEVEL SECURITY;
ALTER TABLE catches    ENABLE ROW LEVEL SECURITY;
ALTER TABLE catch_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE map_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE lures      ENABLE ROW LEVEL SECURITY;

-- PROFILES
CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- MAPS : propriétaire voit/gère ses cartes + cartes partagées + cartes publiques
CREATE POLICY "maps_select_own"
  ON maps FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY "maps_select_shared"
  ON maps FOR SELECT
  USING (
    id IN (
      SELECT map_id FROM map_shares
      WHERE shared_with = auth.uid() AND accepted = TRUE
    )
  );

CREATE POLICY "maps_select_public"
  ON maps FOR SELECT
  USING (type = 'public');

CREATE POLICY "maps_manage_own"
  ON maps FOR ALL
  USING (owner_id = auth.uid());

-- CATCHES : propres prises + prises des cartes partagées
CREATE POLICY "catches_select_own"
  ON catches FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "catches_select_shared"
  ON catches FOR SELECT
  USING (
    map_id IN (
      SELECT map_id FROM map_shares
      WHERE shared_with = auth.uid() AND accepted = TRUE
    )
  );

CREATE POLICY "catches_insert_own"
  ON catches FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "catches_update_own"
  ON catches FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "catches_delete_own"
  ON catches FOR DELETE
  USING (user_id = auth.uid());

-- CATCH_MEDIA : suit les droits de la prise parente
CREATE POLICY "catch_media_manage_own"
  ON catch_media FOR ALL
  USING (
    catch_id IN (SELECT id FROM catches WHERE user_id = auth.uid())
  );

-- MAP_SHARES : partageur et destinataire voient le partage
CREATE POLICY "map_shares_select"
  ON map_shares FOR SELECT
  USING (shared_by = auth.uid() OR shared_with = auth.uid());

CREATE POLICY "map_shares_insert_own"
  ON map_shares FOR INSERT
  WITH CHECK (
    shared_by = auth.uid()
    AND map_id IN (SELECT id FROM maps WHERE owner_id = auth.uid())
  );

-- LURES : catalogue lisible par tout le monde (authentifié ou non)
CREATE POLICY "lures_select_public"
  ON lures FOR SELECT
  USING (true);


-- ─── 7. Fonctions utilitaires (statistiques) ──────────────────────────────────

-- Statistiques globales d'un utilisateur
CREATE OR REPLACE FUNCTION get_user_stats(p_user_id UUID)
RETURNS JSON AS $$
  SELECT json_build_object(
    'total_catches',    COUNT(*),
    'total_lakes',      COUNT(DISTINCT lake_name),
    'max_weight_lbs',   MAX(weight_lbs),
    'favorite_species', (
      SELECT species FROM catches
      WHERE user_id = p_user_id
      GROUP BY species ORDER BY COUNT(*) DESC LIMIT 1
    ),
    'favorite_lure', (
      SELECT lure FROM catches
      WHERE user_id = p_user_id AND lure IS NOT NULL
      GROUP BY lure ORDER BY COUNT(*) DESC LIMIT 1
    )
  )
  FROM catches
  WHERE user_id = p_user_id;
$$ LANGUAGE sql SECURITY DEFINER;

-- Prises par mois (pour graphique barres)
CREATE OR REPLACE FUNCTION get_catches_by_month(p_user_id UUID, p_months INT DEFAULT 12)
RETURNS TABLE(month TEXT, count BIGINT) AS $$
  SELECT
    TO_CHAR(caught_at, 'YYYY-MM') AS month,
    COUNT(*)                       AS count
  FROM catches
  WHERE user_id = p_user_id
    AND caught_at >= NOW() - (p_months || ' months')::INTERVAL
  GROUP BY TO_CHAR(caught_at, 'YYYY-MM')
  ORDER BY month;
$$ LANGUAGE sql SECURITY DEFINER;


-- ─── 8. Seed data — Catalogue de leurres ─────────────────────────────────────

INSERT INTO lures (id, name, brand, category, emoji, color, bg_color, photo_url) VALUES

-- Cuillères tournantes
('mepps-aglia-2-argent',       'Aglia #2 Argent',           'Mepps',         'Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)',  NULL),
('mepps-aglia-3-or',           'Aglia #3 Or',               'Mepps',         'Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)',  NULL),
('mepps-black-fury-2',         'Black Fury #2',             'Mepps',         'Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)',  NULL),
('mepps-aglia-long-3',         'Aglia Long #3',             'Mepps',         'Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)',  NULL),
('mepps-lusox-1',              'Lusox #1',                  'Mepps',         'Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)',  NULL),
('bluefox-vibrax-3',           'Vibrax #3',                 'Blue Fox',      'Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)',  NULL),
('bluefox-vibrax-4',           'Vibrax #4',                 'Blue Fox',      'Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)',  NULL),
('panther-martin-6',           'Panther Martin #6',         'Panther Martin','Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)',  NULL),
('panther-martin-9',           'Panther Martin #9',         'Panther Martin','Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)',  NULL),
('roostertail-1-8',            'Rooster Tail 1/8 oz',       'Worden''s',     'Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)',  NULL),
('roostertail-1-4',            'Rooster Tail 1/4 oz',       'Worden''s',     'Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)',  NULL),

-- Cuillères ondulantes
('williams-wobbler-w50',       'Wobbler W50',               'Williams',      'Cuillère ondulante', '🥄', '#C0C0C0', 'rgba(192,192,192,0.15)', NULL),
('williams-wobbler-w60',       'Wobbler W60',               'Williams',      'Cuillère ondulante', '🥄', '#C0C0C0', 'rgba(192,192,192,0.15)', NULL),
('dardevle-1oz',               'Dardevle 1 oz',             'Eppinger',      'Cuillère ondulante', '🥄', '#C0C0C0', 'rgba(192,192,192,0.15)', NULL),
('dardevle-1-2oz',             'Dardevle 1/2 oz',           'Eppinger',      'Cuillère ondulante', '🥄', '#C0C0C0', 'rgba(192,192,192,0.15)', NULL),
('kastmaster-1-2',             'Kastmaster 1/2 oz',         'Acme',          'Cuillère ondulante', '🥄', '#C0C0C0', 'rgba(192,192,192,0.15)', NULL),
('little-cleo-3-4',            'Little Cleo 3/4 oz',        'Acme',          'Cuillère ondulante', '🥄', '#C0C0C0', 'rgba(192,192,192,0.15)', NULL),
('krocodile-3-8',              'Krocodile 3/8 oz',          'Luhr-Jensen',   'Cuillère ondulante', '🥄', '#C0C0C0', 'rgba(192,192,192,0.15)', NULL),
('doctor-spoon',               'Doctor Spoon',              'Williams',      'Cuillère ondulante', '🥄', '#C0C0C0', 'rgba(192,192,192,0.15)', NULL),

-- Poissons nageurs
('rapala-original-7',          'Original Floater 7 cm',     'Rapala',        'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  NULL),
('rapala-original-9',          'Original Floater 9 cm',     'Rapala',        'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  NULL),
('rapala-xrap-10',             'X-Rap 10',                  'Rapala',        'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  NULL),
('rapala-shad-rap-sr7',        'Shad Rap SR7',              'Rapala',        'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  NULL),
('rapala-husky-jerk-10',       'Husky Jerk 10',             'Rapala',        'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  NULL),
('rapala-countdown-7',         'Countdown 7',               'Rapala',        'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  NULL),
('rapala-dt6',                 'DT-6',                      'Rapala',        'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  NULL),
('storm-thunderstick',         'ThunderStick',              'Storm',         'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  NULL),
('rebel-crawfish',             'Crawfish',                  'Rebel',         'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  NULL),
('yozuri-crystal-minnow',      'Crystal Minnow 9 cm',       'Yo-Zuri',       'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  NULL),
('berkley-flicker-shad',       'Flicker Shad 5 cm',         'Berkley',       'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  NULL),
('cordell-redfin',             'Red Fin',                   'Cotton Cordell','Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  NULL),
('lucky-craft-lvr-d7',         'LVR D-7',                   'Lucky Craft',   'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  NULL),

-- Surface
('heddon-zara-spook',          'Zara Spook',                'Heddon',        'Surface',            '💧', '#00D4AA', 'rgba(0,212,170,0.15)',   NULL),
('heddon-torpedo',             'Baby Torpedo',              'Heddon',        'Surface',            '💧', '#00D4AA', 'rgba(0,212,170,0.15)',   NULL),
('hula-popper',                'Hula Popper',               'Arbogast',      'Surface',            '💧', '#00D4AA', 'rgba(0,212,170,0.15)',   NULL),
('arbogast-jitterbug',         'Jitterbug',                 'Arbogast',      'Surface',            '💧', '#00D4AA', 'rgba(0,212,170,0.15)',   NULL),
('rebel-popr',                 'Pop-R',                     'Rebel',         'Surface',            '💧', '#00D4AA', 'rgba(0,212,170,0.15)',   NULL),
('river2sea-whopper-plopper',  'Whopper Plopper 90',        'River2Sea',     'Surface',            '💧', '#00D4AA', 'rgba(0,212,170,0.15)',   NULL),
('rapala-skitter-pop',         'Skitter Pop 7',             'Rapala',        'Surface',            '💧', '#00D4AA', 'rgba(0,212,170,0.15)',   NULL),
('strike-king-sexy-frog',      'KVD Sexy Frog',             'Strike King',   'Surface',            '💧', '#00D4AA', 'rgba(0,212,170,0.15)',   NULL),
('booyah-pad-crasher',         'Pad Crasher',               'Booyah',        'Surface',            '💧', '#00D4AA', 'rgba(0,212,170,0.15)',   NULL),

-- Jigs
('jig-marabou-blanc-1-4',      'Jig Marabou Blanc 1/4 oz',      'Générique', 'Jig',               '🎣', '#C77DDB', 'rgba(199,125,219,0.15)', NULL),
('jig-marabou-chartreuse-1-4', 'Jig Marabou Chartreuse 1/4 oz', 'Générique', 'Jig',               '🎣', '#C77DDB', 'rgba(199,125,219,0.15)', NULL),
('jig-tube-1-4',               'Jig Tube 1/4 oz',               'Générique', 'Jig',               '🎣', '#C77DDB', 'rgba(199,125,219,0.15)', NULL),
('jig-tube-3-8',               'Jig Tube 3/8 oz',               'Générique', 'Jig',               '🎣', '#C77DDB', 'rgba(199,125,219,0.15)', NULL),
('jig-curly-tail-1-4',         'Jig Curly Tail 1/4 oz',         'Générique', 'Jig',               '🎣', '#C77DDB', 'rgba(199,125,219,0.15)', NULL),
('jig-bucktail-1-2',           'Jig Bucktail 1/2 oz',           'Générique', 'Jig',               '🎣', '#C77DDB', 'rgba(199,125,219,0.15)', NULL),
('swim-jig-3-8',               'Swim Jig 3/8 oz',               'Z-Man',     'Jig',               '🎣', '#C77DDB', 'rgba(199,125,219,0.15)', NULL),
('football-jig-3-4',           'Football Jig 3/4 oz',           'Générique', 'Jig',               '🎣', '#C77DDB', 'rgba(199,125,219,0.15)', NULL),
('ned-rig-1-10',               'Ned Rig 1/10 oz',               'Z-Man',     'Jig',               '🎣', '#C77DDB', 'rgba(199,125,219,0.15)', NULL),
('blade-bait-3-8',             'Blade Bait 3/8 oz',             'Générique', 'Jig',               '🎣', '#C77DDB', 'rgba(199,125,219,0.15)', NULL),

-- Leurres souples
('berkley-powerbait-minnow',   'PowerBait Minnow 3"',       'Berkley',       'Leurre souple',      '🪱', '#3DBA78', 'rgba(61,186,120,0.15)',  NULL),
('berkley-gulp-minnow',        'Gulp Alive Minnow 3"',      'Berkley',       'Leurre souple',      '🪱', '#3DBA78', 'rgba(61,186,120,0.15)',  NULL),
('berkley-gulp-crawdad',       'Gulp Crawdad 2"',           'Berkley',       'Leurre souple',      '🪱', '#3DBA78', 'rgba(61,186,120,0.15)',  NULL),
('zoom-trick-worm',            'Trick Worm 6"',             'Zoom',          'Leurre souple',      '🪱', '#3DBA78', 'rgba(61,186,120,0.15)',  NULL),
('gary-yamamoto-senko-4',      'Senko 4"',                  'Gary Yamamoto', 'Leurre souple',      '🪱', '#3DBA78', 'rgba(61,186,120,0.15)',  NULL),
('keitech-swing-impact',       'Swing Impact 3.5"',         'Keitech',       'Leurre souple',      '🪱', '#3DBA78', 'rgba(61,186,120,0.15)',  NULL),
('strike-king-rage-craw',      'Rage Craw 4"',              'Strike King',   'Leurre souple',      '🪱', '#3DBA78', 'rgba(61,186,120,0.15)',  NULL),
('paddle-tail-swimbait-4',     'Swimbait Paddle Tail 4"',   'Générique',     'Leurre souple',      '🪱', '#3DBA78', 'rgba(61,186,120,0.15)',  NULL),
('tube-4',                     'Tube Plastique 4"',         'Générique',     'Leurre souple',      '🪱', '#3DBA78', 'rgba(61,186,120,0.15)',  NULL),
('grub-3',                     'Grub 3"',                   'Générique',     'Leurre souple',      '🪱', '#3DBA78', 'rgba(61,186,120,0.15)',  NULL),
('zman-chatterbait',           'ChatterBait 3/8 oz',        'Z-Man',         'Leurre souple',      '🪱', '#3DBA78', 'rgba(61,186,120,0.15)',  NULL),

-- Mouches
('mouche-adams',               'Adams',                     'Mouche sèche',  'Mouche',             '🦋', '#FFD700', 'rgba(255,215,0,0.15)',   NULL),
('mouche-elk-hair-caddis',     'Elk Hair Caddis',           'Mouche sèche',  'Mouche',             '🦋', '#FFD700', 'rgba(255,215,0,0.15)',   NULL),
('mouche-hares-ear',           'Hare''s Ear',               'Nymphe',        'Mouche',             '🦋', '#FFD700', 'rgba(255,215,0,0.15)',   NULL),
('mouche-pheasant-tail',       'Pheasant Tail',             'Nymphe',        'Mouche',             '🦋', '#FFD700', 'rgba(255,215,0,0.15)',   NULL),
('muddler-minnow',             'Muddler Minnow',            'Streamer',      'Mouche',             '🦋', '#FFD700', 'rgba(255,215,0,0.15)',   NULL),
('woolly-bugger-noir',         'Woolly Bugger (noir)',       'Streamer',      'Mouche',             '🦋', '#FFD700', 'rgba(255,215,0,0.15)',   NULL),
('woolly-bugger-olive',        'Woolly Bugger (olive)',      'Streamer',      'Mouche',             '🦋', '#FFD700', 'rgba(255,215,0,0.15)',   NULL),
('zonker',                     'Zonker',                    'Streamer',      'Mouche',             '🦋', '#FFD700', 'rgba(255,215,0,0.15)',   NULL),
('popper-mouche',              'Popper en foam',            'Mouche',        'Mouche',             '🦋', '#FFD700', 'rgba(255,215,0,0.15)',   NULL),

-- Naturel
('ver-de-terre',               'Ver de terre',              'Naturel',       'Naturel',            '🪱', '#A0785A', 'rgba(160,120,90,0.15)',  NULL),
('minnow-ventre-jaune',        'Minnow (ventre jaune)',      'Naturel',       'Naturel',            '🐠', '#A0785A', 'rgba(160,120,90,0.15)',  NULL),
('sangsue',                    'Sangsue',                   'Naturel',       'Naturel',            '🪱', '#A0785A', 'rgba(160,120,90,0.15)',  NULL),
('grenouille',                 'Grenouille',                'Naturel',       'Naturel',            '🐸', '#A0785A', 'rgba(160,120,90,0.15)',  NULL),
('ecrevisse',                  'Écrevisse',                 'Naturel',       'Naturel',            '🦞', '#A0785A', 'rgba(160,120,90,0.15)',  NULL),
('maggot',                     'Vers à fraise (maggot)',    'Naturel',       'Naturel',            '🪱', '#A0785A', 'rgba(160,120,90,0.15)',  NULL)

ON CONFLICT (id) DO NOTHING;


-- ─── Vérification finale ──────────────────────────────────────────────────────
-- Ces SELECTs confirment que tout a été créé correctement.
SELECT
  'profiles'    AS table_name, COUNT(*) AS rows FROM profiles   UNION ALL
SELECT 'maps',       COUNT(*) FROM maps         UNION ALL
SELECT 'catches',    COUNT(*) FROM catches       UNION ALL
SELECT 'catch_media',COUNT(*) FROM catch_media   UNION ALL
SELECT 'map_shares', COUNT(*) FROM map_shares    UNION ALL
SELECT 'lures',      COUNT(*) FROM lures;
