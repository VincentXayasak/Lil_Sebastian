import { StatusBar } from 'expo-status-bar';
import {
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

export default function App() {
  const { width } = useWindowDimensions();
  const squareSize = Math.min(width * 0.42, 168);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.safeTop} />

      <View style={styles.searchBar} accessibilityRole="search">
        <Text style={styles.searchPlaceholder}>Search podcasts</Text>
      </View>

      <View style={styles.middleRow}>
        <View style={[styles.recentSquare, { width: squareSize, height: squareSize }]}>
          <Text style={styles.cardLabel}>Recently listened</Text>
          <Text style={styles.cardHint}>Podcast art / title</Text>
        </View>

        <View style={styles.cityPanel}>
          <Text style={styles.cityCardLabel}>Subscribed city</Text>
          <Text style={styles.cityName}>Your city</Text>
        </View>
      </View>

      <View style={styles.bottomPanel}>
        <Text style={styles.cardLabel}>Recent in your cities</Text>
        <Text style={styles.cardHint}>Episodes from cities you follow will appear here</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f4f1ec',
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  safeTop: {
    height: Platform.select({ ios: 52, android: 12, default: 12 }),
  },
  searchBar: {
    height: 52,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e0d8',
    justifyContent: 'center',
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  searchPlaceholder: {
    fontSize: 16,
    color: '#9a9288',
  },
  middleRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 20,
    gap: 14,
  },
  recentSquare: {
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e0d8',
    padding: 14,
    justifyContent: 'flex-end',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  cityPanel: {
    flex: 1,
    minHeight: 168,
    borderRadius: 16,
    backgroundColor: '#2c2824',
    padding: 16,
    justifyContent: 'flex-end',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: '#8a8278',
    marginBottom: 6,
  },
  cityCardLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: '#a39e96',
    marginBottom: 6,
  },
  cityName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f4f1ec',
  },
  cardHint: {
    fontSize: 14,
    color: '#6b645c',
    lineHeight: 20,
  },
  bottomPanel: {
    flex: 1,
    marginTop: 20,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e0d8',
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
});
