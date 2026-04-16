-- ─── Migration : Table lures + seed data ──────────────────────────────────────
-- Exécuter dans le SQL Editor de Supabase (ou via supabase db push).
-- Cette table sert de catalogue de référence pour les leurres de pêche.

-- ─── 1. Création de la table ──────────────────────────────────────────────────
create table if not exists public.lures (
  id          text        primary key,          -- ex: 'rapala-xrap-10'
  name        text        not null,
  brand       text        not null default '',
  category    text        not null,
  emoji       text        not null default '🪝',
  color       text        not null default '#4BAEE8',
  bg_color    text        not null default 'rgba(75,174,232,0.15)',
  photo_url   text,                             -- Wikimedia Commons ou null
  is_custom   boolean     not null default false,
  created_at  timestamptz not null default now()
);

-- ─── 2. Row Level Security ────────────────────────────────────────────────────
alter table public.lures enable row level security;

-- Tout le monde peut lire le catalogue
create policy "Catalogue leurres lisible par tous"
  on public.lures for select
  using (true);

-- Seul le service role peut insérer/modifier (seed via SQL editor)
-- Les leurres custom sont gérés côté app dans profiles.custom_lures (jsonb)

-- ─── 3. Index ─────────────────────────────────────────────────────────────────
create index if not exists lures_category_idx on public.lures (category);
create index if not exists lures_name_idx     on public.lures using gin (to_tsvector('french', name || ' ' || brand));

-- ─── 4. Seed data ─────────────────────────────────────────────────────────────
insert into public.lures (id, name, brand, category, emoji, color, bg_color, photo_url)
values

-- Cuillères tournantes
('mepps-aglia-2-argent',        'Aglia #2 Argent',           'Mepps',         'Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)', null),
('mepps-aglia-3-or',            'Aglia #3 Or',               'Mepps',         'Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)', null),
('mepps-black-fury-2',          'Black Fury #2',             'Mepps',         'Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)', null),
('mepps-aglia-long-3',          'Aglia Long #3',             'Mepps',         'Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)', null),
('mepps-lusox-1',               'Lusox #1',                  'Mepps',         'Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)', null),
('bluefox-vibrax-3',            'Vibrax #3',                 'Blue Fox',      'Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)', null),
('bluefox-vibrax-4',            'Vibrax #4',                 'Blue Fox',      'Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)', null),
('panther-martin-6',            'Panther Martin #6',         'Panther Martin','Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)', null),
('panther-martin-9',            'Panther Martin #9',         'Panther Martin','Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)', null),
('roostertail-1-8',             'Rooster Tail 1/8 oz',       'Worden''s',     'Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)', null),
('roostertail-1-4',             'Rooster Tail 1/4 oz',       'Worden''s',     'Cuillère tournante', '🌀', '#F5A623', 'rgba(245,166,35,0.15)', null),

-- Cuillères ondulantes
('williams-wobbler-w50',        'Wobbler W50',               'Williams',      'Cuillère ondulante', '🥄', '#C0C0C0', 'rgba(192,192,192,0.15)', null),
('williams-wobbler-w60',        'Wobbler W60',               'Williams',      'Cuillère ondulante', '🥄', '#C0C0C0', 'rgba(192,192,192,0.15)', null),
('dardevle-1oz',                'Dardevle 1 oz',             'Eppinger',      'Cuillère ondulante', '🥄', '#C0C0C0', 'rgba(192,192,192,0.15)', null),
('dardevle-1-2oz',              'Dardevle 1/2 oz',           'Eppinger',      'Cuillère ondulante', '🥄', '#C0C0C0', 'rgba(192,192,192,0.15)', null),
('kastmaster-1-2',              'Kastmaster 1/2 oz',         'Acme',          'Cuillère ondulante', '🥄', '#C0C0C0', 'rgba(192,192,192,0.15)', null),
('little-cleo-3-4',             'Little Cleo 3/4 oz',        'Acme',          'Cuillère ondulante', '🥄', '#C0C0C0', 'rgba(192,192,192,0.15)', null),
('krocodile-3-8',               'Krocodile 3/8 oz',          'Luhr-Jensen',   'Cuillère ondulante', '🥄', '#C0C0C0', 'rgba(192,192,192,0.15)', null),
('doctor-spoon',                'Doctor Spoon',              'Williams',      'Cuillère ondulante', '🥄', '#C0C0C0', 'rgba(192,192,192,0.15)', null),

