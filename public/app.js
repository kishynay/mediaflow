// ===== DOM References =====
const mainContent = document.getElementById("mainContent");
const searchInput = document.getElementById("searchInput");
const uploadBtn = document.getElementById("uploadBtn");
const fileInput = document.getElementById("fileInput");
const dropZone = document.getElementById("dropZone");
const uploadProgress = document.getElementById("uploadProgress");
const uploadFill = document.getElementById("uploadFill");
const statusToast = document.getElementById("statusToast");

// Player elements
const playerOverlay = document.getElementById("playerOverlay");
const playerContainer = document.getElementById("playerContainer");
const playerCloseBtn = document.getElementById("playerCloseBtn");
const playerMediaArea = document.getElementById("playerMediaArea");
const videoEl = document.getElementById("videoEl");
const audioEl = document.getElementById("audioEl");
const imageEl = document.getElementById("imageEl");
const ambientCanvas = document.getElementById("ambientCanvas");
const visualizerCanvas = document.getElementById("visualizerCanvas");
const audioVisual = document.getElementById("audioVisual");
const audioDisk = document.getElementById("audioDisk");
const audioTitle = document.getElementById("audioTitle");
const imageTools = document.getElementById("imageTools");
const playerControls = document.getElementById("playerControls");
const nowPlaying = document.getElementById("nowPlaying");
const seekContainer = document.getElementById("seekContainer");
const seekTrack = document.getElementById("seekTrack");
const seekSlider = document.getElementById("seekSlider");
const seekFill = document.getElementById("seekFill");
const seekThumb = document.getElementById("seekThumb");
const seekBuffered = document.getElementById("seekBuffered");
const seekHoverTime = document.getElementById("seekHoverTime");
const playPauseBtn = document.getElementById("playPauseBtn");
const ppIcon = document.getElementById("ppIcon");
const ppShape = document.getElementById("ppShape");
const back10Btn = document.getElementById("back10Btn");
const fwd10Btn = document.getElementById("fwd10Btn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const timeDisplay = document.getElementById("timeDisplay");
const speedBtn = document.getElementById("speedBtn");
const speedLabel = document.getElementById("speedLabel");
const speedMenu = document.getElementById("speedMenu");
const volumeBtn = document.getElementById("volumeBtn");
const volumeSlider = document.getElementById("volumeSlider");
const volWave1 = document.getElementById("volWave1");
const volWave2 = document.getElementById("volWave2");
const loopBtn = document.getElementById("loopBtn");
const pipBtn = document.getElementById("pipBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const zoomIn = document.getElementById("zoomIn");
const zoomOut = document.getElementById("zoomOut");
const zoomReset = document.getElementById("zoomReset");
const imgFullscreen = document.getElementById("imgFullscreen");
const skipBackward = document.getElementById("skipBackward");
const skipForward = document.getElementById("skipForward");
const centerAction = document.getElementById("centerAction");
const centerActionIcon = document.getElementById("centerActionIcon");
const centerPlaySvg = document.getElementById("centerPlaySvg");
const shortcutFlash = document.getElementById("shortcutFlash");

// ===== State =====
let mediaLibrary = [];
let currentItem = null;
let activePlayer = null;
let controlsTimer = null;
let imgScale = 1;
let statusTimer = null;
let isLooping = false;
let currentSpeed = 1;
let audioCtx = null;
let analyser = null;
let audioSourceNode = null;
let visualizerRAF = null;
let ambientRAF = null;
const progressMap = JSON.parse(localStorage.getItem("media_progress") || "{}");

const BACKEND_URL = window.location.hostname === "localhost" ? "http://localhost:3000" : "https://mediaflow-backend-z17a.onrender.com";
const AUTH_TOKEN_KEY = "mediaflow_jwt_token";

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function setAuthToken(token) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

function authHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function showAuthLogin(message) {
  document.getElementById('loginPanel').classList.remove('hidden');
  document.querySelector('.app-container').classList.add('hidden');
  if (message) document.getElementById('loginError').textContent = message;
}

function hideAuthLogin() {
  document.getElementById('loginPanel').classList.add('hidden');
  document.querySelector('.app-container').classList.remove('hidden');
  document.getElementById('loginError').textContent = '';
}

async function loginUser() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();

  if (!username || !password) {
    showStatus('Please enter username and password', true);
    return;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Login failed (${res.status})`);
    }

    const body = await res.json();
    setAuthToken(body.token);
    hideAuthLogin();
    fetchLibrary();
    showStatus('Logged in successfully');
  } catch (error) {
    showStatus(error.message || 'Login failed', true);
    document.getElementById('loginError').textContent = error.message;
  }
}

// ===== Utility Functions =====
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatTime(s) {
  if (!Number.isFinite(s)) return "00:00";
  const total = Math.max(0, Math.floor(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function mediaIcon(kind) {
  switch (kind) {
    case "video": return "🎬";
    case "audio": return "🎵";
    case "image": return "🖼️";
    default: return "📄";
  }
}

function kindLabel(kind) {
  switch (kind) {
    case "video": return "Video";
    case "audio": return "Audio";
    case "image": return "Image";
    default: return "File";
  }
}

// ===== Status Toast =====
function showStatus(message, isError = false) {
  if (statusTimer) clearTimeout(statusTimer);
  statusToast.textContent = message;
  statusToast.className = `status-bar visible ${isError ? "error" : "success"}`;
  statusTimer = setTimeout(() => {
    statusToast.classList.remove("visible");
  }, 2500);
}

// ===== Normalize API Data =====
function normalizeItem(raw) {
  const contentType = raw.contentType || "";
  const kind = raw.kind ||
    (contentType.startsWith("video/") ? "video" :
     contentType.startsWith("audio/") ? "audio" :
     contentType.startsWith("image/") ? "image" : "other");
  const id = raw.id || raw._id;
  return {
    id,
    name: raw.name || raw.originalName || id || "Untitled",
    rawName: raw.name || raw.originalName || id || "Untitled",
    source: raw.source || "mongodb",
    size: Number(raw.size || 0),
    modifiedAt: raw.modifiedAt || raw.uploadDate || new Date(0).toISOString(),
    contentType,
    kind,
    url: raw.url || `/api/media/${encodeURIComponent(id)}/stream`
  };
}

// ===== Fetch Media Library =====
async function fetchLibrary() {
  if (!getAuthToken()) {
    showAuthLogin();
    return;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/media`, {
      headers: {
        ...authHeaders(),
        "Accept": "application/json"
      }
    });
    if (!res.ok) {
      if (res.status === 401) {
        clearAuthToken();
        showAuthLogin();
      }
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    mediaLibrary = (data.items || []).map(normalizeItem);
    render();
  } catch (err) {
    console.error("Failed to load media:", err);
    mainContent.innerHTML = `
      <div class="empty-state" style="border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.05);">
        <div class="empty-state-icon">⚠️</div>
        <h3>Connection Error</h3>
        <p>Could not load media from the server.</p>
        <button class="btn btn-primary" onclick="fetchLibrary()">Retry</button>
      </div>
    `;
  }
}

// ===== Video Thumbnail Generator =====
const thumbnailCache = {};

function generateVideoThumbnail(videoUrl) {
  if (thumbnailCache[videoUrl]) return Promise.resolve(thumbnailCache[videoUrl]);

  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "metadata";
    video.src = videoUrl;

    const timeout = setTimeout(() => {
      video.removeAttribute("src");
      video.load();
      resolve(null);
    }, 8000);

    video.addEventListener("loadeddata", () => {
      // Seek to 2 seconds or 10% of duration
      const seekTime = Math.min(2, video.duration * 0.1);
      video.currentTime = seekTime;
    }, { once: true });

    video.addEventListener("seeked", () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 180;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        thumbnailCache[videoUrl] = dataUrl;
        video.removeAttribute("src");
        video.load();
        resolve(dataUrl);
      } catch (e) {
        video.removeAttribute("src");
        video.load();
        resolve(null);
      }
    }, { once: true });

    video.addEventListener("error", () => {
      clearTimeout(timeout);
      resolve(null);
    }, { once: true });
  });
}

