# DATABASE.md — PêcheLog : Schéma de base de données

> Schéma SQL pour Supabase (PostgreSQL).
> Copier dans Supabase > SQL Editor > New Query > Run

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

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
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
