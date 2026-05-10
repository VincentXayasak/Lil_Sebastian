const RECENTS_KEY = 'lil_sebastian_recents';
const MAX_RECENTS = 5;
const SUBSCRIBED_CITY_KEY = 'lil_sebastian_subscribed_city';
const UPLOAD_CITY_KEY = 'lil_sebastian_upload_city';
const LOCATION_JSON = 'data/locations.json';

/** @type {string[]} */
let allLocations = [];
let cityLocationsPromise = null;
/** @type {'subscribe' | 'upload'} */
let cityModalMode = 'subscribe';

function loadLocationsList() {
  if (cityLocationsPromise) return cityLocationsPromise;
  cityLocationsPromise = fetch(LOCATION_JSON)
    .then((r) => {
      if (!r.ok) throw new Error('Could not load ' + LOCATION_JSON);
      return r.json();
    })
    .then((arr) => {
      allLocations = Array.isArray(arr) ? arr : [];
      return allLocations;
    })
    .catch((e) => {
      console.warn(e);
      allLocations = [];
      return allLocations;
    });
  return cityLocationsPromise;
}

function getSubscribedCity() {
  try {
    return (localStorage.getItem(SUBSCRIBED_CITY_KEY) || '').trim();
  } catch {
    return '';
  }
}

function setSubscribedCity(v) {
  try {
    if (v) localStorage.setItem(SUBSCRIBED_CITY_KEY, v);
    else localStorage.removeItem(SUBSCRIBED_CITY_KEY);
  } catch {
    /* ignore */
  }
}

function getUploadCityPref() {
  try {
    return (localStorage.getItem(UPLOAD_CITY_KEY) || '').trim();
  } catch {
    return '';
  }
}

function setUploadCityPref(v) {
  try {
    if (v) localStorage.setItem(UPLOAD_CITY_KEY, v);
    else localStorage.removeItem(UPLOAD_CITY_KEY);
  } catch {
    /* ignore */
  }
}

function getEffectiveUploadCity() {
  const u = getUploadCityPref();
  if (u) return u;
  return getSubscribedCity();
}

function refreshCityLabels() {
  const sub = getSubscribedCity();
  const disp = document.getElementById('city-subscribe-display');
  if (disp) disp.textContent = sub || 'Tap to choose';
  const upl = document.getElementById('upload-city-btn');
  if (upl) {
    const eu = getEffectiveUploadCity();
    upl.textContent = eu || 'Tap to choose';
  }
}

function openCityModal(mode) {
  cityModalMode = mode;
  const modal = document.getElementById('city-modal');
  const title = document.getElementById('city-modal-title');
  const search = document.getElementById('city-modal-search');
  if (!modal || !title || !search) return;
  title.textContent = mode === 'subscribe' ? 'Subscribed city' : 'Episode city';
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  search.value = '';
  renderCityModalResults('');
  search.focus();
}

function closeCityModal() {
  const modal = document.getElementById('city-modal');
  if (modal) modal.hidden = true;
  document.body.style.overflow = '';
}

function renderCityModalResults(qRaw) {
  const ul = document.getElementById('city-modal-results');
  if (!ul) return;
  ul.innerHTML = '';
  const q = qRaw.trim().toLowerCase();
  let list;
  if (q.length) {
    list = allLocations.filter((loc) => loc.toLowerCase().includes(q)).slice(0, 150);
  } else {
    list = allLocations.slice(0, 100);
  }
  list.forEach((loc) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = loc;
    b.addEventListener('click', () => applyCityPick(loc));
    li.appendChild(b);
    ul.appendChild(li);
  });
  if (!allLocations.length) {
    const li = document.createElement('li');
    const wrap = document.createElement('div');
    wrap.style.padding = '14px';
    wrap.style.fontSize = '14px';
    wrap.style.color = '#5e8870';
    wrap.textContent = 'No locations list. Run: python scripts/export_locations_json.py';
    li.appendChild(wrap);
    ul.appendChild(li);
    return;
  }
  if (!list.length) {
    const li = document.createElement('li');
    const wrap = document.createElement('div');
    wrap.style.padding = '14px';
    wrap.style.fontSize = '14px';
    wrap.style.color = '#5e8870';
    wrap.textContent = q ? 'No cities match — try fewer letters.' : 'Type to filter cities.';
    li.appendChild(wrap);
    ul.appendChild(li);
  }
}

