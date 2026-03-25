import { StyleSheet } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

type Coord = { latitude: number; longitude: number };

type Props = {
  coordinate: Coord;
  onCoordinateChange: (coord: Coord) => void;
};

export default function LocationPickerMap({ coordinate, onCoordinateChange }: Props) {
  return (
    <MapView
      style={styles.map}
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
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
});
