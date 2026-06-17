# DATABASE.md — PêcheLog : Schéma de base de données

> Schéma SQL pour Supabase (PostgreSQL).
> Copier dans Supabase > SQL Editor > New Query > Run
>
> **Ordre d'exécution obligatoire :**
> 1. Tables (`profiles`, `maps`, `catches`, `catch_media`, `map_shares`)
> 2. Triggers (`on_auth_user_created` sur `auth.users`, `on_profile_created` sur `profiles`)
> 3. Row Level Security (RLS)
> 4. Fonctions utilitaires
>
> Les triggers utilisent `DROP TRIGGER IF EXISTS` pour être sûrs à ré-exécuter.

---

## Tables

### profiles — Profils utilisateurs
```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  preferred_species TEXT[] DEFAULT '{}',
  preferred_lures TEXT[] DEFAULT '{}',
  preferred_lakes TEXT[] DEFAULT '{}',
  units_temp TEXT DEFAULT 'C' CHECK (units_temp IN ('C', 'F')),
  units_weight TEXT DEFAULT 'lb' CHECK (units_weight IN ('lb', 'kg')),
  units_length TEXT DEFAULT 'in' CHECK (units_length IN ('in', 'cm')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Créer automatiquement un profil à l'inscription
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'Pêcheur'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

### user_lures — Leurres personnalisés par utilisateur
```sql
CREATE TABLE user_lures (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  size        TEXT,
  color       TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_lures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_lures_own" ON user_lures
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

### trips — Voyages de pêche
```sql
CREATE TABLE trips (
  id            TEXT PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ,
  lakes         JSONB NOT NULL DEFAULT '[]',
  companions    TEXT[] DEFAULT '{}',
  lures_selected TEXT[] DEFAULT '{}',
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_trips_user_id  ON trips(user_id);
CREATE INDEX idx_trips_ended_at ON trips(ended_at);

ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trips_own" ON trips
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

### shared_zones — Zones de partage dessinées sur la carte ✅ (utilisé par le client)
```sql
CREATE TABLE shared_zones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  -- Polygone dessiné par l'utilisateur : [{ "latitude": .., "longitude": .. }, ...]
  polygon     JSONB NOT NULL,
  invite_code TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(4), 'hex'),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shared_zones_owner ON shared_zones(owner_id);
CREATE INDEX idx_shared_zones_code  ON shared_zones(invite_code);

ALTER TABLE shared_zones ENABLE ROW LEVEL SECURITY;

-- Le propriétaire gère ses zones
CREATE POLICY "zones_owner_all" ON shared_zones
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Les destinataires voient les zones qu'on leur a partagées
CREATE POLICY "zones_member_select" ON shared_zones
  FOR SELECT
  USING (id IN (SELECT zone_id FROM zone_shares WHERE shared_with = auth.uid()));
```

### zone_shares — Adhésions aux zones partagées ✅ (utilisé par le client)
```sql
CREATE TABLE zone_shares (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id     UUID NOT NULL REFERENCES shared_zones(id) ON DELETE CASCADE,
  shared_with UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (zone_id, shared_with)
);

CREATE INDEX idx_zone_shares_shared_with ON zone_shares(shared_with);
CREATE INDEX idx_zone_shares_zone        ON zone_shares(zone_id);

ALTER TABLE zone_shares ENABLE ROW LEVEL SECURITY;

-- Visible par le destinataire et le propriétaire de la zone
CREATE POLICY "zone_shares_select" ON zone_shares
  FOR SELECT
  USING (
    shared_with = auth.uid()
    OR zone_id IN (SELECT id FROM shared_zones WHERE owner_id = auth.uid())
  );

-- Le destinataire peut quitter ; le propriétaire peut révoquer
CREATE POLICY "zone_shares_delete" ON zone_shares
  FOR DELETE
  USING (
    shared_with = auth.uid()
    OR zone_id IN (SELECT id FROM shared_zones WHERE owner_id = auth.uid())
  );

