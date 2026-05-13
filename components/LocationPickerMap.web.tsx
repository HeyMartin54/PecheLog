import { useEffect, useRef, useState } from 'react';

// Chargement dynamique pour éviter les erreurs SSR
let MapContainer: any = null;
let TileLayer: any = null;
let LeafletMarker: any = null;
let useMapEvents: any = null;

if (typeof window !== 'undefined') {
  const RL = require('react-leaflet');
  MapContainer = RL.MapContainer;
  TileLayer = RL.TileLayer;
  LeafletMarker = RL.Marker;
  useMapEvents = RL.useMapEvents;
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
  onCoordinateChange: (coord: Coord) => void;
  height?: number;
};

function MapClickHandler({ onPress }: { onPress: (coord: Coord) => void }) {
  useMapEvents({
    click(e: any) {
      onPress({ latitude: e.latlng.lat, longitude: e.latlng.lng });
    },
  });
  return null;
}

function makePinIcon() {
  const L = require('leaflet');
  return L.divIcon({
    className: '',
    html: `<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:grab"><div style="width:26px;height:26px;border-top-left-radius:13px;border-top-right-radius:13px;border-bottom-right-radius:13px;border-bottom-left-radius:0;transform:rotate(-45deg);background:#00D4AA;box-shadow:0 2px 6px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;"><div style="width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,0.85);"></div></div></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -36],
  });
}

export default function LocationPickerMap({ coordinate, onCoordinateChange, height }: Props) {
  const [leafletReady, setLeafletReady] = useState(false);
  const [satellite, setSatellite] = useState(true);
  const markerRef = useRef<any>(null);

  // Injecter le CSS Leaflet (réutilise le même tag que map.web.tsx)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (document.getElementById('leaflet-css')) {
      setLeafletReady(true);
      return;
    }
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
    <div style={{ width: '100%', height: height ? `${height}px` : '100%', position: 'relative' }}>
      <MapContainer
        center={[coordinate.latitude, coordinate.longitude]}
        zoom={13}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer url={tiles.url} attribution={tiles.attribution} />
        <MapClickHandler onPress={onCoordinateChange} />
        <LeafletMarker
          position={[coordinate.latitude, coordinate.longitude]}
          draggable
          icon={makePinIcon()}
          ref={markerRef}
          eventHandlers={{
            dragend() {
              const latlng = markerRef.current?.getLatLng();
              if (latlng) {
                onCoordinateChange({ latitude: latlng.lat, longitude: latlng.lng });
              }
            },
          }}
        />
      </MapContainer>

      <button
        onClick={() => setSatellite((v) => !v)}
        style={{
          position: 'absolute',
          bottom: 14,
          right: 14,
          zIndex: 1000,
          background: 'rgba(6,20,37,0.88)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 20,
          padding: '7px 14px',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        {satellite ? '🗺 Carte' : '🛰 Satellite'}
      </button>
    </div>
  );
}