// ===== Rendering =====
function getFiltered() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) return mediaLibrary;
  return mediaLibrary.filter(item => item.name.toLowerCase().includes(q));
}

function createCard(item) {
  const isImage = item.kind === "image";
  const isVideo = item.kind === "video";
  const thumbSrc = isImage ? item.url : "";
  const div = document.createElement("div");
  div.className = "media-card";
  div.innerHTML = `
    <div class="card-thumb">
      ${thumbSrc
        ? `<img src="${thumbSrc}" loading="lazy" alt="${item.name}" />`
        : `<div class="card-thumb-placeholder ${isVideo ? 'video-loading' : ''}">${mediaIcon(item.kind)}</div>`
      }
      <div class="card-play-icon"><span>▶</span></div>
    </div>
    <div class="card-info">
      <div class="card-name" title="${item.name}">${item.name}</div>
      <div class="card-meta">
        <span class="card-type-badge">${kindLabel(item.kind)}</span>
        <span>${formatBytes(item.size)}</span>
      </div>
      <div class="card-actions">
        <button class="card-action-btn" data-action="download" title="Download file">Download</button>
        <button class="card-action-btn danger" data-action="delete" title="Delete file">Delete</button>
      </div>
    </div>
  `;
  div.addEventListener("click", () => openPlayer(item));

  const downloadBtn = div.querySelector('[data-action="download"]');
  const deleteBtn = div.querySelector('[data-action="delete"]');

  downloadBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const downloadUrl = `/api/media/${encodeURIComponent(item.id)}/download`;
    window.location.href = downloadUrl;
  });

  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const ok = window.confirm(`Delete "${item.name}"? This cannot be undone.`);
    if (!ok) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/media/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        headers: {
          ...authHeaders(),
          "Accept": "application/json"
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showStatus(`Deleted "${item.name}"`);
      if (currentItem && currentItem.id === item.id) closePlayer();
      await fetchLibrary();
    } catch (err) {
      console.error("Delete failed:", err);
      showStatus("Delete failed", true);
    }
  });

  // Async: generate video thumbnail
  if (isVideo) {
    generateVideoThumbnail(item.url).then(dataUrl => {
      if (dataUrl) {
        const thumbDiv = div.querySelector(".card-thumb");
        const placeholder = thumbDiv.querySelector(".card-thumb-placeholder");
        if (placeholder) {
          const img = document.createElement("img");
          img.src = dataUrl;
          img.alt = item.name;
          img.loading = "lazy";
          img.style.width = "100%";
          img.style.height = "100%";
          img.style.objectFit = "cover";
          placeholder.replaceWith(img);
        }
      }
    });
  }

  return div;
}

