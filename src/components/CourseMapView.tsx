import { StyleProp, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

interface Props {
  lat:   number;
  lng:   number;
  style?: StyleProp<ViewStyle>;
}

export default function CourseMapView({ lat, lng, style }: Props) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body, #map { width: 100%; height: 100%; background: #111; }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        var map = L.map('map', {
          zoomControl:       false,
          attributionControl: false,
          dragging:          false,
          touchZoom:         false,
          scrollWheelZoom:   false,
          doubleClickZoom:   false,
          boxZoom:           false,
          keyboard:          false,
        }).setView([${lat}, ${lng}], 15);

        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          { maxZoom: 18 }
        ).addTo(map);
      </script>
    </body>
    </html>
  `;

  return (
    <WebView
      source={{ html }}
      style={style as any}
      scrollEnabled={false}
      bounces={false}
      originWhitelist={['*']}
    />
  );
}