function applyCityPick(loc) {
  const v = String(loc || '').trim();
  if (!v) return;
  if (cityModalMode === 'subscribe') {
    setSubscribedCity(v);
    setUploadCityPref(v);
    document.dispatchEvent(new CustomEvent('lil-sebastian-episodes-refresh'));
  } else {
    setUploadCityPref(v);
  }
  refreshCityLabels();
  closeCityModal();
}

void loadLocationsList().then(() => {
  refreshCityLabels();
});

(function initCityModalUi() {
  const subBtn = document.getElementById('city-subscribe-btn');
  const uplBtn = document.getElementById('upload-city-btn');
  const closeBtn = document.getElementById('city-modal-close');
  const backdrop = document.getElementById('city-modal-backdrop');
  const search = document.getElementById('city-modal-search');

  async function armThenOpen(mode) {
    await loadLocationsList();
    refreshCityLabels();
    openCityModal(mode);
  }

  if (subBtn) subBtn.addEventListener('click', () => void armThenOpen('subscribe'));
  if (uplBtn) uplBtn.addEventListener('click', () => void armThenOpen('upload'));

  if (closeBtn) closeBtn.addEventListener('click', () => closeCityModal());
  if (backdrop) backdrop.addEventListener('click', () => closeCityModal());

  const modal = document.getElementById('city-modal');
  if (modal) {
    modal.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') closeCityModal();
    });
  }

  let t = 0;
  if (search) {
    search.addEventListener('input', () => {
      clearTimeout(t);
      const v = search.value;
      t = setTimeout(() => renderCityModalResults(v), 80);
    });
  }
})();

refreshCityLabels();

/** @typedef {{ id: string, title: string, storage_path: string }} RecentEpisode */

/** @returns {RecentEpisode[]} */
function readRecentsFromStorage() {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** @param {RecentEpisode[]} rows */
function writeRecentsToStorage(rows) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(rows));
  } catch {
    /* ignore quota */
  }
}

function createLilSebastianSupabase() {
  const cfg = window.LIL_SEBASTIAN_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    return { client: null, cfg, setupError: 'Add supabaseUrl and supabaseAnonKey to config.' };
  }
  if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
    return { client: null, cfg, setupError: 'Supabase script failed to load.' };
  }
  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  return { client, cfg, setupError: null };
}

function safeIncomingObjectName(originalName) {
  const leaf = String(originalName || '').replace(/^.*[/\\]/, '');
  const cleaned = leaf.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+|\.+$/g, '');
  const extOk = /\.(mp4|m4v|mov|webm)$/i.test(cleaned) ? cleaned : cleaned + '.mp4';
  return extOk.slice(0, 180) || 'video.mp4';
}

function episodeTitleFromFileName(originalName) {
  const leaf = String(originalName || '').replace(/^.*[/\\]/, '');
  const noExt = leaf.replace(/\.[^.]+$/i, '');
  const spaced = noExt.replace(/_/g, ' ').trim();
  return spaced.slice(0, 500) || 'New episode';
}

function episodeHasPlayableAudio(ep) {
  if (!ep || ep.status === 'failed') return false;
  return !!String(ep.storage_path || '').trim();
}

/* Upload */

const uploadBlock = document.getElementById('upload-block');
const fileInput = document.getElementById('file-input');

let uploadInFlight = false;

