import { Audio, type AVPlaybackStatus } from 'expo-av';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { cacheRemoteAudioForPlayback } from './lib/cacheRemoteAudio';
import { createEpisodePlaybackUrl } from './lib/episodeSignedAudioUrl';
import { supabase } from './lib/supabase';

type EpisodeRow = {
  id: string;
  title: string;
  storage_path: string;
};

function normalizeStoragePath(path: string): string {
  return path.replace(/^\/+/, '');
}

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function App() {
  const { width } = useWindowDimensions();
  const squareSize = Math.min(width * 0.42, 168);

  const [episodes, setEpisodes] = useState<EpisodeRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);

  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  /** Episode currently loaded in memory (play or paused). */
  const [activeEpisode, setActiveEpisode] = useState<EpisodeRow | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);
  const [loadingEpisodeId, setLoadingEpisodeId] = useState<string | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubMillis, setScrubMillis] = useState(0);
  const isScrubbingRef = useRef(false);
  const wasPlayingBeforeScrubRef = useRef(false);

  useEffect(() => {
    isScrubbingRef.current = isScrubbing;
  }, [isScrubbing]);

  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  useEffect(() => {
    void Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      staysActiveInBackground: false,
    });
  }, []);

  useEffect(() => {
    return () => {
      void soundRef.current?.unloadAsync();
      soundRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!process.env.EXPO_PUBLIC_SUPABASE_URL?.length) {
        setListError('Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to app/.env');
        setListLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('episodes')
        .select('id, title, storage_path')
        .order('id', { ascending: true });
      if (cancelled) return;
      if (error) setListError(error.message);
      else setEpisodes((data ?? []) as EpisodeRow[]);
      setListLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const unloadPlayer = useCallback(async () => {
    const current = soundRef.current;
    if (current) {
      await current.unloadAsync();
    }
    setSound(null);
    soundRef.current = null;
    setActiveEpisode(null);
    setIsPlaying(false);
    setPositionMillis(0);
    setDurationMillis(0);
    setLoadingEpisodeId(null);
    setIsScrubbing(false);
  }, []);

  const attachPlaybackWatcher = useCallback((instance: Audio.Sound) => {
    instance.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
      if (!status.isLoaded) return;
      if (!isScrubbingRef.current) {
        setPositionMillis(status.positionMillis ?? 0);
      }
      setDurationMillis(status.durationMillis ?? 0);
      setIsPlaying(status.isPlaying ?? false);
      if (status.didJustFinish) {
        setIsPlaying(false);
      }
    });
  }, []);

  const loadAndPlayEpisode = useCallback(
    async (episode: EpisodeRow) => {
      setPlayError(null);
      const path = normalizeStoragePath(episode.storage_path);

      try {
        if (soundRef.current) {
          await soundRef.current.unloadAsync();
          soundRef.current = null;
          setSound(null);
        }

        setLoadingEpisodeId(episode.id);
        const signedUrl = await createEpisodePlaybackUrl(path);
        const localUri = await cacheRemoteAudioForPlayback(signedUrl, episode.id);

        const { sound: next } = await Audio.Sound.createAsync(
          { uri: localUri },
          { shouldPlay: true, progressUpdateIntervalMillis: 250 }
        );
        attachPlaybackWatcher(next);

        const st = await next.getStatusAsync();
        if (st.isLoaded && !st.isPlaying) {
          await next.playAsync();
        }

        soundRef.current = next;
        setSound(next);
        setActiveEpisode(episode);
        setLoadingEpisodeId(null);
      } catch (e) {
        setLoadingEpisodeId(null);
        const msg = e instanceof Error ? e.message : String(e);
        console.error('Playback error:', e);
        setPlayError(
          `Could not play: ${msg}. Private buckets need Storage SELECT policy for anon (see supabase_sql/storage_podcasts_private_read.sql).`
        );
        await unloadPlayer();
      }
    },
    [attachPlaybackWatcher, unloadPlayer]
  );

  const toggleEpisode = useCallback(
    async (episode: EpisodeRow) => {
      const currentSound = soundRef.current;

      if (activeEpisode?.id === episode.id && currentSound) {
        try {
          const st = await currentSound.getStatusAsync();
          if (!st.isLoaded) return;

          const atEnd =
            st.durationMillis != null &&
            st.positionMillis != null &&
            st.positionMillis >= st.durationMillis - 400;

          if (st.isPlaying) {
            await currentSound.pauseAsync();
            return;
          }

          if (atEnd) {
            await currentSound.setPositionAsync(0);
          }
          await currentSound.playAsync();
        } catch (err) {
          console.error('toggleEpisode', err);
        }
        return;
      }

      await loadAndPlayEpisode(episode);
    },
    [activeEpisode?.id, loadAndPlayEpisode]
  );

  const onSlidingComplete = useCallback(async (value: number) => {
    const current = soundRef.current;
    if (!current || !durationMillis) {
      setIsScrubbing(false);
      return;
    }
    try {
      await current.setPositionAsync(value);
      if (wasPlayingBeforeScrubRef.current) {
        await current.playAsync();
      }
    } finally {
      setIsScrubbing(false);
      wasPlayingBeforeScrubRef.current = false;
    }
  }, [durationMillis]);

  const sliderMax = durationMillis > 0 ? durationMillis : 1;
  const sliderValue =
    durationMillis <= 0 ? 0 : isScrubbing ? Math.min(Math.max(scrubMillis, 0), sliderMax) : positionMillis;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.safeTop} />

      <View style={styles.searchBar} accessibilityRole="search">
        <Text style={styles.searchPlaceholder}>Search city</Text>
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
        <Text style={styles.cardLabel}>Episodes</Text>
        {playError != null && playError !== '' ? <Text style={styles.errorText}>{playError}</Text> : null}
        {listLoading && <ActivityIndicator style={styles.loader} />}
        {listError != null && listError !== '' ? (
          <Text style={styles.errorText}>{listError}</Text>
        ) : null}
        {!listLoading && !listError && episodes.length === 0 ? (
          <Text style={styles.cardHint}>No episodes in the database yet.</Text>
        ) : null}

        <FlatList
          style={styles.episodeList}
          data={episodes}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const isActive = sound != null && activeEpisode?.id === item.id && loadingEpisodeId == null;
            const isLoadingRow = loadingEpisodeId === item.id;
            let action = 'Play';
            if (isLoadingRow) action = '…';
            else if (isActive) action = isPlaying ? 'Pause' : 'Resume';
            return (
              <Pressable
                style={({ pressed }) => [styles.episodeRow, pressed && styles.episodeRowPressed]}
                onPress={() => void toggleEpisode(item)}
                disabled={isLoadingRow}
              >
                <Text style={styles.episodeTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                {isLoadingRow ? (
                  <ActivityIndicator size="small" color="#027525" />
                ) : (
                  <Text style={styles.episodeAction}>{action}</Text>
                )}
              </Pressable>
            );
          }}
          ListFooterComponent={<View style={styles.listFooter} />}
        />
      </View>

      {activeEpisode != null && sound != null && (
        <View style={styles.playerBar}>
          <View style={styles.playerTopRow}>
            <Text style={styles.playerTitle} numberOfLines={2}>
              {activeEpisode.title}
            </Text>
            <Pressable
              onPress={() => void unloadPlayer()}
              style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
              hitSlop={10}
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>
          <Slider
            key={`slider-${activeEpisode.id}`}
            style={styles.slider}
            minimumValue={0}
            maximumValue={sliderMax}
            value={sliderValue}
            onSlidingStart={async () => {
              const current = soundRef.current;
              if (current) {
                const st = await current.getStatusAsync();
                wasPlayingBeforeScrubRef.current = st.isLoaded ? st.isPlaying : false;
              } else {
                wasPlayingBeforeScrubRef.current = false;
              }
              setIsScrubbing(true);
              setScrubMillis(positionMillis);
              if (current && wasPlayingBeforeScrubRef.current) {
                await current.pauseAsync();
              }
            }}
            onValueChange={(v) => {
              setScrubMillis(v);
            }}
            onSlidingComplete={onSlidingComplete}
            minimumTrackTintColor="#027525"
            maximumTrackTintColor="#b8dfc4"
            thumbTintColor="#027525"
            disabled={loadingEpisodeId != null || durationMillis <= 0}
          />
          <View style={styles.timeRow}>
            <Text style={styles.timeText}>{formatTime(isScrubbing ? scrubMillis : positionMillis)}</Text>
            <Text style={styles.timeText}>{formatTime(durationMillis)}</Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.playerPlayBtn, pressed && styles.playerPlayBtnPressed]}
            onPress={() => void toggleEpisode(activeEpisode)}
          >
            <Text style={styles.playerPlayBtnText}>{isPlaying ? 'Pause' : 'Play'}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f0faf3',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  safeTop: {
    height: Platform.select({ ios: 52, android: 12, default: 12 }),
  },
  searchBar: {
    height: 52,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#b8dfc4',
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
    color: '#6aaa82',
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
    borderColor: '#b8dfc4',
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
    backgroundColor: '#027525',
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
    color: '#5a9970',
    marginBottom: 6,
  },
  cityCardLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: '#7db894',
    marginBottom: 6,
  },
  cityName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f0faf3',
  },
  cardHint: {
    fontSize: 14,
    color: '#3d7a55',
    lineHeight: 20,
  },
  bottomPanel: {
    flex: 1,
    marginTop: 20,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#b8dfc4',
    padding: 18,
    paddingBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  loader: {
    marginTop: 12,
  },
  errorText: {
    marginTop: 8,
    fontSize: 14,
    color: '#a33',
    lineHeight: 20,
  },
  episodeList: {
    flex: 1,
    marginTop: 8,
    marginHorizontal: -6,
  },
  episodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#c5e6d2',
    backgroundColor: '#f5fcf8',
    marginBottom: 8,
    gap: 12,
  },
  episodeRowPressed: {
    opacity: 0.85,
  },
  episodeTitle: {
    flex: 1,
    fontSize: 15,
    color: '#027525',
    fontWeight: '600',
  },
  episodeAction: {
    fontSize: 14,
    fontWeight: '700',
    color: '#016020',
  },
  listFooter: {
    height: 8,
  },
  playerBar: {
    marginTop: 12,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#b8dfc4',
    padding: 16,
    paddingBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  playerTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 6,
  },
  playerTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#027525',
    lineHeight: 20,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#d4f0e0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnPressed: {
    opacity: 0.85,
  },
  closeBtnText: {
    fontSize: 16,
    color: '#016020',
    fontWeight: '600',
  },
  slider: {
    width: '100%',
    height: 40,
    marginVertical: -4,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    marginTop: -4,
    paddingHorizontal: 2,
  },
  timeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5a9970',
    fontVariant: ['tabular-nums'],
  },
  playerPlayBtn: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 12,
    backgroundColor: '#027525',
  },
  playerPlayBtnPressed: {
    opacity: 0.92,
  },
  playerPlayBtnText: {
    color: '#f0faf3',
    fontSize: 16,
    fontWeight: '700',
  },
});