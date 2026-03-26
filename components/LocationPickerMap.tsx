import { useState } from 'react';
import { StyleSheet, TouchableOpacity, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

type Coord = { latitude: number; longitude: number };

type Props = {
  coordinate: Coord;
  onCoordinateChange: (coord: Coord) => void;
};

export default function LocationPickerMap({ coordinate, onCoordinateChange }: Props) {
  const [satellite, setSatellite] = useState(true);

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        mapType={satellite ? 'hybrid' : 'standard'}
        initialRegion={{
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}
        onPress={(e) => onCoordinateChange(e.nativeEvent.coordinate)}
        showsUserLocation
      >
        <Marker
          coordinate={coordinate}
          draggable
          onDragEnd={(e) => onCoordinateChange(e.nativeEvent.coordinate)}
          pinColor="#00D4AA"
        />
      </MapView>

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
  container: { flex: 1 },
  map: { flex: 1 },
  toggleBtn: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    backgroundColor: 'rgba(6,20,37,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  toggleText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
});
