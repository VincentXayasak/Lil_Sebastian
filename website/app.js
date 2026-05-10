const PODCASTS = [
  { title: 'The City Pulse',        city: 'New York',      duration: '34 min' },
  { title: 'Street Level',          city: 'Chicago',       duration: '28 min' },
  { title: 'Bay Area Breakdown',    city: 'San Francisco', duration: '41 min' },
  { title: 'Southside Stories',     city: 'Chicago',       duration: '52 min' },
  { title: 'Metro Dispatch',        city: 'Los Angeles',   duration: '19 min' },
  { title: 'The Underground Line',  city: 'New York',      duration: '37 min' },
  { title: 'Cactus and Concrete',   city: 'Phoenix',       duration: '23 min' },
  { title: 'Rainy Day Radio',       city: 'Seattle',       duration: '45 min' },
  { title: 'Deep South Dialogue',   city: 'Atlanta',       duration: '31 min' },
  { title: 'Harbor Talks',          city: 'Boston',        duration: '26 min' },
];

const searchInput   = document.getElementById('search-input');
const searchBtn     = document.getElementById('search-btn');
const clearBtn      = document.getElementById('clear-btn');
const homeView      = document.getElementById('home-view');
const resultsView   = document.getElementById('results-view');
const noResultsView = document.getElementById('no-results-view');
const resultsList   = document.getElementById('results-list');
const resultsHeader = document.getElementById('results-header');
const noResultsQuery = document.getElementById('no-results-query');

function showView(name) {
  homeView.style.display      = name === 'home'       ? 'flex' : 'none';
  resultsView.style.display   = name === 'results'    ? 'flex' : 'none';
  noResultsView.style.display = name === 'no-results' ? 'flex' : 'none';
}

function runSearch() {
  const query = searchInput.value.trim();
  if (!query) { showView('home'); return; }

  const matches = PODCASTS.filter(p =>
    p.title.toLowerCase().includes(query.toLowerCase()) ||
    p.city.toLowerCase().includes(query.toLowerCase())
  );

  if (matches.length === 0) {
    noResultsQuery.textContent = '"' + query + '"';
    showView('no-results');
    return;
  }

  resultsHeader.textContent = matches.length + ' result' + (matches.length !== 1 ? 's' : '');
  resultsList.innerHTML = matches.map(p => `
    <div class="result-card">
      <div class="result-thumb">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
          <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/>
          <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
        </svg>
      </div>
      <div class="result-info">
        <div class="result-title">${p.title}</div>
        <div class="result-meta">${p.duration}</div>
      </div>
      <span class="result-city">${p.city}</span>
    </div>
  `).join('');

  showView('results');
}

searchBtn.addEventListener('click', runSearch);
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
searchInput.addEventListener('input', () => {
  clearBtn.classList.toggle('visible', searchInput.value.length > 0);
  if (searchInput.value.trim() === '') showView('home');
});
clearBtn.addEventListener('click', () => {
  searchInput.value = '';
  clearBtn.classList.remove('visible');
  searchInput.focus();
  showView('home');
});

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
const fileInput   = document.getElementById('file-input');
const uploadLabel = document.getElementById('upload-label');
const uploadHint  = document.getElementById('upload-hint');

let uploadInFlight = false;

