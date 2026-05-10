const RECENTS_KEY = 'lil_sebastian_recents';
const MAX_RECENTS = 5;

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

uploadBlock.addEventListener('click', () => {
  if (uploadInFlight) return;
  fileInput.click();
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;

  const uploadLabel = document.getElementById('upload-label');
  const uploadHint = document.getElementById('upload-hint');

  const mb = (file.size / (1024 * 1024)).toFixed(1);
  uploadLabel.textContent = 'Sending…';
  uploadHint.textContent = file.name + ' · ' + mb + ' MB';
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
      ' Run supabase_sql/episodes_processing.sql if needed.';
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
    };
  }

  function addToRecents(ep) {
    const row = normalizeRecentPayload(ep);
    const deduped = [row, ...recentEpisodes.filter((e) => e.id !== row.id)].slice(0, MAX_RECENTS);
    recentEpisodes = deduped;
    writeRecentsToStorage(deduped);
    refreshRecentUi();
  }

  /** Prefer live row so `storage_path` / `status` stay current after processing. */
  function resolveEpisodeRef(ref) {
    if (!ref) return null;
    const live = episodes.find((e) => e.id === ref.id);
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
    const playingRecent =
      !!(currentEpisode && resolved && currentEpisode.id === resolved.id && !audioEl.paused);
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

    statusEl.textContent = 'Loading episodes…';
    const { data, error } = await sb
      .from('episodes')
      .select('id,title,storage_path,status,source_video_storage_path')
      .order('id', { ascending: true });
    if (error) {
      statusEl.textContent = 'Could not load episodes: ' + error.message;
      return;
    }
    episodes = data || [];
    statusEl.textContent = episodes.length ? '' : 'No episodes in the database yet.';
    renderEpisodeList();

    refreshRecentUi();
    if (isSearching()) renderSearchPanel();
  }

  function updateRowButtons(root) {
    root.querySelectorAll('.episode-play-row').forEach((btnEl) => {
      const btn = /** @type {HTMLButtonElement} */ (btnEl);
      const ep = episodes.find((e) => e.id === btn.dataset.episodeId);
      if (!ep) return;

      btn.classList.toggle('is-active', !!(currentEpisode && currentEpisode.id === ep.id));

      const existingSpin = btn.querySelector('.episode-loading');
      const existingAct = btn.querySelector('.episode-play-action');

      if (loadingEpisodeId === ep.id) {
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

      const isCurrent = !!(soundReady() && currentEpisode && currentEpisode.id === ep.id);
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
    btn.dataset.episodeId = ep.id;
    btn.className = 'episode-play-row';
    btn.classList.toggle('is-failed', ep.status === 'failed');

    const titleSpan = document.createElement('span');
    titleSpan.className = 'episode-play-title';
    titleSpan.textContent = ep.title;
    btn.appendChild(titleSpan);

    if (loadingEpisodeId === ep.id) {
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
      const latest = episodes.find((e) => e.id === ep.id) || ep;
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
        currentEpisode.id === ep.id &&
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
