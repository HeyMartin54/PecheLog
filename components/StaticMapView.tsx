import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

type Coord = { latitude: number; longitude: number };

type Props = {
  coordinate: Coord;
  height?: number;
  /** Si fourni, un overlay tappable ouvre l'action (ex: modifier la position) */
  onPress?: () => void;
};

export default function StaticMapView({ coordinate, height = 180, onPress }: Props) {
  const [satellite, setSatellite] = useState(true);

  return (
    <View style={[styles.container, { height }]}>
      <MapView
        style={StyleSheet.absoluteFill}
        mapType={satellite ? 'hybrid' : 'standard'}
        region={{
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
          latitudeDelta: 0.004,
          longitudeDelta: 0.004,
        }}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        <Marker coordinate={coordinate} pinColor="#00D4AA" />
      </MapView>

      {/* Overlay tappable pour modifier la position (z-index 1) */}
      {onPress && (
        <TouchableOpacity
          style={[StyleSheet.absoluteFill, styles.overlay]}
          onPress={onPress}
          activeOpacity={1}
        />
      )}

      {/* Badge "Modifier" en haut à droite (z-index 2, au-dessus de l'overlay) */}
      {onPress && (
        <View style={styles.editBadge}>
          <Text style={styles.editBadgeText}>✏️ Modifier</Text>
        </View>
      )}

      {/* Toggle satellite / carte (z-index 2, au-dessus de l'overlay) */}
      <TouchableOpacity
        style={styles.toggleBtn}
        onPress={() => setSatellite((v) => !v)}
        activeOpacity={0.85}
      >
        <Text style={styles.toggleText}>{satellite ? '🗺 Carte' : '🛰 Satellite'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
  },
  overlay: {
    zIndex: 1,
  },
  editBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 2,
    backgroundColor: 'rgba(0,212,170,0.88)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  editBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  toggleBtn: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    zIndex: 2,
    backgroundColor: 'rgba(6,20,37,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  toggleText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
});
