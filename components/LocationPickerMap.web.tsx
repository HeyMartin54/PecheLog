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

type Coord = { latitude: number; longitude: number };

type Props = {
  coordinate: Coord;
  onCoordinateChange: (coord: Coord) => void;
};

// Capture les clics sur la carte pour déplacer le marqueur
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
    html: `<div style="
      width:34px;height:34px;border-radius:50%;
      background:#00D4AA;border:2.5px solid #fff;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 8px rgba(0,0,0,0.5);
      font-size:17px;line-height:34px;text-align:center;
      cursor:grab;
    ">📍</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

export default function LocationPickerMap({ coordinate, onCoordinateChange }: Props) {
  const [leafletReady, setLeafletReady] = useState(false);
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

  return (
    <div style={{ flex: 1, width: '100%', height: '100%' }}>
      <MapContainer
        center={[coordinate.latitude, coordinate.longitude]}
        zoom={13}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
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
    </div>
  );
}