function createSection(title, items, icon) {
  if (!items.length) return null;
  const sec = document.createElement("section");
  sec.className = "section animate-in";
  sec.innerHTML = `
    <div class="section-header">
      <h2 class="section-title">${icon} ${title} <span class="count">${items.length}</span></h2>
    </div>
    <div class="media-row"></div>
  `;
  const row = sec.querySelector(".media-row");
  items.forEach(item => row.appendChild(createCard(item)));
  return sec;
}

function render() {
  const filtered = getFiltered();

  if (!mediaLibrary.length) {
    mainContent.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📂</div>
        <h3>No Media Yet</h3>
        <p>Upload your first file to get started. You can also drag & drop files anywhere.</p>
        <button class="btn btn-primary" id="emptyUploadBtn">Upload Media</button>
      </div>
    `;
    const btn = document.getElementById("emptyUploadBtn");
    if (btn) btn.addEventListener("click", () => fileInput.click());
    return;
  }

  if (filtered.length === 0) {
    mainContent.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <h3>No Results</h3>
        <p>No media found matching "${searchInput.value.trim()}"</p>
      </div>
    `;
    return;
  }

  mainContent.innerHTML = "";
  const recent = filtered.slice().sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
  const videos = filtered.filter(x => x.kind === "video");
  const audio = filtered.filter(x => x.kind === "audio");
  const images = filtered.filter(x => x.kind === "image");

  [
    createSection("Recently Added", recent.slice(0, 12), "✨"),
    createSection("Videos", videos, "🎬"),
    createSection("Audio", audio, "🎵"),
    createSection("Images", images, "🖼️"),
  ].forEach(sec => { if (sec) mainContent.appendChild(sec); });
}

// ===== Search =====
let searchDebounce = null;
searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(render, 150);
});

// ===== Upload =====
uploadBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) Array.from(fileInput.files).forEach(f => uploadFile(f));
  fileInput.value = "";
});