-- Poissons nageurs
('rapala-original-7',           'Original Floater 7 cm',     'Rapala',        'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  null),
('rapala-original-9',           'Original Floater 9 cm',     'Rapala',        'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  null),
('rapala-xrap-10',              'X-Rap 10',                  'Rapala',        'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  null),
('rapala-shad-rap-sr7',         'Shad Rap SR7',              'Rapala',        'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  null),
('rapala-husky-jerk-10',        'Husky Jerk 10',             'Rapala',        'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  null),
('rapala-countdown-7',          'Countdown 7',               'Rapala',        'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  null),
('rapala-dt6',                  'DT-6',                      'Rapala',        'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  null),
('storm-thunderstick',          'ThunderStick',              'Storm',         'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  null),
('rebel-crawfish',              'Crawfish',                  'Rebel',         'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  null),
('yozuri-crystal-minnow',       'Crystal Minnow 9 cm',       'Yo-Zuri',       'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  null),
('berkley-flicker-shad',        'Flicker Shad 5 cm',         'Berkley',       'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  null),
('cordell-redfin',              'Red Fin',                   'Cotton Cordell','Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  null),
('lucky-craft-lvr-d7',          'LVR D-7',                   'Lucky Craft',   'Poisson nageur',     '🐟', '#4BAEE8', 'rgba(75,174,232,0.15)',  null),

-- Surface
('heddon-zara-spook',           'Zara Spook',                'Heddon',        'Surface',            '💧', '#00D4AA', 'rgba(0,212,170,0.15)',   null),
('heddon-torpedo',              'Baby Torpedo',              'Heddon',        'Surface',            '💧', '#00D4AA', 'rgba(0,212,170,0.15)',   null),
('hula-popper',                 'Hula Popper',               'Arbogast',      'Surface',            '💧', '#00D4AA', 'rgba(0,212,170,0.15)',   null),
('arbogast-jitterbug',          'Jitterbug',                 'Arbogast',      'Surface',            '💧', '#00D4AA', 'rgba(0,212,170,0.15)',   null),
('rebel-popr',                  'Pop-R',                     'Rebel',         'Surface',            '💧', '#00D4AA', 'rgba(0,212,170,0.15)',   null),
('river2sea-whopper-plopper',   'Whopper Plopper 90',        'River2Sea',     'Surface',            '💧', '#00D4AA', 'rgba(0,212,170,0.15)',   null),
('rapala-skitter-pop',          'Skitter Pop 7',             'Rapala',        'Surface',            '💧', '#00D4AA', 'rgba(0,212,170,0.15)',   null),
('strike-king-sexy-frog',       'KVD Sexy Frog',             'Strike King',   'Surface',            '💧', '#00D4AA', 'rgba(0,212,170,0.15)',   null),
('booyah-pad-crasher',          'Pad Crasher',               'Booyah',        'Surface',            '💧', '#00D4AA', 'rgba(0,212,170,0.15)',   null),

-- Jigs
('jig-marabou-blanc-1-4',       'Jig Marabou Blanc 1/4 oz',      'Générique', 'Jig', '🎣', '#C77DDB', 'rgba(199,125,219,0.15)', null),
('jig-marabou-chartreuse-1-4',  'Jig Marabou Chartreuse 1/4 oz', 'Générique', 'Jig', '🎣', '#C77DDB', 'rgba(199,125,219,0.15)', null),
('jig-tube-1-4',                'Jig Tube 1/4 oz',               'Générique', 'Jig', '🎣', '#C77DDB', 'rgba(199,125,219,0.15)', null),
('jig-tube-3-8',                'Jig Tube 3/8 oz',               'Générique', 'Jig', '🎣', '#C77DDB', 'rgba(199,125,219,0.15)', null),
('jig-curly-tail-1-4',          'Jig Curly Tail 1/4 oz',         'Générique', 'Jig', '🎣', '#C77DDB', 'rgba(199,125,219,0.15)', null),
('jig-bucktail-1-2',            'Jig Bucktail 1/2 oz',           'Générique', 'Jig', '🎣', '#C77DDB', 'rgba(199,125,219,0.15)', null),
('swim-jig-3-8',                'Swim Jig 3/8 oz',               'Z-Man',     'Jig', '🎣', '#C77DDB', 'rgba(199,125,219,0.15)', null),
('football-jig-3-4',            'Football Jig 3/4 oz',           'Générique', 'Jig', '🎣', '#C77DDB', 'rgba(199,125,219,0.15)', null),
('ned-rig-1-10',                'Ned Rig 1/10 oz',               'Z-Man',     'Jig', '🎣', '#C77DDB', 'rgba(199,125,219,0.15)', null),
('blade-bait-3-8',              'Blade Bait 3/8 oz',             'Générique', 'Jig', '🎣', '#C77DDB', 'rgba(199,125,219,0.15)', null),

-- Leurres souples
('berkley-powerbait-minnow',    'PowerBait Minnow 3"',      'Berkley',       'Leurre souple', '🪱', '#3DBA78', 'rgba(61,186,120,0.15)', null),
('berkley-gulp-minnow',         'Gulp Alive Minnow 3"',     'Berkley',       'Leurre souple', '🪱', '#3DBA78', 'rgba(61,186,120,0.15)', null),
('berkley-gulp-crawdad',        'Gulp Crawdad 2"',          'Berkley',       'Leurre souple', '🪱', '#3DBA78', 'rgba(61,186,120,0.15)', null),
('zoom-trick-worm',             'Trick Worm 6"',            'Zoom',          'Leurre souple', '🪱', '#3DBA78', 'rgba(61,186,120,0.15)', null),
('gary-yamamoto-senko-4',       'Senko 4"',                 'Gary Yamamoto', 'Leurre souple', '🪱', '#3DBA78', 'rgba(61,186,120,0.15)', null),
('keitech-swing-impact',        'Swing Impact 3.5"',        'Keitech',       'Leurre souple', '🪱', '#3DBA78', 'rgba(61,186,120,0.15)', null),
('strike-king-rage-craw',       'Rage Craw 4"',             'Strike King',   'Leurre souple', '🪱', '#3DBA78', 'rgba(61,186,120,0.15)', null),
('paddle-tail-swimbait-4',      'Swimbait Paddle Tail 4"',  'Générique',     'Leurre souple', '🪱', '#3DBA78', 'rgba(61,186,120,0.15)', null),
('tube-4',                      'Tube Plastique 4"',        'Générique',     'Leurre souple', '🪱', '#3DBA78', 'rgba(61,186,120,0.15)', null),
('grub-3',                      'Grub 3"',                  'Générique',     'Leurre souple', '🪱', '#3DBA78', 'rgba(61,186,120,0.15)', null),
('zman-chatterbait',            'ChatterBait 3/8 oz',       'Z-Man',         'Leurre souple', '🪱', '#3DBA78', 'rgba(61,186,120,0.15)', null),

-- Mouches
('mouche-adams',                'Adams',               'Mouche sèche', 'Mouche', '🦋', '#FFD700', 'rgba(255,215,0,0.15)', null),
('mouche-elk-hair-caddis',      'Elk Hair Caddis',     'Mouche sèche', 'Mouche', '🦋', '#FFD700', 'rgba(255,215,0,0.15)', null),
('mouche-hares-ear',            'Hare''s Ear',         'Nymphe',       'Mouche', '🦋', '#FFD700', 'rgba(255,215,0,0.15)', null),
('mouche-pheasant-tail',        'Pheasant Tail',       'Nymphe',       'Mouche', '🦋', '#FFD700', 'rgba(255,215,0,0.15)', null),
('muddler-minnow',              'Muddler Minnow',      'Streamer',     'Mouche', '🦋', '#FFD700', 'rgba(255,215,0,0.15)', null),
('woolly-bugger-noir',          'Woolly Bugger (noir)','Streamer',     'Mouche', '🦋', '#FFD700', 'rgba(255,215,0,0.15)', null),
('woolly-bugger-olive',         'Woolly Bugger (olive)','Streamer',    'Mouche', '🦋', '#FFD700', 'rgba(255,215,0,0.15)', null),
('zonker',                      'Zonker',              'Streamer',     'Mouche', '🦋', '#FFD700', 'rgba(255,215,0,0.15)', null),
('popper-mouche',               'Popper en foam',      'Mouche',       'Mouche', '🦋', '#FFD700', 'rgba(255,215,0,0.15)', null),

-- Naturel
('ver-de-terre',                'Ver de terre',              'Naturel', 'Naturel', '🪱', '#A0785A', 'rgba(160,120,90,0.15)', null),
('minnow-ventre-jaune',         'Minnow (ventre jaune)',     'Naturel', 'Naturel', '🐠', '#A0785A', 'rgba(160,120,90,0.15)', null),
('sangsue',                     'Sangsue',                   'Naturel', 'Naturel', '🪱', '#A0785A', 'rgba(160,120,90,0.15)', null),
('grenouille',                  'Grenouille',                'Naturel', 'Naturel', '🐸', '#A0785A', 'rgba(160,120,90,0.15)', null),
('ecrevisse',                   'Écrevisse',                 'Naturel', 'Naturel', '🦞', '#A0785A', 'rgba(160,120,90,0.15)', null),
('maggot',                      'Vers à fraise (maggot)',    'Naturel', 'Naturel', '🪱', '#A0785A', 'rgba(160,120,90,0.15)', null)

on conflict (id) do nothing;

-- ─── Fin de migration ──────────────────────────────────────────────────────────
-- Pour ajouter un leurre custom par un utilisateur, utiliser le champ JSONB
-- profiles.custom_lures (voir profil). Ne pas insérer dans cette table côté client.