if (uploadBlock && fileInput) {
  uploadBlock.addEventListener('click', () => {
    if (uploadInFlight || uploadBlock.hidden) return;
    fileInput.click();
  });
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  if (!uploadBlock || uploadBlock.hidden) {
    fileInput.value = '';
    return;
  }

  const uploadLabel = document.getElementById('upload-label');
  const uploadHint = document.getElementById('upload-hint');

  await loadLocationsList();
  const episodeCity = getEffectiveUploadCity();
  if (!episodeCity) {
    uploadLabel.textContent = 'Choose city';
    uploadHint.textContent =
      'Tap Subscribed city or Episode city, then upload again.';
    uploadBlock.style.borderColor = '#b8860b';
    uploadBlock.style.background = '#fffbf0';
    fileInput.value = '';
    return;
  }

  const mb = (file.size / (1024 * 1024)).toFixed(1);
  uploadLabel.textContent = 'Sending…';
  uploadHint.textContent = file.name + ' · ' + mb + ' MB · ' + episodeCity;
  uploadBlock.style.borderColor = '';
  uploadBlock.style.background = '';

  const { client: sb, cfg, setupError } = createLilSebastianSupabase();
  if (setupError) {
    uploadLabel.textContent = 'Cannot upload';
    uploadHint.textContent = setupError;
    fileInput.value = '';
    return;
  }

  const bucket = cfg.uploadsBucket || 'uploads';
  const idPart =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now());
  const objectPath = 'incoming/' + idPart + '_' + safeIncomingObjectName(file.name);

  uploadInFlight = true;
  uploadBlock.disabled = true;

  const { error } = await sb.storage.from(bucket).upload(objectPath, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'video/mp4',
  });

  uploadInFlight = false;
  uploadBlock.disabled = false;
  fileInput.value = '';

  if (error) {
    uploadLabel.textContent = 'Upload failed';
    uploadHint.textContent = error.message;
    uploadBlock.style.borderColor = '#b00020';
    uploadBlock.style.background = '#fff5f5';
    return;
  }

  const title = episodeTitleFromFileName(file.name);
  const { error: rowError } = await sb.from('episodes').insert({
    title: title,
    location: episodeCity.slice(0, 200),
    source_video_storage_path: objectPath,
    status: 'processing',
    storage_path: null,
  });

  if (rowError) {
    uploadLabel.textContent = 'Uploaded (DB error)';
    uploadHint.textContent =
      'Saved to ' +
      bucket +
      '/' +
      objectPath +
      ' · ' +
      rowError.message +
      ' Run supabase_sql/episodes_processing.sql and episodes_location.sql if needed.';
    uploadBlock.style.borderColor = '#b8860b';
    uploadBlock.style.background = '#fffbf0';
    return;
  }

  uploadLabel.textContent = 'Uploaded';
  uploadHint.textContent = 'Queued · ' + title;
  uploadBlock.style.borderColor = '#027525';
  uploadBlock.style.background = '#f0faf3';

  document.dispatchEvent(new CustomEvent('lil-sebastian-episodes-refresh'));
});