async function uploadFile(file) {
  if (!file) return;
  const fd = new FormData();
  fd.append("media", file);
  uploadProgress.classList.add("active");
  uploadFill.style.width = "0%";

  try {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BACKEND_URL}/api/upload`);
    xhr.setRequestHeader("Authorization", `Bearer ${getAuthToken()}`);
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) uploadFill.style.width = Math.round((e.loaded / e.total) * 100) + "%";
    });
    await new Promise((resolve, reject) => {
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Upload failed"));
      xhr.onerror = () => reject(new Error("Upload failed"));
      xhr.send(fd);
    });
    showStatus(`Uploaded "${file.name}"`);
    await fetchLibrary();
  } catch (err) {
    showStatus(err.message || "Upload failed", true);
  } finally {
    uploadProgress.classList.remove("active");
  }
}

// ===== Drag & Drop =====
let dragCounter = 0;
document.addEventListener("dragenter", (e) => { e.preventDefault(); dragCounter++; dropZone.classList.add("active"); });
document.addEventListener("dragleave", (e) => { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { dragCounter = 0; dropZone.classList.remove("active"); } });
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault(); dragCounter = 0; dropZone.classList.remove("active");
  if (e.dataTransfer.files.length) Array.from(e.dataTransfer.files).forEach(f => uploadFile(f));
});


// ===============================================================
// CINEMATIC PLAYER
// ===============================================================

function resetPlayer() {
  [videoEl, audioEl].forEach(el => {
    el.pause(); el.removeAttribute("src"); el.load(); el.classList.add("hidden");
  });
  imageEl.classList.add("hidden");
  audioVisual.classList.add("hidden");
  imageTools.classList.add("hidden");
  playerControls.classList.add("hidden");
  playerControls.classList.remove("hidden-controls");
  visualizerCanvas.classList.add("hidden");
  imgScale = 1;
  imageEl.style.transform = "scale(1)";
  activePlayer = null;
  // Reset portrait mode
  playerContainer.classList.remove("portrait");
  playerMediaArea.classList.remove("portrait");
  stopVisualizer();
  stopAmbient();
}

// --- Open Player ---
function openPlayer(item) {
  if (!item) return;
  currentItem = item;
  nowPlaying.textContent = item.name;
  playerOverlay.classList.add("active");
  resetPlayer();
  document.body.style.overflow = "hidden";
  speedMenu.classList.add("hidden");

  if (item.kind === "image") {
    imageEl.src = item.url;
    imageEl.classList.remove("hidden");
    imageTools.classList.remove("hidden");
    return;
  }

  playerControls.classList.remove("hidden");

  if (item.kind === "video") {
    activePlayer = videoEl;
    videoEl.classList.remove("hidden");
    videoEl.src = item.url;
    videoEl.loop = isLooping;
    videoEl.playbackRate = currentSpeed;
    videoEl.volume = Number(volumeSlider.value);
    startAmbient();
  } else if (item.kind === "audio") {
    activePlayer = audioEl;
    audioEl.classList.remove("hidden");
    audioVisual.classList.remove("hidden");
    audioTitle.textContent = item.name;
    visualizerCanvas.classList.remove("hidden");
    audioEl.src = item.url;
    audioEl.loop = isLooping;
    audioEl.playbackRate = currentSpeed;
    audioEl.volume = Number(volumeSlider.value);
  }

  if (activePlayer) {
    const savedPct = progressMap[item.id] || 0;
    activePlayer.addEventListener("loadedmetadata", function onMeta() {
      activePlayer.removeEventListener("loadedmetadata", onMeta);
      if (activePlayer.duration && savedPct > 0.01 && savedPct < 0.98) {
        activePlayer.currentTime = activePlayer.duration * savedPct;
      }
      // Detect portrait video (9:16) and adapt player
      if (item.kind === "video" && videoEl.videoHeight > videoEl.videoWidth) {
        playerContainer.classList.add("portrait");
        playerMediaArea.classList.add("portrait");
      }
      updatePlayerUI();
    });
    activePlayer.play().catch(() => {});
    showPlayerControls();
  }

  updatePPIcon();
  updateVolumeIcon();
  updateLoopBtn();
}

// --- Close Player ---
function closePlayer() {
  playerOverlay.classList.remove("active");
  resetPlayer();
  currentItem = null;
  document.body.style.overflow = "";
}

// --- Update play/pause SVG icon ---
function updatePPIcon() {
  if (!activePlayer || activePlayer.paused) {
    ppShape.setAttribute("points", "6 3 20 12 6 21");
    centerPlaySvg.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
  } else {
    ppShape.setAttribute("points", "");
    ppIcon.innerHTML = '<rect x="5" y="3" width="4" height="18" rx="1" fill="currentColor"/><rect x="15" y="3" width="4" height="18" rx="1" fill="currentColor"/>';
    centerPlaySvg.innerHTML = '<rect x="5" y="3" width="4" height="18" rx="1" fill="currentColor"/><rect x="15" y="3" width="4" height="18" rx="1" fill="currentColor"/>';
  }

  // Update audio disc spin
  if (audioDisk) {
    if (!activePlayer || activePlayer.paused) {
      audioDisk.classList.add("paused");
    } else {
      audioDisk.classList.remove("paused");
    }
  }
}

// --- Update player UI ---
function updatePlayerUI() {
  if (!activePlayer) return;
  const dur = activePlayer.duration || 0;
  const cur = activePlayer.currentTime || 0;
  const pct = dur ? (cur / dur) * 100 : 0;

  seekSlider.value = dur ? (cur / dur) * 10000 : 0;
  seekFill.style.width = pct + "%";
  seekThumb.style.left = pct + "%";
  timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;

  // Update buffered
  if (activePlayer.buffered.length > 0) {
    const buffEnd = activePlayer.buffered.end(activePlayer.buffered.length - 1);
    seekBuffered.style.width = (dur ? (buffEnd / dur) * 100 : 0) + "%";
  }

  // Save progress
  if (currentItem && dur) {
    progressMap[currentItem.id] = cur / dur;
    localStorage.setItem("media_progress", JSON.stringify(progressMap));
  }

  updatePPIcon();
}

// --- Controls visibility ---
function showPlayerControls() {
  playerControls.classList.remove("hidden-controls");
  if (controlsTimer) clearTimeout(controlsTimer);
  if (activePlayer && !activePlayer.paused) {
    controlsTimer = setTimeout(() => {
      playerControls.classList.add("hidden-controls");
    }, 3000);
  }
}

// --- Navigate tracks ---
function jumpTrack(dir) {
  if (!currentItem) return;
  const sameKind = mediaLibrary.filter(x => x.kind === currentItem.kind);
  if (!sameKind.length) return;
  const idx = sameKind.findIndex(x => x.id === currentItem.id);
  openPlayer(sameKind[(idx + dir + sameKind.length) % sameKind.length]);
}

// --- Flash skip indicators ---
function flashSkip(el) {
  el.classList.remove("flash");
  void el.offsetWidth; // reflow
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 400);
}

// --- Flash center action ---
function flashCenter() {
  centerAction.classList.remove("flash");
  void centerAction.offsetWidth;
  centerAction.classList.add("flash");
}

// --- Flash shortcut text ---
let shortcutTimer = null;
function flashShortcut(text) {
  if (shortcutTimer) clearTimeout(shortcutTimer);
  shortcutFlash.textContent = text;
  shortcutFlash.classList.add("visible");
  shortcutTimer = setTimeout(() => shortcutFlash.classList.remove("visible"), 700);
}

// --- Volume icon update ---
function updateVolumeIcon() {
  const vol = activePlayer ? activePlayer.volume : Number(volumeSlider.value);
  const muted = activePlayer ? activePlayer.muted : false;
  if (muted || vol === 0) {
    volWave1.style.display = "none";
    volWave2.style.display = "none";
  } else if (vol < 0.5) {
    volWave1.style.display = "";
    volWave2.style.display = "none";
  } else {
    volWave1.style.display = "";
    volWave2.style.display = "";
  }
}

// --- Loop button ---
function updateLoopBtn() {
  loopBtn.classList.toggle("loop-active", isLooping);
}


// ===============================================================
// AUDIO VISUALIZER (Canvas-based frequency bars)
// ===============================================================

function initAudioContext(mediaEl) {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();

  if (analyser) analyser.disconnect();

  // Create source node for this element (only once per element)
  if (!mediaEl._sourceNode) {
    mediaEl._sourceNode = audioCtx.createMediaElementSource(mediaEl);
  }
  audioSourceNode = mediaEl._sourceNode;

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 128;
  analyser.smoothingTimeConstant = 0.82;

  audioSourceNode.connect(analyser);
  analyser.connect(audioCtx.destination);
}

function startVisualizer(mediaEl) {
  try {
    initAudioContext(mediaEl);
  } catch (e) {
    console.warn("Could not init audio visualizer:", e);
    return;
  }

  const canvas = visualizerCanvas;
  const ctx = canvas.getContext("2d");
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    visualizerRAF = requestAnimationFrame(draw);
    const w = canvas.width = canvas.clientWidth * window.devicePixelRatio;
    const h = canvas.height = canvas.clientHeight * window.devicePixelRatio;
    ctx.clearRect(0, 0, w, h);

    analyser.getByteFrequencyData(dataArray);

    const barCount = bufferLength;
    const barWidth = (w / barCount) * 0.8;
    const gap = (w / barCount) * 0.2;

    for (let i = 0; i < barCount; i++) {
      const val = dataArray[i] / 255;
      const barH = val * h * 0.9;
      const x = i * (barWidth + gap);
      const y = h - barH;

      // Gradient per bar
      const hue = 170 + (i / barCount) * 40; // teal → cyan
      const alpha = 0.4 + val * 0.6;
      ctx.fillStyle = `hsla(${hue}, 80%, 60%, ${alpha})`;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barH, [barWidth / 2, barWidth / 2, 0, 0]);
      ctx.fill();

      // Glow
      if (val > 0.5) {
        ctx.shadowColor = `hsla(${hue}, 90%, 65%, 0.5)`;
        ctx.shadowBlur = 12;
        ctx.fillRect(x, y, barWidth, barH);
        ctx.shadowBlur = 0;
      }
    }
  }
  draw();
}

function stopVisualizer() {
  if (visualizerRAF) { cancelAnimationFrame(visualizerRAF); visualizerRAF = null; }
}


// ===============================================================
// AMBIENT GLOW (samples video frames onto blurred canvas — throttled)
// ===============================================================

function startAmbient() {
  const ctx = ambientCanvas.getContext("2d", { willReadFrequently: true });
  let lastDraw = 0;
  function drawAmbient(timestamp) {
    ambientRAF = requestAnimationFrame(drawAmbient);
    // Only sample every 500ms to avoid performance issues
    if (timestamp - lastDraw < 500) return;
    lastDraw = timestamp;
    if (videoEl.readyState >= 2) {
      ambientCanvas.width = 16;
      ambientCanvas.height = 9;
      ctx.drawImage(videoEl, 0, 0, 16, 9);
    }
  }
  drawAmbient(0);
}

function stopAmbient() {
  if (ambientRAF) { cancelAnimationFrame(ambientRAF); ambientRAF = null; }
}


// ===============================================================
// EVENT BINDINGS
// ===============================================================

// Close
playerCloseBtn.addEventListener("click", closePlayer);
playerOverlay.addEventListener("click", (e) => {
  if (e.target === playerOverlay || e.target.classList.contains("player-backdrop")) closePlayer();
});

// Play/Pause
playPauseBtn.addEventListener("click", () => {
  if (!activePlayer) return;
  if (activePlayer.paused) {
    activePlayer.play();
    // Start visualizer for audio on first play
    if (currentItem?.kind === "audio" && !visualizerRAF) startVisualizer(activePlayer);
  } else {
    activePlayer.pause();
  }
  flashCenter();
});

// Click on media area = play/pause toggle
playerMediaArea.addEventListener("click", (e) => {
  // Don't toggle if clicking controls or image tools
  if (e.target.closest(".player-controls") || e.target.closest(".image-tools") ||
      e.target.closest(".skip-indicator") || !activePlayer) return;
  if (activePlayer.paused) {
    activePlayer.play();
    if (currentItem?.kind === "audio" && !visualizerRAF) startVisualizer(activePlayer);
  } else {
    activePlayer.pause();
  }
  flashCenter();
});

// Skip buttons
back10Btn.addEventListener("click", () => {
  if (!activePlayer) return;
  activePlayer.currentTime = Math.max(0, activePlayer.currentTime - 10);
  flashSkip(skipBackward);
  showPlayerControls();
});
fwd10Btn.addEventListener("click", () => {
  if (!activePlayer || !Number.isFinite(activePlayer.duration)) return;
  activePlayer.currentTime = Math.min(activePlayer.duration, activePlayer.currentTime + 10);
  flashSkip(skipForward);
  showPlayerControls();
});

// Prev / Next
prevBtn.addEventListener("click", () => jumpTrack(-1));
nextBtn.addEventListener("click", () => jumpTrack(1));

// Seek bar
seekSlider.addEventListener("input", () => {
  if (!activePlayer || !Number.isFinite(activePlayer.duration)) return;
  const ratio = Number(seekSlider.value) / 10000;
  activePlayer.currentTime = ratio * activePlayer.duration;
  seekFill.style.width = (ratio * 100) + "%";
  seekThumb.style.left = (ratio * 100) + "%";
  updatePlayerUI();
});

// Seek hover time tooltip
seekContainer.addEventListener("mousemove", (e) => {
  if (!activePlayer || !Number.isFinite(activePlayer.duration)) return;
  const rect = seekContainer.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, x / rect.width));
  const time = ratio * activePlayer.duration;
  seekHoverTime.textContent = formatTime(time);
  seekHoverTime.style.left = x + "px";
});

// Speed menu
speedBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  speedMenu.classList.toggle("hidden");
});

speedMenu.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-speed]");
  if (!btn) return;
  currentSpeed = Number(btn.dataset.speed);
  speedLabel.textContent = currentSpeed + "×";
  if (activePlayer) activePlayer.playbackRate = currentSpeed;
  speedMenu.querySelectorAll("button").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  speedMenu.classList.add("hidden");
  flashShortcut(`Speed: ${currentSpeed}×`);
});

// Close speed menu when clicking elsewhere
document.addEventListener("click", () => speedMenu.classList.add("hidden"));

// Volume
volumeSlider.addEventListener("input", () => {
  if (activePlayer) {
    activePlayer.volume = Number(volumeSlider.value);
    activePlayer.muted = false;
  }
  updateVolumeIcon();
});

volumeBtn.addEventListener("click", () => {
  if (!activePlayer) return;
  activePlayer.muted = !activePlayer.muted;
  updateVolumeIcon();
  flashShortcut(activePlayer.muted ? "Muted" : "Unmuted");
});

// Loop
loopBtn.addEventListener("click", () => {
  isLooping = !isLooping;
  if (activePlayer) activePlayer.loop = isLooping;
  updateLoopBtn();
  flashShortcut(isLooping ? "Loop: ON" : "Loop: OFF");
});

// PiP
pipBtn.addEventListener("click", async () => {
  if (!videoEl.src || currentItem?.kind !== "video") {
    flashShortcut("PiP: video only");
    return;
  }
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else {
      await videoEl.requestPictureInPicture();
    }
  } catch (err) {
    flashShortcut("PiP not supported");
  }
});

// Fullscreen
fullscreenBtn.addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    playerContainer.requestFullscreen?.().catch(() => {});
  }
});

// Image controls
zoomIn.addEventListener("click", () => { imgScale = Math.min(4, imgScale + 0.25); imageEl.style.transform = `scale(${imgScale})`; });
zoomOut.addEventListener("click", () => { imgScale = Math.max(0.5, imgScale - 0.25); imageEl.style.transform = `scale(${imgScale})`; });
zoomReset.addEventListener("click", () => { imgScale = 1; imageEl.style.transform = "scale(1)"; });
imgFullscreen.addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else playerContainer.requestFullscreen?.().catch(() => {});
});
imageEl.addEventListener("wheel", (e) => {
  e.preventDefault();
  imgScale = Math.max(0.5, Math.min(4, imgScale + (e.deltaY < 0 ? 0.15 : -0.15)));
  imageEl.style.transform = `scale(${imgScale})`;
}, { passive: false });

// AV events
[videoEl, audioEl].forEach(el => {
  el.addEventListener("timeupdate", updatePlayerUI);
  el.addEventListener("play", () => { updatePlayerUI(); showPlayerControls(); updatePPIcon(); });
  el.addEventListener("pause", () => { updatePlayerUI(); playerControls.classList.remove("hidden-controls"); updatePPIcon(); });
  el.addEventListener("ended", () => { if (!isLooping) jumpTrack(1); });
  el.addEventListener("error", () => {
    showStatus("Unable to play this media file", true);
    console.error("Playback error:", el.error);
  });
});

imageEl.addEventListener("error", () => showStatus("Unable to load this image", true));

// Controls visibility
playerMediaArea.addEventListener("mousemove", showPlayerControls);
playerMediaArea.addEventListener("touchstart", showPlayerControls, { passive: true });

// Double-tap to skip (mobile)
let lastTapTime = 0;
let lastTapX = 0;
playerMediaArea.addEventListener("touchend", (e) => {
  const now = Date.now();
  const x = e.changedTouches[0]?.clientX || 0;
  if (now - lastTapTime < 300) {
    const rect = playerMediaArea.getBoundingClientRect();
    const pos = (x - rect.left) / rect.width;
    if (pos < 0.35 && activePlayer) {
      activePlayer.currentTime = Math.max(0, activePlayer.currentTime - 10);
      flashSkip(skipBackward);
    } else if (pos > 0.65 && activePlayer) {
      activePlayer.currentTime = Math.min(activePlayer.duration || 0, activePlayer.currentTime + 10);
      flashSkip(skipForward);
    }
  }
  lastTapTime = now;
  lastTapX = x;
});

// Swipe left/right to navigate between videos
let swipeStartX = 0;
let swipeStartY = 0;
let swipeStartTime = 0;

playerMediaArea.addEventListener("touchstart", (e) => {
  const touch = e.touches[0];
  swipeStartX = touch.clientX;
  swipeStartY = touch.clientY;
  swipeStartTime = Date.now();
}, { passive: true });

playerMediaArea.addEventListener("touchend", (e) => {
  const touch = e.changedTouches[0];
  if (!touch) return;

  const deltaX = touch.clientX - swipeStartX;
  const deltaY = touch.clientY - swipeStartY;
  const elapsed = Date.now() - swipeStartTime;

  // Must be a quick swipe (< 400ms), horizontal (> 50px), and more horizontal than vertical
  if (elapsed < 400 && Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
    if (deltaX < 0) {
      // Swipe left → next video
      jumpTrack(1);
      flashShortcut("Next ▶▶");
    } else {
      // Swipe right → previous video
      jumpTrack(-1);
      flashShortcut("◀◀ Previous");
    }
  }
});


// ===============================================================
// KEYBOARD SHORTCUTS
// ===============================================================

document.addEventListener("keydown", (e) => {
  const tag = e.target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;

  if (e.key === "Escape" && playerOverlay.classList.contains("active")) {
    closePlayer(); return;
  }

  if (!activePlayer || !playerOverlay.classList.contains("active")) return;

  switch (e.code) {
    case "Space":
      e.preventDefault();
      playPauseBtn.click();
      showPlayerControls();
      break;

    case "KeyJ":
      activePlayer.currentTime = Math.max(0, activePlayer.currentTime - 10);
      flashSkip(skipBackward);
      flashShortcut("-10s");
      showPlayerControls();
      break;

    case "KeyL":
      activePlayer.currentTime = Math.min(activePlayer.duration || 0, activePlayer.currentTime + 10);
      flashSkip(skipForward);
      flashShortcut("+10s");
      showPlayerControls();
      break;

    case "KeyM":
      activePlayer.muted = !activePlayer.muted;
      updateVolumeIcon();
      flashShortcut(activePlayer.muted ? "🔇 Muted" : "🔊 Unmuted");
      break;

    case "KeyF":
      fullscreenBtn.click();
      break;

    case "KeyP":
      pipBtn.click();
      break;

    case "KeyR":
      loopBtn.click();
      break;

    case "ArrowLeft":
      e.preventDefault();
      activePlayer.currentTime = Math.max(0, activePlayer.currentTime - 5);
      flashSkip(skipBackward);
      flashShortcut("-5s");
      showPlayerControls();
      break;

    case "ArrowRight":
      e.preventDefault();
      activePlayer.currentTime = Math.min(activePlayer.duration || 0, activePlayer.currentTime + 5);
      flashSkip(skipForward);
      flashShortcut("+5s");
      showPlayerControls();
      break;

    case "ArrowUp":
      e.preventDefault();
      if (activePlayer) {
        activePlayer.volume = Math.min(1, activePlayer.volume + 0.05);
        volumeSlider.value = activePlayer.volume;
        updateVolumeIcon();
        flashShortcut(`🔊 ${Math.round(activePlayer.volume * 100)}%`);
      }
      break;

    case "ArrowDown":
      e.preventDefault();
      if (activePlayer) {
        activePlayer.volume = Math.max(0, activePlayer.volume - 0.05);
        volumeSlider.value = activePlayer.volume;
        updateVolumeIcon();
        flashShortcut(`🔉 ${Math.round(activePlayer.volume * 100)}%`);
      }
      break;

    case "Period":
      if (e.shiftKey) { // >
        currentSpeed = Math.min(3, currentSpeed + 0.25);
        if (activePlayer) activePlayer.playbackRate = currentSpeed;
        speedLabel.textContent = currentSpeed + "×";
        flashShortcut(`Speed: ${currentSpeed}×`);
      }
      break;

    case "Comma":
      if (e.shiftKey) { // <
        currentSpeed = Math.max(0.25, currentSpeed - 0.25);
        if (activePlayer) activePlayer.playbackRate = currentSpeed;
        speedLabel.textContent = currentSpeed + "×";
        flashShortcut(`Speed: ${currentSpeed}×`);
      }
      break;
  }
});

// Login panel wiring
const loginBtn = document.getElementById('loginBtn');
if (loginBtn) {
  loginBtn.addEventListener('click', loginUser);
}

const loginPassword = document.getElementById('loginPassword');
if (loginPassword) {
  loginPassword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loginUser();
  });
}

if (!getAuthToken()) {
  showAuthLogin();
} else {
  hideAuthLogin();
  fetchLibrary();
}

// ===== Init =====

