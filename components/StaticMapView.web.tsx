import { useEffect, useState } from 'react';

let MapContainer: any = null;
let TileLayer: any = null;
let LeafletMarker: any = null;

if (typeof window !== 'undefined') {
  const RL = require('react-leaflet');
  MapContainer = RL.MapContainer;
  TileLayer = RL.TileLayer;
  LeafletMarker = RL.Marker;
}

const TILES = {
  standard: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; <a href="https://www.esri.com">Esri</a>',
  },
};

type Coord = { latitude: number; longitude: number };

type Props = {
  coordinate: Coord;
  height?: number;
  onPress?: () => void;
};

function makePinIcon() {
  const L = require('leaflet');
  return L.divIcon({
    className: '',
    html: `<div style="width:28px;height:28px;border-radius:50%;background:#00D4AA;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.5);font-size:14px;line-height:28px;text-align:center;">📍</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

export default function StaticMapView({ coordinate, height = 180, onPress }: Props) {
  const [leafletReady, setLeafletReady] = useState(false);
  const [satellite, setSatellite] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (document.getElementById('leaflet-css')) { setLeafletReady(true); return; }
    const link = document.createElement('link');
    link.id = 'leaflet-css';
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    link.onload = () => setLeafletReady(true);
    document.head.appendChild(link);
  }, []);

  if (!leafletReady || !MapContainer) return null;

  const tiles = satellite ? TILES.satellite : TILES.standard;

  return (
    <div style={{ position: 'relative', height, borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
      <MapContainer
        center={[coordinate.latitude, coordinate.longitude]}
        zoom={15}
        style={{ width: '100%', height: '100%' }}
        dragging={false}
        zoomControl={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        keyboard={false}
        attributionControl={false}
      >
        <TileLayer url={tiles.url} attribution={tiles.attribution} />
        <LeafletMarker
          position={[coordinate.latitude, coordinate.longitude]}
          icon={makePinIcon()}
        />
      </MapContainer>

      {/* Overlay tappable */}
      {onPress && (
        <div
          onClick={onPress}
          style={{ position: 'absolute', inset: 0, zIndex: 500, cursor: 'pointer' }}
        />
      )}

      {/* Badge "Modifier" */}
      {onPress && (
        <div style={{
          position: 'absolute', top: 10, right: 10, zIndex: 1000,
          background: 'rgba(0,212,170,0.88)', color: '#fff',
          borderRadius: 12, padding: '4px 10px',
          fontSize: 11, fontWeight: 600, pointerEvents: 'none',
        }}>
          ✏️ Modifier
        </div>
      )}

      {/* Toggle satellite / carte */}
      <button
        onClick={() => setSatellite((v) => !v)}
        style={{
          position: 'absolute', bottom: 10, right: 10, zIndex: 1000,
          background: 'rgba(6,20,37,0.85)', color: '#fff',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 16, padding: '5px 12px',
          fontSize: 12, fontWeight: 500, cursor: 'pointer',
        }}
      >
        {satellite ? '🗺 Carte' : '🛰 Satellite'}
      </button>
    </div>
  );
}