-- Pas de policy INSERT : l'adhésion passe uniquement par redeem_zone_code()
```

### Fonctions de partage de zones ✅
```sql
-- Rejoindre une zone avec un code d'invitation.
-- SECURITY DEFINER : permet de trouver la zone par code sans la voir au préalable.
CREATE OR REPLACE FUNCTION redeem_zone_code(p_code TEXT)
RETURNS TABLE (zone_id UUID, zone_name TEXT) AS $$
DECLARE
  v_zone shared_zones%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_zone FROM shared_zones WHERE invite_code = lower(trim(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;
  IF v_zone.owner_id = auth.uid() THEN
    RAISE EXCEPTION 'own_zone';
  END IF;

  INSERT INTO zone_shares (zone_id, shared_with)
  VALUES (v_zone.id, auth.uid())
  ON CONFLICT (zone_id, shared_with) DO NOTHING;

  RETURN QUERY SELECT v_zone.id, v_zone.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Test point-dans-polygone (ray casting) sur le JSONB du polygone
CREATE OR REPLACE FUNCTION point_in_polygon(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_polygon JSONB
) RETURNS BOOLEAN AS $$
DECLARE
  n INT;
  i INT;
  j INT;
  xi DOUBLE PRECISION; yi DOUBLE PRECISION;
  xj DOUBLE PRECISION; yj DOUBLE PRECISION;
  inside BOOLEAN := FALSE;
BEGIN
  n := jsonb_array_length(p_polygon);
  IF n IS NULL OR n < 3 THEN RETURN FALSE; END IF;
  j := n - 1;
  FOR i IN 0..n-1 LOOP
    xi := (p_polygon->i->>'longitude')::DOUBLE PRECISION;
    yi := (p_polygon->i->>'latitude')::DOUBLE PRECISION;
    xj := (p_polygon->j->>'longitude')::DOUBLE PRECISION;
    yj := (p_polygon->j->>'latitude')::DOUBLE PRECISION;
    IF ((yi > p_lat) <> (yj > p_lat))
       AND (p_lng < (xj - xi) * (p_lat - yi) / (yj - yi) + xi) THEN
      inside := NOT inside;
    END IF;
  END LOOP;
  RETURN inside;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Prises du propriétaire à l'intérieur d'une zone.
-- SECURITY DEFINER : contourne le RLS de catches, MAIS vérifie d'abord
-- que l'appelant est le propriétaire ou un destinataire de la zone,
-- et ne retourne QUE les prises strictement dans le polygone.
CREATE OR REPLACE FUNCTION get_zone_catches(p_zone_id UUID)
RETURNS SETOF catches AS $$
DECLARE
  v_zone shared_zones%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_zone FROM shared_zones WHERE id = p_zone_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'zone_not_found';
  END IF;

  IF v_zone.owner_id <> auth.uid()
     AND NOT EXISTS (
       SELECT 1 FROM zone_shares
       WHERE zone_id = p_zone_id AND shared_with = auth.uid()
     ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
    SELECT c.*
    FROM catches c
    WHERE c.user_id = v_zone.owner_id
      AND c.latitude IS NOT NULL
      AND c.longitude IS NOT NULL
      AND point_in_polygon(c.latitude, c.longitude, v_zone.polygon);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### maps — Cartes (personnelles et partagées)
```sql
CREATE TABLE maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('personal', 'shared', 'public')),
  scope TEXT CHECK (scope IN ('lake', 'region', 'all')),
  scope_value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chaque utilisateur a une carte personnelle par défaut
CREATE OR REPLACE FUNCTION create_default_map()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO maps (owner_id, name, type)
  VALUES (NEW.id, 'Ma carte personnelle', 'personal');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_profile_created ON profiles;
CREATE TRIGGER on_profile_created
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION create_default_map();
```

### catches — Prises de pêche (table principale)
```sql
CREATE TABLE catches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  map_id UUID REFERENCES maps(id) ON DELETE SET NULL,
  
  -- Espèce et leurre
  species TEXT NOT NULL,
  lure TEXT,
  
  -- Localisation
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  lake_name TEXT,
  
  -- Conditions
  depth_meters REAL,
  depth_source TEXT CHECK (depth_source IN ('manual', 'sonar', 'bathymetric')),
  temperature_c REAL,
  wind_speed_kmh REAL,
  wind_direction_deg INTEGER,
  speed_kmh REAL,
  weather_conditions TEXT,
  
  -- Taille du poisson
  size_category TEXT CHECK (size_category IN ('small', 'medium', 'large', 'trophy')),
  weight_lbs REAL,
  length_inches REAL,
  
  -- Métadonnées
  notes TEXT,
  caught_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Synchronisation hors-ligne
  local_id TEXT,
  synced_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour les requêtes fréquentes
CREATE INDEX idx_catches_user_id ON catches(user_id);
CREATE INDEX idx_catches_lake_name ON catches(lake_name);
CREATE INDEX idx_catches_species ON catches(species);
CREATE INDEX idx_catches_caught_at ON catches(caught_at DESC);
CREATE INDEX idx_catches_map_id ON catches(map_id);
CREATE INDEX idx_catches_location ON catches USING GIST (
  ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
);
```

### catch_media — Photos et vidéos
```sql
CREATE TABLE catch_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catch_id UUID REFERENCES catches(id) ON DELETE CASCADE NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'video')),
  storage_path TEXT NOT NULL,
  thumbnail_path TEXT,
  local_uri TEXT,
  uploaded BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_catch_media_catch_id ON catch_media(catch_id);
```

### map_shares — Partages de cartes entre utilisateurs
```sql
CREATE TABLE map_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id UUID REFERENCES maps(id) ON DELETE CASCADE NOT NULL,
  shared_by UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  shared_with UUID REFERENCES profiles(id) ON DELETE CASCADE,
  permission TEXT DEFAULT 'read' CHECK (permission IN ('read', 'write')),
  invite_code TEXT UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
  accepted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_map_shares_shared_with ON map_shares(shared_with);
CREATE INDEX idx_map_shares_invite_code ON map_shares(invite_code);
```

---

## Row Level Security (RLS)

```sql
-- Activer RLS sur toutes les tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE catches ENABLE ROW LEVEL SECURITY;
ALTER TABLE catch_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE map_shares ENABLE ROW LEVEL SECURITY;

-- PROFILES : l'utilisateur voit/modifie uniquement son profil
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- CATCHES : l'utilisateur voit ses prises + celles des cartes partagées
CREATE POLICY "Users can view own catches"
  ON catches FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can view shared catches"
  ON catches FOR SELECT
  USING (
    map_id IN (
      SELECT map_id FROM map_shares
      WHERE shared_with = auth.uid() AND accepted = TRUE
    )
  );

CREATE POLICY "Users can insert own catches"
  ON catches FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own catches"
  ON catches FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own catches"
  ON catches FOR DELETE
  USING (user_id = auth.uid());

-- CATCH_MEDIA : suit les mêmes règles que catches
CREATE POLICY "Users can manage own catch media"
  ON catch_media FOR ALL
  USING (
    catch_id IN (SELECT id FROM catches WHERE user_id = auth.uid())
  );

-- MAPS : propriétaire ou partagé
CREATE POLICY "Users can view own maps"
  ON maps FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY "Users can view shared maps"
  ON maps FOR SELECT
  USING (
    id IN (
      SELECT map_id FROM map_shares
      WHERE shared_with = auth.uid() AND accepted = TRUE
    )
  );

CREATE POLICY "Users can view public maps"
  ON maps FOR SELECT
  USING (type = 'public');

CREATE POLICY "Users can manage own maps"
  ON maps FOR ALL
  USING (owner_id = auth.uid());

-- MAP_SHARES : visible par le partageur et le destinataire
CREATE POLICY "Users can view own shares"
  ON map_shares FOR SELECT
  USING (shared_by = auth.uid() OR shared_with = auth.uid());

CREATE POLICY "Users can create shares for own maps"
  ON map_shares FOR INSERT
  WITH CHECK (
    shared_by = auth.uid()
    AND map_id IN (SELECT id FROM maps WHERE owner_id = auth.uid())
  );
```

---

## Migrations

```sql
-- Ajout des colonnes météo détaillées (v2)
ALTER TABLE catches ADD COLUMN IF NOT EXISTS wind_direction_deg INTEGER;
ALTER TABLE catches ADD COLUMN IF NOT EXISTS weather_conditions TEXT;

-- Lien vers le voyage local (v3)
ALTER TABLE catches ADD COLUMN IF NOT EXISTS trip_id TEXT;
```

---

## Storage Buckets

```sql
-- Créer le bucket pour les photos/vidéos (dans Supabase Dashboard > Storage)
-- Nom : catch-media
-- Public : false
-- Taille max : 50MB
-- Types acceptés : image/jpeg, image/png, image/heic, video/mp4, video/quicktime
```

---

## Fonctions utilitaires

```sql
-- Statistiques rapides d'un utilisateur
CREATE OR REPLACE FUNCTION get_user_stats(p_user_id UUID)
RETURNS JSON AS $$
  SELECT json_build_object(
    'total_catches', COUNT(*),
    'total_lakes', COUNT(DISTINCT lake_name),
    'max_weight_lbs', MAX(weight_lbs),
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

-- Prises par mois (pour le graphique)
CREATE OR REPLACE FUNCTION get_catches_by_month(p_user_id UUID, p_months INT DEFAULT 12)
RETURNS TABLE(month TEXT, count BIGINT) AS $$
  SELECT
    TO_CHAR(caught_at, 'YYYY-MM') as month,
    COUNT(*) as count
  FROM catches
  WHERE user_id = p_user_id
    AND caught_at >= NOW() - (p_months || ' months')::INTERVAL
  GROUP BY TO_CHAR(caught_at, 'YYYY-MM')
  ORDER BY month;
$$ LANGUAGE sql SECURITY DEFINER;
```