(function lilSebastianListen() {
  const cfg = window.LIL_SEBASTIAN_CONFIG || {};
  const homeView = document.getElementById('home-view');
  const resultsView = document.getElementById('results-view');
  const resultsHeader = document.getElementById('results-header');
  const resultsHint = document.getElementById('results-hint');
  const resultsList = document.getElementById('results-list');
  const searchInput = document.getElementById('search-input');
  const clearBtn = document.getElementById('clear-btn');
  const statusEl = document.getElementById('episodes-status');
  const listEl = document.getElementById('episodes-list-real');
  const configHint = document.getElementById('config-hint');
  const playerBar = document.getElementById('listen-player');
  const audioEl = document.getElementById('episode-audio');
  const listenTitle = document.getElementById('listen-title');
  const scrub = document.getElementById('listen-scrub');
  const tCur = document.getElementById('listen-time-current');
  const tDur = document.getElementById('listen-time-duration');
  const playToggle = document.getElementById('listen-play-toggle');
  const closeBtn = document.getElementById('listen-close');
  const recentBtn = document.getElementById('recent-square-btn');
  const recentTitleEl = document.getElementById('recent-title');
  const recentEmptyHint = document.getElementById('recent-empty-hint');
  const recentHintEl = document.getElementById('recent-hint');

  let sb = null;
  /** @type {any[]} */
  let episodes = [];
  /** @type {RecentEpisode[]} */
  let recentEpisodes = readRecentsFromStorage();
  let currentEpisode = null;
  let scrubDragging = false;
  /** @type {string | null} */
  let loadingEpisodeId = null;

  function fmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const s = Math.floor(sec % 60);
    const m = Math.floor(sec / 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function setPlayerOpen(open) {
    playerBar.hidden = !open;
  }

  function normalizeRecentPayload(ep) {
    return {
      id: ep.id,
      title: ep.title,
      storage_path: ep.storage_path,
      location: ep.location,
    };
  }

  function addToRecents(ep) {
    const row = normalizeRecentPayload(ep);
    const deduped = [
      row,
      ...recentEpisodes.filter((e) => String(e.id) !== String(row.id)),
    ].slice(0, MAX_RECENTS);
    recentEpisodes = deduped;
    writeRecentsToStorage(deduped);
    refreshRecentUi();
  }

  /** Prefer live row so `storage_path` / `status` stay current after processing. */
  function resolveEpisodeRef(ref) {
    if (!ref) return null;
    const live = episodes.find((e) => String(e.id) === String(ref.id));
    return live || ref;
  }

  function refreshRecentUi() {
    const first = recentEpisodes[0];
    const hasRecent = !!(first && first.title);

    recentBtn.disabled = !hasRecent;
    if (!hasRecent) {
      recentTitleEl.hidden = true;
      recentHintEl.hidden = true;
      recentEmptyHint.hidden = false;
      recentEmptyHint.textContent = 'Nothing yet';
      return;
    }

    recentEmptyHint.hidden = true;
    recentTitleEl.hidden = false;
    recentHintEl.hidden = false;
    recentTitleEl.textContent = first.title;

    const resolved = resolveEpisodeRef(first);
    const canPlay = !!(resolved && episodeHasPlayableAudio(resolved));
    recentBtn.disabled = !canPlay;
    const playingRecent = !!(
      currentEpisode &&
      resolved &&
      String(currentEpisode.id) === String(resolved.id) &&
      !audioEl.paused
    );
    recentHintEl.textContent =
      playingRecent && canPlay ? '▶ Playing' : 'Tap to play';
  }

  function isSearching() {
    return searchInput.value.trim().length > 0;
  }

  function showHomeView() {
    homeView.classList.remove('hidden');
    resultsView.hidden = true;
  }

  function showResultsView() {
    homeView.classList.add('hidden');
    resultsView.hidden = false;
  }

  function syncSearchChrome() {
    const q = searchInput.value;
    clearBtn.hidden = q.length === 0;
    const searching = q.trim().length > 0;
    if (!searching) {
      showHomeView();
      statusEl.textContent = '';
    }
  }

  function filteredEpisodesForSearch() {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) return episodes;
    return episodes.filter((ep) => ep.title.toLowerCase().includes(q));
  }

  function renderSearchPanel() {
    const qRaw = searchInput.value.trim();
    const list = filteredEpisodesForSearch();

    if (list.length === 0) {
      resultsHeader.textContent = 'No results for "' + qRaw + '"';
      resultsHint.hidden = false;
      resultsList.innerHTML = '';
      return;
    }

    resultsHeader.textContent =
      list.length + ' result' + (list.length !== 1 ? 's' : '');
    resultsHint.hidden = true;
    resultsList.innerHTML = '';
    list.forEach((ep) => resultsList.appendChild(buildEpisodeRow(ep)));
    updateRowButtons(resultsList);
  }

  async function fetchEpisodesTable() {
    const created = createLilSebastianSupabase();
    if (created.setupError) {
      configHint.hidden = false;
      statusEl.textContent = '';
      return;
    }
    configHint.hidden = true;
    sb = created.client;

    const subscribedCity = getSubscribedCity();
    if (!subscribedCity) {
      episodes = [];
      statusEl.textContent = 'Choose a subscribed city to see episodes.';
      listEl.innerHTML = '';
      refreshRecentUi();
      if (isSearching()) renderSearchPanel();
      return;
    }

    statusEl.textContent = 'Loading episodes…';
    const { data, error } = await sb
      .from('episodes')
      .select('id,title,storage_path,status,source_video_storage_path,location')
      .eq('location', subscribedCity)
      .order('id', { ascending: true });
    if (error) {
      statusEl.textContent = 'Could not load episodes: ' + error.message;
      return;
    }
    episodes = data || [];
    statusEl.textContent = episodes.length
      ? ''
      : 'No episodes for this city yet. Upload one or pick another city.';
    renderEpisodeList();

    refreshRecentUi();
    if (isSearching()) renderSearchPanel();
  }

  function updateRowButtons(root) {
    root.querySelectorAll('.episode-play-row').forEach((btnEl) => {
      const btn = /** @type {HTMLButtonElement} */ (btnEl);
      const ep = episodes.find((e) => String(e.id) === btn.dataset.episodeId);
      if (!ep) return;

      btn.classList.toggle(
        'is-active',
        !!(currentEpisode && String(currentEpisode.id) === String(ep.id))
      );

      const existingSpin = btn.querySelector('.episode-loading');
      const existingAct = btn.querySelector('.episode-play-action');

      if (loadingEpisodeId != null && String(loadingEpisodeId) === String(ep.id)) {
        existingAct?.remove();
        if (!existingSpin) {
          const sp = document.createElement('span');
          sp.className = 'episode-loading';
          sp.setAttribute('aria-hidden', 'true');
          btn.appendChild(sp);
        }
        btn.disabled = true;
        return;
      }

      existingSpin?.remove();
      let act = btn.querySelector('.episode-play-action');
      if (!act) {
        act = document.createElement('span');
        act.className = 'episode-play-action';
        btn.appendChild(act);
      }

      if (!episodeHasPlayableAudio(ep)) {
        act.textContent = ep.status === 'failed' ? 'Failed' : 'Processing';
        btn.disabled = true;
        btn.classList.toggle('is-failed', ep.status === 'failed');
        return;
      }

      btn.disabled = false;
      btn.classList.remove('is-failed');

      const isCurrent = !!(
        soundReady() &&
        currentEpisode &&
        String(currentEpisode.id) === String(ep.id)
      );
      act.textContent = 'Play';
      if (isCurrent) {
        act.textContent = audioEl.paused
          ? audioEl.ended
            ? 'Replay'
            : 'Resume'
          : 'Pause';
      }
    });
  }

  function soundReady() {
    /* audio mounted when we're playing — treat as inactive if no src */
    return !!audioEl.getAttribute('src');
  }

  function buildEpisodeRow(ep) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.episodeId = String(ep.id);
    btn.className = 'episode-play-row';
    btn.classList.toggle('is-failed', ep.status === 'failed');

    const titleSpan = document.createElement('span');
    titleSpan.className = 'episode-play-title';
    titleSpan.textContent = ep.title;
    btn.appendChild(titleSpan);

    if (loadingEpisodeId != null && String(loadingEpisodeId) === String(ep.id)) {
      const sp = document.createElement('span');
      sp.className = 'episode-loading';
      sp.setAttribute('aria-hidden', 'true');
      btn.appendChild(sp);
      btn.disabled = true;
    } else {
      const actionMarker = document.createElement('span');
      actionMarker.className = 'episode-play-action';
      if (!episodeHasPlayableAudio(ep)) {
        actionMarker.textContent = ep.status === 'failed' ? 'Failed' : 'Processing';
        btn.disabled = true;
      } else {
        actionMarker.textContent = 'Play';
      }
      btn.appendChild(actionMarker);
    }

    btn.addEventListener('click', () => {
      const latest = episodes.find((e) => String(e.id) === String(ep.id)) || ep;
      void onEpisodeRowClick(latest);
    });

    return btn;
  }

  function renderEpisodeList() {
    listEl.innerHTML = '';
    episodes.forEach((ep) => listEl.appendChild(buildEpisodeRow(ep)));
    updateRowButtons(listEl);
  }

  async function getSignedUrl(storagePath) {
    const clean = String(storagePath || '').replace(/^\/+/, '');
    const bucket = cfg.podcastsBucket || 'podcasts';
    const { data, error } = await sb.storage.from(bucket).createSignedUrl(clean, 7200);
    if (error) throw error;
    return data.signedUrl;
  }

  function updatePlayerUi() {
    if (!currentEpisode) return;
    const dur = audioEl.duration;
    if (Number.isFinite(dur) && dur > 0) {
      scrub.max = String(dur);
      if (!scrubDragging) scrub.value = String(audioEl.currentTime);
      tDur.textContent = fmtTime(dur);
    } else {
      scrub.max = '1';
      if (!scrubDragging) scrub.value = '0';
      tDur.textContent = '0:00';
    }
    tCur.textContent = fmtTime(audioEl.currentTime || 0);
    playToggle.textContent =
      audioEl.paused ? (audioEl.ended ? 'Replay' : 'Play') : 'Pause';

    refreshRecentUi();

    updateRowButtons(listEl);
    if (isSearching()) updateRowButtons(resultsList);
  }

  async function loadEpisode(ep) {
    const url = await getSignedUrl(ep.storage_path);
    audioEl.src = url;
    currentEpisode = ep;
    listenTitle.textContent = ep.title;
    setPlayerOpen(true);
    audioEl.load();
    await new Promise((resolve, reject) => {
      const ok = () => {
        cleanup();
        resolve();
      };
      const bad = () => {
        cleanup();
        reject(new Error(audioEl.error ? 'Audio decode / network error' : 'Audio failed'));
      };
      function cleanup() {
        audioEl.removeEventListener('canplay', ok);
        audioEl.removeEventListener('error', bad);
      }
      audioEl.addEventListener('canplay', ok, { once: true });
      audioEl.addEventListener('error', bad, { once: true });
    });
    await audioEl.play().catch(() => {});
    addToRecents(ep);
    updatePlayerUi();
  }

  async function onEpisodeRowClick(ep) {
    if (!sb) await fetchEpisodesTable();
    if (!sb) return;
    statusEl.textContent = '';

    if (ep.status === 'failed') {
      statusEl.textContent = 'This episode failed during processing.';
      return;
    }
    if (!episodeHasPlayableAudio(ep)) {
      statusEl.textContent =
        ep.status === 'processing'
          ? 'Still processing — check back once the podcast is generated.'
          : 'No audio yet for this episode.';
      return;
    }
    try {
      if (
        soundReady() &&
        currentEpisode &&
        String(currentEpisode.id) === String(ep.id) &&
        loadingEpisodeId == null
      ) {
        const dur = audioEl.duration;
        if (audioEl.paused) {
          if (Number.isFinite(dur) && dur > 0 && audioEl.currentTime >= dur - 0.35) {
            audioEl.currentTime = 0;
          }
          await audioEl.play().catch(() => {});
        } else {
          audioEl.pause();
        }
        updatePlayerUi();
        return;
      }

      loadingEpisodeId = ep.id;
      updateRowButtons(listEl);
      if (isSearching()) updateRowButtons(resultsList);

      audioEl.pause();

      await loadEpisode(ep);
    } catch (e) {
      const msg =
        e && e.message
          ? String(e.message)
          : String(e);
      statusEl.textContent =
        'Could not play: ' +
        msg +
        '. Private buckets need Storage SELECT policy for anon (see supabase_sql/storage_podcasts_private_read.sql).';
      await unloadPlayer();
    } finally {
      loadingEpisodeId = null;
      updateRowButtons(listEl);
      if (isSearching()) updateRowButtons(resultsList);
    }
  }

  async function unloadPlayer() {
    audioEl.pause();
    audioEl.removeAttribute('src');
    audioEl.load();
    currentEpisode = null;
    loadingEpisodeId = null;
    setPlayerOpen(false);
    updateRowButtons(listEl);
    if (isSearching()) updateRowButtons(resultsList);
    tCur.textContent = '0:00';
    tDur.textContent = '0:00';
    scrub.value = '0';
    refreshRecentUi();
  }

  playToggle.addEventListener('click', async () => {
    if (!currentEpisode || !soundReady()) return;
    try {
      const dur = audioEl.duration;
      if (audioEl.paused) {
        if (Number.isFinite(dur) && dur > 0 && audioEl.currentTime >= dur - 0.35) {
          audioEl.currentTime = 0;
        }
        await audioEl.play().catch(() => {});
      } else {
        audioEl.pause();
      }
      updatePlayerUi();
    } catch (e) {
      statusEl.textContent =
        'Playback: ' + (e && e.message ? e.message : String(e));
    }
  });

  scrub.addEventListener('mousedown', () => {
    scrubDragging = true;
  });
  scrub.addEventListener('touchstart', () => {
    scrubDragging = true;
  }, { passive: true });

  function finishScrubSeek() {
    scrubDragging = false;
    const v = parseFloat(scrub.value);
    if (Number.isFinite(v) && Number.isFinite(audioEl.duration)) {
      audioEl.currentTime = v;
    }
    updatePlayerUi();
  }

  scrub.addEventListener('change', finishScrubSeek);
  scrub.addEventListener('mouseup', finishScrubSeek);
  scrub.addEventListener('touchend', finishScrubSeek);

  scrub.addEventListener('input', () => {
    if (!scrubDragging) scrubDragging = true;
    const v = parseFloat(scrub.value);
    if (Number.isFinite(v)) {
      tCur.textContent = fmtTime(v);
    }
  });

  audioEl.addEventListener('timeupdate', updatePlayerUi);
  audioEl.addEventListener('loadedmetadata', updatePlayerUi);
  audioEl.addEventListener('pause', updatePlayerUi);
  audioEl.addEventListener('playing', updatePlayerUi);
  audioEl.addEventListener('ended', updatePlayerUi);

  closeBtn.addEventListener('click', () => void unloadPlayer());

  document.addEventListener('lil-sebastian-episodes-refresh', () => void fetchEpisodesTable());

  searchInput.addEventListener('input', () => {
    syncSearchChrome();
    if (searchInput.value.trim()) {
      showResultsView();
      renderSearchPanel();
    } else {
      showHomeView();
      statusEl.textContent = '';
    }
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    syncSearchChrome();
    showHomeView();
    statusEl.textContent = '';
    searchInput.focus();
  });

  recentBtn.addEventListener('click', () => {
    const first = recentEpisodes[0];
    if (!first) return;
    const ep = resolveEpisodeRef(first);
    if (!ep || !episodeHasPlayableAudio(ep)) return;
    void onEpisodeRowClick(ep);
  });

  refreshRecentUi();
  fetchEpisodesTable();
})();