uploadBlock.addEventListener('click', () => {
  if (uploadInFlight) return;
  fileInput.click();
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;

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
      'Saved to ' + bucket + '/' + objectPath + ' · ' + rowError.message + ' Run supabase_sql/episodes_processing.sql if needed.';
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

  let sb = null;
  let episodes = [];
  let currentEpisode = null;
  let scrubDragging = false;

  function fmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const s = Math.floor(sec % 60);
    const m = Math.floor(sec / 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function setPlayerOpen(open) {
    document.body.classList.toggle('player-open', open);
    playerBar.hidden = !open;
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
      .order('id', { ascending: false });
    if (error) {
      statusEl.textContent = 'Could not load episodes: ' + error.message;
      return;
    }
    episodes = data || [];
    statusEl.textContent = episodes.length ? '' : 'No episodes in the database yet.';
    renderEpisodeList();
  }

  function updateRowButtons() {
    const rows = listEl.querySelectorAll('.episode-play-row');
    rows.forEach((btn, i) => {
      const ep = episodes[i];
      const act = btn.querySelector('.episode-play-action');
      if (!ep || !act) return;
      if (!episodeHasPlayableAudio(ep)) {
        act.textContent = ep.status === 'failed' ? 'Failed' : 'Processing';
        btn.classList.remove('is-active');
        return;
      }
      const isActive = currentEpisode && currentEpisode.id === ep.id;
      btn.classList.toggle('is-active', !!isActive);
      if (!isActive) act.textContent = 'Play';
      else if (!audioEl.paused) act.textContent = 'Pause';
      else if (audioEl.ended) act.textContent = 'Replay';
      else act.textContent = 'Resume';
    });
  }

  function renderEpisodeList() {
    listEl.innerHTML = episodes
      .map(() => {
        return (
          '<button type="button" class="episode-play-row">' +
          '<span class="episode-play-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></span>' +
          '<span class="episode-play-title"></span>' +
          '<span class="episode-play-action">Play</span>' +
          '</button>'
        );
      })
      .join('');
    const rows = listEl.querySelectorAll('.episode-play-row');
    episodes.forEach((ep, i) => {
      const btn = rows[i];
      const titleSpan = btn.querySelector('.episode-play-title');
      if (titleSpan) titleSpan.textContent = ep.title;
      btn.disabled = !episodeHasPlayableAudio(ep);
      btn.classList.toggle('is-failed', ep.status === 'failed');
      btn.addEventListener('click', () => onEpisodeRowClick(ep));
    });
    updateRowButtons();
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
    playToggle.textContent = !audioEl.paused ? 'Pause' : audioEl.ended ? 'Replay' : 'Play';
    updateRowButtons();
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
    updatePlayerUi();
  }

  async function onEpisodeRowClick(ep) {
    if (!sb) await fetchEpisodesTable();
    if (!sb) return;
    if (ep.status === 'failed') {
      statusEl.textContent = 'This episode failed during processing.';
      return;
    }
    if (!episodeHasPlayableAudio(ep)) {
      statusEl.textContent =
        ep.status === 'processing' ? 'Still processing — check back once the podcast is generated.' : 'No audio yet for this episode.';
      return;
    }
    try {
      if (currentEpisode && currentEpisode.id === ep.id) {
        const dur = audioEl.duration;
        if (audioEl.paused) {
          if (Number.isFinite(dur) && dur > 0 && audioEl.currentTime >= dur - 0.35) {
            audioEl.currentTime = 0;
          }
          await audioEl.play().catch(() => {});
        } else audioEl.pause();
        updatePlayerUi();
        return;
      }
      audioEl.pause();
      await loadEpisode(ep);
    } catch (e) {
      statusEl.textContent = 'Playback: ' + (e && e.message ? e.message : String(e));
    }
  }

  playToggle.addEventListener('click', async () => {
    if (!currentEpisode) return;
    try {
      const dur = audioEl.duration;
      if (audioEl.paused) {
        if (Number.isFinite(dur) && dur > 0 && audioEl.currentTime >= dur - 0.35) {
          audioEl.currentTime = 0;
        }
        await audioEl.play().catch(() => {});
      } else audioEl.pause();
      updatePlayerUi();
    } catch (e) {
      statusEl.textContent = 'Playback: ' + (e && e.message ? e.message : String(e));
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
    if (Number.isFinite(v) && Number.isFinite(audioEl.duration)) audioEl.currentTime = v;
    updatePlayerUi();
  }
  scrub.addEventListener('change', finishScrubSeek);
  scrub.addEventListener('mouseup', finishScrubSeek);
  scrub.addEventListener('touchend', finishScrubSeek);
  scrub.addEventListener('input', () => {
    if (!scrubDragging) scrubDragging = true;
    const v = parseFloat(scrub.value);
    if (Number.isFinite(v)) tCur.textContent = fmtTime(v);
  });

  audioEl.addEventListener('timeupdate', updatePlayerUi);
  audioEl.addEventListener('loadedmetadata', updatePlayerUi);
  audioEl.addEventListener('pause', updatePlayerUi);
  audioEl.addEventListener('playing', updatePlayerUi);
  audioEl.addEventListener('ended', updatePlayerUi);

  closeBtn.addEventListener('click', () => {
    audioEl.pause();
    audioEl.removeAttribute('src');
    audioEl.load();
    currentEpisode = null;
    setPlayerOpen(false);
    updateRowButtons();
    tCur.textContent = '0:00';
    tDur.textContent = '0:00';
    scrub.value = '0';
  });

  document.addEventListener('lil-sebastian-episodes-refresh', () => {
    void fetchEpisodesTable();
  });

  fetchEpisodesTable();
})();
