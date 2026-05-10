import { Audio, type AVPlaybackStatus } from 'expo-av';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import LOCATION_JSON from './data/locations.json';
import { cacheRemoteAudioForPlayback } from './lib/cacheRemoteAudio';
import { createEpisodePlaybackUrl } from './lib/episodeSignedAudioUrl';
import { supabase } from './lib/supabase';

const LOCATION_LIST = LOCATION_JSON as string[];

const RECENTS_KEY = 'lil_sebastian_recents';
const SUBSCRIBED_CITY_KEY = 'lil_sebastian_subscribed_city';
const MAX_RECENTS = 5;

type EpisodeRow = {
  id: string | number;
  title: string;
  storage_path: string | null;
  location?: string | null;
  status?: string | null;
};

/** Minimal row persisted for Recently played — matches web localStorage shape. */
type RecentEpisode = {
  id: string | number;
  title: string;
  storage_path: string | null;
  location?: string | null;
};

function episodeIsPlayable(ep: EpisodeRow): boolean {
  if (ep.status === 'failed') return false;
  return !!ep.storage_path && ep.storage_path.replace(/^\/+/, '').length > 0;
}

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

function normalizeRecentPayload(ep: EpisodeRow): RecentEpisode {
  return {
    id: ep.id,
    title: ep.title,
    storage_path: ep.storage_path,
    location: ep.location,
  };
}