(function initSupabaseAuthUi() {
  const cornerBtn = document.getElementById('auth-corner-btn');
  const cornerLabel = document.getElementById('auth-corner-label');
  const modal = document.getElementById('auth-modal');
  const backdrop = document.getElementById('auth-modal-backdrop');
  const closeBtn = document.getElementById('auth-modal-close');
  const loggedInPane = document.getElementById('auth-modal-logged-in');
  const guestPane = document.getElementById('auth-modal-guest');
  const signedInEmail = document.getElementById('auth-signed-in-email');
  const signOutBtn = document.getElementById('auth-sign-out-btn');
  const tabLogin = document.getElementById('auth-tab-login');
  const tabSignup = document.getElementById('auth-tab-signup');
  const form = document.getElementById('auth-form');
  const emailInput = document.getElementById('auth-email');
  const passwordInput = document.getElementById('auth-password');
  const msgEl = document.getElementById('auth-form-message');
  const submitBtn = document.getElementById('auth-submit-btn');

  if (!cornerBtn || !cornerLabel || !modal || !loggedInPane || !guestPane) return;

  /** @type {ReturnType<typeof window.supabase.createClient> | null} */
  let sbAuth = null;
  /** @type {'login' | 'signup'} */
  let authTab = 'login';

  function getAuthClient() {
    if (sbAuth) return sbAuth;
    const { client, setupError } = createLilSebastianSupabase();
    if (setupError || !client) return null;
    sbAuth = client;
    return sbAuth;
  }

  function clearAuthMessage() {
    if (!msgEl) return;
    msgEl.textContent = '';
    msgEl.classList.remove('is-ok');
  }

  function setAuthMessage(text, ok) {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.classList.toggle('is-ok', !!ok);
  }

  function updateCorner(session) {
    const email = session?.user?.email;
    if (email) {
      cornerLabel.textContent = email;
      cornerBtn.title = email + ' — account';
      cornerBtn.disabled = false;
      return;
    }
    cornerLabel.textContent = 'Login / signup';
    cornerBtn.title = '';
    const client = getAuthClient();
    cornerBtn.disabled = !client;
  }

  function refreshUploadForSignedIn(signedIn) {
    const row = document.getElementById('upload-city-row');
    const block = document.getElementById('upload-block');
    if (row) row.hidden = !signedIn;
    if (block) block.hidden = !signedIn;
  }

  function applySessionUi(session) {
    const inAccount = !!(session?.user);
    loggedInPane.hidden = !inAccount;
    guestPane.hidden = inAccount;
    if (inAccount && session?.user?.email && signedInEmail) {
      signedInEmail.textContent = session.user.email;
    }
    updateCorner(session);
    refreshUploadForSignedIn(inAccount);
  }

  function syncModalToSession(after) {
    const client = getAuthClient();
    if (!client) {
      loggedInPane.hidden = true;
      guestPane.hidden = false;
      refreshUploadForSignedIn(false);
      setAuthMessage('Add supabaseUrl and supabaseAnonKey to config.js, then reload.', false);
      if (typeof after === 'function') after();
      return;
    }
    void client.auth.getSession().then(({ data: { session } }) => {
      applySessionUi(session);
      if (typeof after === 'function') after();
    });
  }

  function openAuthModal() {
    modal.hidden = false;
    cornerBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    clearAuthMessage();
    syncModalToSession(() => {
      if (!guestPane.hidden && emailInput) emailInput.focus();
    });
  }

  function closeAuthModal() {
    modal.hidden = true;
    cornerBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    clearAuthMessage();
  }

  function setAuthTab(mode) {
    authTab = mode;
    if (tabLogin) {
      tabLogin.classList.toggle('is-active', mode === 'login');
      tabLogin.setAttribute('aria-selected', mode === 'login' ? 'true' : 'false');
    }
    if (tabSignup) {
      tabSignup.classList.toggle('is-active', mode === 'signup');
      tabSignup.setAttribute('aria-selected', mode === 'signup' ? 'true' : 'false');
    }
    if (submitBtn) submitBtn.textContent = mode === 'login' ? 'Log in' : 'Sign up';
    if (passwordInput)
      passwordInput.setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
    clearAuthMessage();
  }

  setAuthTab('login');

  const client0 = getAuthClient();
  if (client0) {
    void client0.auth.getSession().then(({ data: { session } }) => applySessionUi(session));
    client0.auth.onAuthStateChange((_event, session) => applySessionUi(session));
  } else {
    cornerBtn.disabled = true;
    cornerBtn.title = 'Configure config.js with Supabase URL and anon key';
    refreshUploadForSignedIn(false);
  }

  cornerBtn.addEventListener('click', () => openAuthModal());
  closeBtn?.addEventListener('click', () => closeAuthModal());
  backdrop?.addEventListener('click', () => closeAuthModal());
  modal.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeAuthModal();
  });

  tabLogin?.addEventListener('click', () => setAuthTab('login'));
  tabSignup?.addEventListener('click', () => setAuthTab('signup'));

  form?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const client = getAuthClient();
    if (!client || !submitBtn || !emailInput || !passwordInput) return;
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    clearAuthMessage();
    submitBtn.disabled = true;

    try {
      if (authTab === 'login') {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) {
          setAuthMessage(error.message, false);
          return;
        }
        closeAuthModal();
        return;
      }

      const { data, error } = await client.auth.signUp({ email, password });
      if (error) {
        setAuthMessage(error.message, false);
        return;
      }
      if (data.session) {
        closeAuthModal();
      } else {
        setAuthMessage(
          'Check your email to confirm your account before signing in.',
          true
        );
      }
    } finally {
      submitBtn.disabled = false;
    }
  });

  signOutBtn?.addEventListener('click', async () => {
    const client = getAuthClient();
    if (!client || !signOutBtn) return;
    signOutBtn.disabled = true;
    try {
      await client.auth.signOut();
      setAuthTab('login');
      if (passwordInput) passwordInput.value = '';
      closeAuthModal();
    } finally {
      signOutBtn.disabled = false;
    }
  });
})();