export default function App() {
  const { width } = useWindowDimensions();
  const squareSize = Math.min(width * 0.42, 168);

  const [searchQuery, setSearchQuery] = useState('');
  const isSearching = searchQuery.trim().length > 0;

  const [episodes, setEpisodes] = useState<EpisodeRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);

  const [subscribedCity, setSubscribedCity] = useState<string | null>(null);
  const [subscribedHydrated, setSubscribedHydrated] = useState(false);
  const [cityModalVisible, setCityModalVisible] = useState(false);
  const [citySearch, setCitySearch] = useState('');

  const [recentEpisodes, setRecentEpisodes] = useState<RecentEpisode[]>([]);

  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const [activeEpisode, setActiveEpisode] = useState<EpisodeRow | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);
  const [loadingEpisodeId, setLoadingEpisodeId] = useState<string | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubMillis, setScrubMillis] = useState(0);
  const isScrubbingRef = useRef(false);
  const wasPlayingBeforeScrubRef = useRef(false);

  const cityPickerMatches = useMemo(() => {
    const q = citySearch.trim().toLowerCase();
    if (!q.length) return LOCATION_LIST.slice(0, 100);
    return LOCATION_LIST.filter((loc) => loc.toLowerCase().includes(q)).slice(0, 150);
  }, [citySearch]);

  const filteredForSearch = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q.length) return episodes;
    return episodes.filter((ep) => ep.title.toLowerCase().includes(q));
  }, [episodes, searchQuery]);

  const pickSubscribedCity = useCallback(async (loc: string) => {
    const v = loc.trim();
    if (!v.length) return;
    setSubscribedCity(v);
    await AsyncStorage.setItem(SUBSCRIBED_CITY_KEY, v);
    setCityModalVisible(false);
    setCitySearch('');
  }, []);

  const addToRecents = useCallback((episode: EpisodeRow) => {
    const row = normalizeRecentPayload(episode);
    setRecentEpisodes((prev) => {
      const deduped = [
        row,
        ...prev.filter((e) => String(e.id) !== String(row.id)),
      ].slice(0, MAX_RECENTS);
      void AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(deduped));
      return deduped;
    });
  }, []);

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
      staysActiveInBackground: true,
    });
  }, []);

  useEffect(() => {
    return () => {
      void soundRef.current?.unloadAsync();
      soundRef.current = null;
    };
  }, []);

  useEffect(() => {
    void AsyncStorage.getItem(SUBSCRIBED_CITY_KEY).then((raw) => {
      const t = raw?.trim() || '';
      setSubscribedCity(t.length ? t : null);
      setSubscribedHydrated(true);
    });
  }, []);

  useEffect(() => {
    void AsyncStorage.getItem(RECENTS_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as RecentEpisode[];
        setRecentEpisodes(Array.isArray(parsed) ? parsed : []);
      } catch {
        /* ignore */
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!process.env.EXPO_PUBLIC_SUPABASE_URL?.length) {
        setListError(
          'Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to app/.env'
        );
        setListLoading(false);
        return;
      }
      if (!subscribedHydrated) return;

      if (!subscribedCity) {
        setEpisodes([]);
        setListError(null);
        setListLoading(false);
        return;
      }

      setListLoading(true);
      setListError(null);
      const { data, error } = await supabase
        .from('episodes')
        .select('id, title, storage_path, status, location')
        .eq('location', subscribedCity)
        .order('id', { ascending: true });

      if (cancelled) return;
      if (error) setListError(error.message);
      else setEpisodes((data ?? []) as EpisodeRow[]);
      setListLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [subscribedHydrated, subscribedCity]);

  function resolveEpisodeRef(ref: RecentEpisode | null): EpisodeRow | null {
    if (!ref) return null;
    const live = episodes.find((e) => String(e.id) === String(ref.id));
    return live ?? (ref as EpisodeRow);
  }

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
      if (!episodeIsPlayable(episode)) {
        return;
      }
      const path = normalizeStoragePath(episode.storage_path ?? '');

      try {
        if (soundRef.current) {
          await soundRef.current.unloadAsync();
          soundRef.current = null;
          setSound(null);
        }

        const rowId = String(episode.id);
        setLoadingEpisodeId(rowId);
        const signedUrl = await createEpisodePlaybackUrl(path);
        const localUri = await cacheRemoteAudioForPlayback(signedUrl, rowId);

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
        addToRecents(episode);
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
    [attachPlaybackWatcher, unloadPlayer, addToRecents]
  );

  const toggleEpisode = useCallback(
    async (episode: EpisodeRow) => {
      if (!episodeIsPlayable(episode)) return;

      const currentSound = soundRef.current;

      if (
        activeEpisode != null &&
        String(activeEpisode.id) === String(episode.id) &&
        currentSound
      ) {
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
    durationMillis <= 0
      ? 0
      : isScrubbing
        ? Math.min(Math.max(scrubMillis, 0), sliderMax)
        : positionMillis;

  const renderEpisodeRow = (item: EpisodeRow) => {
    const playable = episodeIsPlayable(item);
    const isActive =
      sound != null &&
      activeEpisode != null &&
      loadingEpisodeId == null &&
      String(activeEpisode.id) === String(item.id);
    const isLoadingRow = loadingEpisodeId === String(item.id);
    let action = 'Play';
    if (!playable && item.status === 'failed') action = 'Failed';
    else if (!playable) action = 'Processing';
    else if (isLoadingRow) action = '…';
    else if (isActive) action = isPlaying ? 'Pause' : 'Resume';
    return (
      <Pressable
        style={({ pressed }) => [
          styles.episodeRow,
          !playable && styles.episodeRowDisabled,
          pressed && playable && styles.episodeRowPressed,
        ]}
        onPress={() => void toggleEpisode(item)}
        disabled={isLoadingRow || !playable}
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
  };

  const recentFirst = recentEpisodes[0];
  const recentResolved = resolveEpisodeRef(recentFirst ?? null);
  const recentCanPlay = !!(recentResolved && episodeIsPlayable(recentResolved));
  const playingRecent =
    !!(
      activeEpisode &&
      recentResolved &&
      String(activeEpisode.id) === String(recentResolved.id) &&
      isPlaying
    );

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.safeTop} />

      <Image
        source={require('./assets/sebastian.png')}
        style={styles.logo}
        accessibilityLabel="Lil Sebastian"
        resizeMode="contain"
      />

      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search podcasts"
          placeholderTextColor="#6aaa82"
          value={searchQuery}
          onChangeText={(t) => {
            setPlayError(null);
            setSearchQuery(t);
          }}
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Search podcasts"
        />
        {isSearching && Platform.OS !== 'ios' && (
          <Pressable onPress={() => setSearchQuery('')} hitSlop={8} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>✕</Text>
          </Pressable>
        )}
      </View>

      {isSearching ? (
        <View style={styles.resultsPanel}>
          <Text style={styles.resultsHeader}>
            {filteredForSearch.length === 0
              ? `No results for "${searchQuery.trim()}"`
              : `${filteredForSearch.length} result${filteredForSearch.length !== 1 ? 's' : ''}`}
          </Text>
          {filteredForSearch.length === 0 ? (
            <Text style={styles.cardHint}>Try a different keyword.</Text>
          ) : (
            <FlatList
              style={styles.episodeList}
              data={filteredForSearch}
              keyExtractor={(it) => String(it.id)}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => renderEpisodeRow(item)}
              ListFooterComponent={<View style={styles.listFooter} />}
            />
          )}
          {listError ? <Text style={styles.errorText}>{listError}</Text> : null}
        </View>
      ) : (
        <>
          <View style={styles.middleRow}>
            {!recentFirst ? (
              <View style={[styles.recentSquare, { width: squareSize, height: squareSize }]}>
                <Text style={styles.cardLabel}>Recently played</Text>
                <Text style={styles.cardHint}>Nothing yet</Text>
              </View>
            ) : (
              <Pressable
                style={({ pressed }) => [
                  styles.recentSquare,
                  { width: squareSize, height: squareSize },
                  pressed && recentCanPlay && styles.episodeRowPressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ disabled: !recentCanPlay }}
                onPress={() => {
                  if (!recentResolved || !recentCanPlay) return;
                  setPlayError(null);
                  void toggleEpisode(recentResolved);
                }}
                disabled={!recentCanPlay}
              >
                <Text style={styles.cardLabel}>Recently played</Text>
                <Text style={styles.recentTitle} numberOfLines={3}>
                  {recentFirst.title}
                </Text>
                <Text style={styles.recentHint}>
                  {!recentCanPlay
                    ? recentResolved?.status === 'failed'
                      ? 'Unavailable'
                      : 'Still processing'
                    : playingRecent
                      ? '▶ Playing'
                      : 'Tap to play'}
                </Text>
              </Pressable>
            )}

            <Pressable
              style={({ pressed }) => [styles.cityPanel, pressed && styles.cityPanelPressed]}
              onPress={() => {
                setCitySearch('');
                setCityModalVisible(true);
              }}
            >
              <Text style={styles.cityCardLabel}>Subscribed city</Text>
              <Text style={styles.cityName} numberOfLines={3}>
                {subscribedHydrated ? subscribedCity ?? 'Tap to choose' : '…'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.bottomPanel}>
            <Text style={styles.cardLabel}>Episodes</Text>
            {playError != null && playError !== '' ? (
              <Text style={styles.errorText}>{playError}</Text>
            ) : null}
            {!subscribedHydrated ? (
              <Text style={styles.cardHint}>Loading your city preference…</Text>
            ) : null}
            {subscribedHydrated && !subscribedCity ? (
              <Text style={styles.cardHint}>Choose a subscribed city to load episodes.</Text>
            ) : null}
            {listLoading ? <ActivityIndicator style={styles.loader} /> : null}
            {listError != null && listError !== '' ? (
              <Text style={styles.errorText}>{listError}</Text>
            ) : null}
            {subscribedHydrated &&
            subscribedCity &&
            !listLoading &&
            !listError &&
            episodes.length === 0 ? (
              <Text style={styles.cardHint}>
                No episodes for this city yet. Upload from the website.
              </Text>
            ) : null}

            {subscribedCity ? (
              <FlatList
                style={styles.episodeList}
                data={episodes}
                keyExtractor={(item) => String(item.id)}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => renderEpisodeRow(item)}
                ListFooterComponent={<View style={styles.listFooter} />}
              />
            ) : null}
          </View>
        </>
      )}

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
            key={`slider-${String(activeEpisode.id)}`}
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
            <Text style={styles.timeText}>
              {formatTime(isScrubbing ? scrubMillis : positionMillis)}
            </Text>
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

      <Modal
        visible={cityModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCityModalVisible(false)}
      >
        <View style={styles.cityModalRoot}>
          <Pressable
            style={styles.cityModalBackdrop}
            onPress={() => setCityModalVisible(false)}
            accessibilityLabel="Close city picker"
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.cityModalKeyboard}
          >
            <View style={styles.cityModalSheet}>
              <Text style={styles.cityModalHeading}>Subscribed city</Text>
              <TextInput
                style={styles.cityModalSearch}
                placeholder="Search cities…"
                placeholderTextColor="#6aaa82"
                value={citySearch}
                onChangeText={setCitySearch}
                autoCorrect={false}
                autoCapitalize="none"
              />
              <FlatList
                data={cityPickerMatches}
                keyExtractor={(item, i) => `${i}-${item.slice(0, 24)}`}
                style={styles.cityModalList}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <Pressable
                    style={({ pressed }) => [
                      styles.cityPickRow,
                      pressed && styles.cityPickRowPressed,
                    ]}
                    onPress={() => void pickSubscribedCity(item)}
                  >
                    <Text style={styles.cityPickRowText}>{item}</Text>
                  </Pressable>
                )}
              />
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
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
  logo: {
    width: 64,
    height: 64,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#b8dfc4',
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#027525',
    paddingVertical: 0,
  },
  clearBtn: {
    paddingLeft: 8,
    paddingVertical: 4,
  },
  clearBtnText: {
    fontSize: 15,
    color: '#6aaa82',
    fontWeight: '600',
  },
  resultsPanel: {
    flex: 1,
    marginTop: 16,
  },
  resultsHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5a9970',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 10,
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
  cityPanelPressed: {
    opacity: 0.92,
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
  recentTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#027525',
    lineHeight: 19,
    marginBottom: 4,
  },
  recentHint: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6aaa82',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
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
  episodeRowDisabled: {
    opacity: 0.7,
    borderColor: '#d5ddd8',
    backgroundColor: '#f5f7f6',
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
  cityModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(20, 30, 25, 0.45)',
  },
  cityModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  cityModalKeyboard: {
    width: '100%',
    maxHeight: '78%',
  },
  cityModalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    borderWidth: 1,
    borderColor: '#b8dfc4',
    maxHeight: '100%',
  },
  cityModalHeading: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1e3d2e',
    marginBottom: 12,
  },
  cityModalSearch: {
    borderWidth: 1,
    borderColor: '#bccac2',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    marginBottom: 10,
    color: '#1e3d2e',
  },
  cityModalList: {
    flexGrow: 0,
    maxHeight: 420,
  },
  cityPickRow: {
    paddingVertical: 13,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5ede8',
  },
  cityPickRowPressed: {
    backgroundColor: '#f3faf6',
  },
  cityPickRowText: {
    fontSize: 15,
    color: '#1e3d2e',
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
