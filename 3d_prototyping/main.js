// ============================================================================
// Constants
// ============================================================================

const LS_KEYS = {
  API_KEY: 'hunyuan3d_api_key',
  IMAGE_B64: 'hunyuan3d_image_b64',
  REQUEST_ID: 'hunyuan3d_request_id',
  LAST_STATUS: 'hunyuan3d_last_status',
  LAST_RESULT: 'hunyuan3d_last_result',
  GLB_URL: 'hunyuan3d_glb_url',
  RETOPO_REQUEST_ID: 'hunyuan3d_retopo_request_id',
  RETOPO_STATUS: 'hunyuan3d_retopo_status',
  RETOPO_RESULT: 'hunyuan3d_retopo_result',
  RETOPO_GLB_URL: 'hunyuan3d_retopo_glb_url'
};

const FAL_BASE = 'https://queue.fal.run';
const FAL_MODEL = 'fal-ai/hunyuan3d-v3/image-to-3d';
const FAL_MODEL_BASE = 'fal-ai/hunyuan3d'; // For status/result requests
const FAL_RETOPO = 'fal-ai/hunyuan-3d/v3.1/smart-topology';
const POLL_MS = 3000;
const MAX_POLLS = 200; // 10 min timeout

// ============================================================================
// State
// ============================================================================

const state = {
  apiKey: '',
  imageB64: '',
  requestId: '',
  pollTimer: null,
  pollCount: 0,
  scene: null,
  engine: null,
  meshes: [],
  camera: null,
  currentModel: 'original', // 'original' or 'retopo'
  retopoPollTimer: null,
  retopoRequestId: '',
  repoPollCount: 0,
  retopoMeshes: [],
  originalStatsSaved: false,
  generationId: null
};

// ============================================================================
// Utility Functions
// ============================================================================

function loadStateFromStorage() {
  state.apiKey = localStorage.getItem(LS_KEYS.API_KEY) || '';
  state.imageB64 = localStorage.getItem(LS_KEYS.IMAGE_B64) || '';
  state.requestId = localStorage.getItem(LS_KEYS.REQUEST_ID) || '';
}

function saveToLocalStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      showError('localStorage full: image too large');
      console.error('QuotaExceededError:', e);
    } else {
      throw e;
    }
  }
}

function setStatus(text, pct = null) {
  const msgEl = document.getElementById('status-message');
  msgEl.textContent = text;
  msgEl.classList.add('active');

  if (pct !== null) {
    const barEl = document.getElementById('progress-bar');
    const fillEl = document.getElementById('progress-fill');
    barEl.classList.add('active');
    fillEl.style.width = Math.min(100, Math.max(0, pct)) + '%';
  }
}

function clearStatus() {
  const msgEl = document.getElementById('status-message');
  const barEl = document.getElementById('progress-bar');
  const fillEl = document.getElementById('progress-fill');
  msgEl.classList.remove('active');
  msgEl.textContent = 'Ready';
  barEl.classList.remove('active');
  fillEl.style.width = '0%';
}

function showError(msg) {
  const errEl = document.getElementById('error-message');
  errEl.textContent = msg;
  errEl.classList.add('active');
}

function clearError() {
  const errEl = document.getElementById('error-message');
  errEl.classList.remove('active');
  errEl.textContent = '';
}

function setGenerating(active) {
  const btn = document.getElementById('generate-btn');
  btn.disabled = active || !state.imageB64;
}

function clearScene() {
  if (state.meshes) {
    state.meshes.forEach(mesh => {
      if (mesh.material) {
        if (mesh.material.getActiveTextures) {
          mesh.material.getActiveTextures().forEach(tex => tex.dispose());
        }
        mesh.material.dispose();
      }
      mesh.dispose();
    });
  }
  state.meshes = [];

  // Reset FilesInput to prevent stale entries
  if (window.BABYLON && window.BABYLON.FilesInput) {
    window.BABYLON.FilesInput.FilesToLoad = {};
  }

  const overlay = document.getElementById('canvas-overlay');
  overlay.classList.remove('hidden');

  // Hide stats
  document.getElementById('model-stats').style.display = 'none';
}

function calculateModelStats() {
  let totalVertices = 0;
  let totalFaces = 0;

  state.meshes.forEach(mesh => {
    if (mesh.geometry) {
      const positions = mesh.geometry.getVerticesData(window.BABYLON.VertexBuffer.PositionKind);
      const indices = mesh.geometry.getIndices();

      if (positions) {
        totalVertices += positions.length / 3; // 3 values per vertex (x, y, z)
      }
      if (indices) {
        totalFaces += indices.length / 3; // 3 indices per face (triangle)
      }
    }
  });

  return {
    vertices: Math.round(totalVertices),
    faces: Math.round(totalFaces)
  };
}

function displayModelStats() {
  const stats = calculateModelStats();
  const modelType = state.currentModel === 'retopo' ? 'Retopologized' : 'Original';
  document.getElementById('model-type').textContent = modelType;
  document.getElementById('vertex-count').textContent = stats.vertices.toLocaleString();
  document.getElementById('face-count').textContent = stats.faces.toLocaleString();
  document.getElementById('model-stats').style.display = 'block';

  // Show retopology section if original model is loaded
  if (state.currentModel === 'original') {
    document.getElementById('retopology-section').style.display = 'block';
  }

  // Save stats to generation history if viewing original
  if (state.currentModel === 'original' && !state.originalStatsSaved) {
    saveGenerationHistory('original', stats);
    state.originalStatsSaved = true;
  }
}

function saveGenerationHistory(modelType, stats) {
  const generationId = Date.now();
  state.generationId = generationId;
  const generationData = {
    timestamp: new Date().toISOString(),
    glbUrl: localStorage.getItem(LS_KEYS.GLB_URL),
    originalVertices: stats.vertices,
    originalFaces: stats.faces
  };

  try {
    localStorage.setItem(`hunyuan3d_generation_${generationId}`, JSON.stringify(generationData));
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      showError('Storage full: Clear history to save new generations');
      console.error('localStorage quota exceeded');
    } else {
      throw e;
    }
  }
}

function updateGenerationHistory(generationId, updates) {
  const key = `hunyuan3d_generation_${generationId}`;
  const existing = JSON.parse(localStorage.getItem(key) || '{}');
  const updated = { ...existing, ...updates };
  localStorage.setItem(key, JSON.stringify(updated));
}

function downloadGLB() {
  const glbUrl = localStorage.getItem(LS_KEYS.GLB_URL);
  if (!glbUrl) {
    showError('No model URL available');
    return;
  }

  fetch(glbUrl)
    .then(r => r.blob())
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'model.glb';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    })
    .catch(err => {
      showError('Download failed: ' + err.message);
    });
}

// ============================================================================
// UI Setup
// ============================================================================

function closeSettings() {
  document.getElementById('settings-modal').classList.remove('active');
}

function setupAPIKeyUI() {
  const settingsBtn = document.getElementById('settings-btn');
  const modal = document.getElementById('settings-modal');
  const input = document.getElementById('settings-api-key-input');
  const toggle = document.getElementById('settings-toggle-btn');
  const saveBtn = document.getElementById('settings-save-btn');

  // Open modal
  settingsBtn.addEventListener('click', () => {
    input.value = state.apiKey;
    modal.classList.add('active');
  });

  // Toggle visibility
  toggle.addEventListener('click', () => {
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    toggle.textContent = isPassword ? 'Hide' : 'Show';
  });

  // Save API key
  saveBtn.addEventListener('click', () => {
    state.apiKey = input.value;
    saveToLocalStorage(LS_KEYS.API_KEY, input.value);
    closeSettings();
  });

  // Real-time update
  input.addEventListener('input', () => {
    state.apiKey = input.value;
  });
}

function setupImagePaste() {
  window.addEventListener('paste', handlePaste);
}

function handlePaste(e) {
  const items = e.clipboardData?.items || [];
  for (let item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      const reader = new FileReader();
      reader.onload = (evt) => {
        const dataUrl = evt.target.result;
        state.imageB64 = dataUrl;
        saveToLocalStorage(LS_KEYS.IMAGE_B64, dataUrl);
        updateImagePreview(dataUrl);
        document.getElementById('generate-btn').disabled = false;
        clearError();
      };
      reader.readAsDataURL(file);
      break;
    }
  }
}

function updateImagePreview(dataUrl) {
  const zone = document.getElementById('paste-zone');
  const preview = document.getElementById('image-preview');
  const text = document.getElementById('paste-zone-text');

  preview.src = dataUrl;
  preview.style.display = 'block';
  text.style.display = 'none';
  zone.classList.add('has-image');
}

function setupGenerateButton() {
  const btn = document.getElementById('generate-btn');
  btn.addEventListener('click', () => {
    clearError();
    clearStatus();
    clearScene();
    startGeneration();
  });
}

// ============================================================================
// FAL.ai Integration
// ============================================================================

function startGeneration() {
  if (!state.apiKey) {
    showError('Please enter API key');
    return;
  }
  if (!state.imageB64) {
    showError('Please paste an image');
    return;
  }

  setGenerating(true);
  setStatus('Submitting...', 5);
  localStorage.removeItem(LS_KEYS.GLB_URL);
  localStorage.removeItem(LS_KEYS.RETOPO_GLB_URL);
  state.retopoMeshes = [];
  state.currentModel = 'original';
  document.getElementById('model-selector').style.display = 'none';
  document.getElementById('retopology-section').style.display = 'none';

  const url = `${FAL_BASE}/${FAL_MODEL}`;
  const body = {
    input_image_url: state.imageB64,
    enable_pbr: false
  };

  fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${state.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
    .then(r => r.json())
    .then(data => {
      if (data.request_id) {
        state.requestId = data.request_id;
        saveToLocalStorage(LS_KEYS.REQUEST_ID, data.request_id);
        saveToLocalStorage(LS_KEYS.LAST_STATUS, 'pending');
        state.pollCount = 0;
        startPolling();
      } else {
        showError(data.detail || 'Failed to start generation');
        setGenerating(false);
      }
    })
    .catch(err => {
      showError('Network error: ' + err.message);
      setGenerating(false);
    });
}

function startPolling() {
  pollStatus();
}

function pollStatus() {
  if (!state.requestId) {
    showError('No active request');
    setGenerating(false);
    return;
  }

  state.pollCount++;
  if (state.pollCount > MAX_POLLS) {
    showError('Generation timeout (6 min exceeded)');
    clearRequestId();
    setGenerating(false);
    return;
  }

  const url = `${FAL_BASE}/${FAL_MODEL_BASE}/requests/${state.requestId}/status`;

  fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Key ${state.apiKey}`
    }
  })
    .then(r => r.json())
    .then(data => {
      const status = data.status;
      const pct = 10 + (state.pollCount / MAX_POLLS) * 70; // 10% to 80%

      if (status === 'IN_QUEUE') {
        setStatus('Queued...', pct);
        schedulePoll();
      } else if (status === 'IN_PROGRESS') {
        setStatus('Generating...', pct);
        schedulePoll();
      } else if (status === 'COMPLETED') {
        saveToLocalStorage(LS_KEYS.LAST_STATUS, 'completed');
        setStatus('Processing result...', 85);
        fetchResult();
      } else if (status === 'FAILED') {
        const reason = data.error || 'Unknown error';
        showError('Generation failed: ' + reason);
        saveToLocalStorage(LS_KEYS.LAST_STATUS, 'failed');
        clearRequestId();
        setGenerating(false);
      } else {
        schedulePoll();
      }
    })
    .catch(err => {
      showError('Poll error: ' + err.message);
      setGenerating(false);
    });
}

function schedulePoll() {
  if (state.pollTimer) clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(() => {
    pollStatus();
  }, POLL_MS);
}

function fetchResult() {
  if (!state.requestId) {
    showError('No active request');
    setGenerating(false);
    return;
  }

  const url = `${FAL_BASE}/${FAL_MODEL_BASE}/requests/${state.requestId}`;

  fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Key ${state.apiKey}`
    }
  })
    .then(r => r.json())
    .then(data => {
      if (data.model_glb?.url) {
        saveToLocalStorage(LS_KEYS.LAST_RESULT, JSON.stringify(data));
        saveToLocalStorage(LS_KEYS.GLB_URL, data.model_glb.url);
        setStatus('Loading model...', 90);
        loadGLBModel(data);
        clearRequestId();
        setGenerating(false);
      } else {
        showError('No model URL in response');
        setGenerating(false);
      }
    })
    .catch(err => {
      showError('Result fetch error: ' + err.message);
      setGenerating(false);
    });
}

function clearRequestId() {
  state.requestId = '';
  localStorage.removeItem(LS_KEYS.REQUEST_ID);
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
}

// ============================================================================
// GLB Loading
// ============================================================================

async function loadGLBModel(result) {
  try {
    const glbUrl = result.model_glb?.url;

    if (!glbUrl) {
      showError('Missing GLB URL in result');
      setGenerating(false);
      return;
    }

    // Fetch GLB file
    setStatus('Fetching model...', 92);
    const glbBlob = await fetch(glbUrl).then(r => r.blob());

    // Register GLB file
    setStatus('Loading model...', 95);
    const BABYLON = window.BABYLON;
    BABYLON.FilesInput.FilesToLoad['model.glb'] = new File([glbBlob], 'model.glb', { type: 'model/gltf-binary' });

    // Load GLB model
    setStatus('Rendering model...', 98);
    const importResult = await BABYLON.SceneLoader.ImportMeshAsync(
      '',
      'file:',
      'model.glb',
      state.scene
    );

    state.meshes = importResult.meshes.filter(m => m.name !== '__root__');

    // Fit camera
    if (state.meshes.length > 0) {
      fitCameraToMeshes(state.meshes);
      displayModelStats();
    }

    // Check if there's a stored retopo model
    const retopoResult = localStorage.getItem(LS_KEYS.RETOPO_RESULT);
    if (retopoResult) {
      try {
        const result = JSON.parse(retopoResult);
        if (result.model_glb?.url) {
          loadStoredRetopoModel(result);
        }
      } catch (e) {
        console.error('Failed to load stored retopo model:', e);
      }
    }

    setStatus('Complete!', 100);
    clearStatus();
    document.getElementById('canvas-overlay').classList.add('hidden');

  } catch (err) {
    console.error('GLB loading error:', err);
    showError('Model loading failed: ' + err.message);
    setGenerating(false);
  }
}

function fitCameraToMeshes(meshes) {
  const camera = state.camera;
  if (!camera) return;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  meshes.forEach(mesh => {
    const bb = mesh.getBoundingInfo().boundingBox;
    minX = Math.min(minX, bb.minimumWorld.x);
    minY = Math.min(minY, bb.minimumWorld.y);
    minZ = Math.min(minZ, bb.minimumWorld.z);
    maxX = Math.max(maxX, bb.maximumWorld.x);
    maxY = Math.max(maxY, bb.maximumWorld.y);
    maxZ = Math.max(maxZ, bb.maximumWorld.z);
  });

  const center = new window.BABYLON.Vector3(
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2
  );

  const diag = Math.sqrt(
    (maxX - minX) ** 2 +
    (maxY - minY) ** 2 +
    (maxZ - minZ) ** 2
  );

  const radius = diag * 0.6; // 1.2x diagonal / 2

  camera.target = center;
  camera.radius = radius > 1 ? radius : 5;
}

// ============================================================================
// Babylon.js Scene
// ============================================================================

function initBabylon() {
  const canvas = document.getElementById('renderCanvas');
  const engine = new window.BABYLON.Engine(canvas, true, { adaptToDeviceRatio: true });
  const scene = new window.BABYLON.Scene(engine);

  state.engine = engine;
  state.scene = scene;

  // Background
  scene.clearColor = new window.BABYLON.Color4(0.07, 0.07, 0.12, 1);

  // Camera
  const camera = new window.BABYLON.ArcRotateCamera(
    'camera',
    -Math.PI / 2,
    Math.PI / 3,
    5,
    window.BABYLON.Vector3.Zero(),
    scene
  );
  camera.attachControl(canvas, true);
  camera.wheelPrecision = 20;
  state.camera = camera;

  // Lights
  const hemiLight = new window.BABYLON.HemisphericLight('hemi', new window.BABYLON.Vector3(0, 1, 0), scene);
  hemiLight.intensity = 0.6;

  const dirLight = new window.BABYLON.DirectionalLight('dir', new window.BABYLON.Vector3(-1, -1, -1), scene);
  dirLight.intensity = 0.8;
  dirLight.position = new window.BABYLON.Vector3(20, 20, 20);

  // Render loop
  engine.runRenderLoop(() => {
    scene.render();
  });

  // Resize
  window.addEventListener('resize', () => {
    engine.resize();
  });

  // Silence material loading warnings
  window.BABYLON.OBJFileLoader.MATERIAL_LOADING_FAILS_SILENTLY = true;
}

// ============================================================================
// Restore In-Flight Request
// ============================================================================

function restoreInFlightRequest() {
  const lastStatus = localStorage.getItem(LS_KEYS.LAST_STATUS);
  const lastResult = localStorage.getItem(LS_KEYS.LAST_RESULT);

  if (lastStatus === 'completed' && lastResult) {
    try {
      const result = JSON.parse(lastResult);
      setStatus('Restoring previous result...', 5);
      loadGLBModel(result);
    } catch (e) {
      console.error('Failed to parse last result:', e);
    }
  }

  if (state.requestId && lastStatus === 'pending') {
    setStatus('Resuming generation...', 10);
    setGenerating(true);
    state.pollCount = 0;
    startPolling();
  }
}

// ============================================================================
// Retopology Functions
// ============================================================================

function startRetopology() {
  if (!state.apiKey) {
    showError('Please enter API key');
    return;
  }

  const glbUrl = localStorage.getItem(LS_KEYS.GLB_URL);
  if (!glbUrl) {
    showError('No model to retopologize');
    return;
  }

  setStatus('Submitting retopology...', 5);

  const faceLevel = document.getElementById('face-level').value;
  const polygonType = document.getElementById('polygon-type').value;

  // Try OBJ format first as it may be more compatible
  const objUrl = localStorage.getItem(LS_KEYS.LAST_RESULT)
    ? JSON.parse(localStorage.getItem(LS_KEYS.LAST_RESULT)).model_urls?.obj?.url
    : null;

  const fileUrl = objUrl || glbUrl;
  const fileType = objUrl ? 'obj' : 'glb';

  const url = `${FAL_BASE}/${FAL_RETOPO}`;
  const body = {
    input_file_url: fileUrl,
    input_file_type: fileType,
    face_level: faceLevel,
    polygon_type: polygonType
  };

  fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${state.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
    .then(r => r.json())
    .then(data => {
      if (data.request_id) {
        state.retopoRequestId = data.request_id;
        saveToLocalStorage(LS_KEYS.RETOPO_REQUEST_ID, data.request_id);
        saveToLocalStorage(LS_KEYS.RETOPO_STATUS, 'pending');
        state.repoPollCount = 0;
        pollRetopoStatus();
      } else {
        showError(data.detail || 'Failed to start retopology');
      }
    })
    .catch(err => {
      showError('Network error: ' + err.message);
    });
}

function pollRetopoStatus() {
  if (!state.retopoRequestId) {
    showError('No active retopo request');
    return;
  }

  state.repoPollCount++;
  if (state.repoPollCount > MAX_POLLS) {
    showError('Retopology timeout (6 min exceeded)');
    state.retopoRequestId = '';
    localStorage.removeItem(LS_KEYS.RETOPO_REQUEST_ID);
    return;
  }

  const url = `${FAL_BASE}/${FAL_MODEL_BASE}/requests/${state.retopoRequestId}/status`;

  fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Key ${state.apiKey}`
    }
  })
    .then(r => r.json())
    .then(data => {
      const status = data.status;
      const pct = 10 + (state.repoPollCount / MAX_POLLS) * 70;

      if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') {
        setStatus(`Retopologizing... (${status})`, pct);
        scheduleRetopoPoll();
      } else if (status === 'COMPLETED') {
        saveToLocalStorage(LS_KEYS.RETOPO_STATUS, 'completed');
        setStatus('Loading retopologized model...', 85);
        fetchRetopoResult();
      } else if (status === 'FAILED') {
        const reason = data.error || 'Unknown error';
        showError('Retopology failed: ' + reason);
        saveToLocalStorage(LS_KEYS.RETOPO_STATUS, 'failed');
        state.retopoRequestId = '';
        localStorage.removeItem(LS_KEYS.RETOPO_REQUEST_ID);
      } else {
        scheduleRetopoPoll();
      }
    })
    .catch(err => {
      showError('Poll error: ' + err.message);
    });
}

function scheduleRetopoPoll() {
  if (state.retopoPollTimer) clearTimeout(state.retopoPollTimer);
  state.retopoPollTimer = setTimeout(() => {
    pollRetopoStatus();
  }, POLL_MS);
}

function fetchRetopoResult() {
  if (!state.retopoRequestId) {
    showError('No active retopo request');
    return;
  }

  const url = `${FAL_BASE}/${FAL_MODEL_BASE}/requests/${state.retopoRequestId}`;

  fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Key ${state.apiKey}`
    }
  })
    .then(r => r.json())
    .then(data => {
      if (data.model_glb?.url) {
        saveToLocalStorage(LS_KEYS.RETOPO_RESULT, JSON.stringify(data));
        saveToLocalStorage(LS_KEYS.RETOPO_GLB_URL, data.model_glb.url);
        loadRetopoModel(data);
        state.retopoRequestId = '';
        localStorage.removeItem(LS_KEYS.RETOPO_REQUEST_ID);
      } else {
        showError('No retopo model in response');
      }
    })
    .catch(err => {
      showError('Result fetch error: ' + err.message);
    });
}

async function loadRetopoModel(result) {
  try {
    const glbUrl = result.model_glb?.url;

    if (!glbUrl) {
      showError('Missing retopo GLB URL');
      return;
    }

    setStatus('Fetching retopologized model...', 92);
    const glbBlob = await fetch(glbUrl).then(r => r.blob());

    setStatus('Loading retopologized model...', 95);
    const BABYLON = window.BABYLON;
    BABYLON.FilesInput.FilesToLoad['model_retopo.glb'] = new File([glbBlob], 'model_retopo.glb', { type: 'model/gltf-binary' });

    const importResult = await BABYLON.SceneLoader.ImportMeshAsync(
      '',
      'file:',
      'model_retopo.glb',
      state.scene
    );

    const retopoMeshes = importResult.meshes.filter(m => m.name !== '__root__');

    // Store and display
    saveRetopoMeshes(retopoMeshes);

    // Save retopo stats to history
    if (state.generationId) {
      const retopoStats = calculateModelStats();
      updateGenerationHistory(state.generationId, {
        retopGlbUrl: localStorage.getItem(LS_KEYS.RETOPO_GLB_URL),
        retopVertices: retopoStats.vertices,
        retopFaces: retopoStats.faces
      });
    }

    setStatus('Complete!', 100);
    clearStatus();

    // Show model selector
    document.getElementById('model-selector').style.display = 'block';

    // Switch to retopo view
    switchModel('retopo');

  } catch (err) {
    console.error('Retopo loading error:', err);
    showError('Retopo model loading failed: ' + err.message);
  }
}

function saveRetopoMeshes(meshes) {
  if (!state.retopoMeshes) state.retopoMeshes = [];
  state.retopoMeshes = meshes;
}

async function loadStoredRetopoModel(result) {
  try {
    const glbUrl = result.model_glb?.url;
    if (!glbUrl) return;

    const glbBlob = await fetch(glbUrl).then(r => r.blob());
    const BABYLON = window.BABYLON;
    BABYLON.FilesInput.FilesToLoad['model_retopo.glb'] = new File([glbBlob], 'model_retopo.glb', { type: 'model/gltf-binary' });

    const importResult = await BABYLON.SceneLoader.ImportMeshAsync(
      '',
      'file:',
      'model_retopo.glb',
      state.scene
    );

    const retopoMeshes = importResult.meshes.filter(m => m.name !== '__root__');
    saveRetopoMeshes(retopoMeshes);
    document.getElementById('model-selector').style.display = 'block';
  } catch (err) {
    console.error('Failed to load stored retopo model:', err);
  }
}

function switchModel(modelType) {
  clearScene();
  state.currentModel = modelType;

  const meshesToLoad = modelType === 'retopo' ? state.retopoMeshes : state.meshes;

  if (!meshesToLoad || meshesToLoad.length === 0) {
    showError('Model not loaded');
    return;
  }

  state.meshes = meshesToLoad;

  if (state.meshes.length > 0) {
    fitCameraToMeshes(state.meshes);
    displayModelStats();
  }

  document.getElementById('canvas-overlay').classList.add('hidden');

  // Update button active states
  const originalBtn = document.getElementById('view-original-btn');
  const retpoBtn = document.getElementById('view-retopo-btn');

  if (modelType === 'original') {
    originalBtn.classList.remove('active');
    retpoBtn.classList.remove('active');
  } else {
    retpoBtn.classList.add('active');
  }
}

function setupRetopologyUI() {
  document.getElementById('retopologize-btn').addEventListener('click', startRetopology);
  document.getElementById('view-original-btn').addEventListener('click', () => switchModel('original'));
  document.getElementById('view-retopo-btn').addEventListener('click', () => switchModel('retopo'));
}

// ============================================================================
// Load Model from History
// ============================================================================

function checkAndLoadHistoryModel() {
  const loadData = localStorage.getItem('hunyuan3d_load_model');
  if (!loadData) return;

  try {
    const data = JSON.parse(loadData);
    localStorage.removeItem('hunyuan3d_load_model'); // Clear after loading

    setStatus('Loading model from history...', 10);

    // Load the GLB model
    async function loadHistoryModel() {
      try {
        const glbBlob = await fetch(data.glbUrl).then(r => r.blob());
        const BABYLON = window.BABYLON;
        BABYLON.FilesInput.FilesToLoad['model.glb'] = new File([glbBlob], 'model.glb', { type: 'model/gltf-binary' });

        const importResult = await BABYLON.SceneLoader.ImportMeshAsync(
          '',
          'file:',
          'model.glb',
          state.scene
        );

        state.meshes = importResult.meshes.filter(m => m.name !== '__root__');

        if (state.meshes.length > 0) {
          fitCameraToMeshes(state.meshes);
        }

        // Show title indicating loaded from history
        const subtitle = document.createElement('div');
        subtitle.style.cssText = 'position: absolute; top: 70px; left: 20px; background: #2a2a3e; padding: 8px 12px; border-radius: 4px; font-size: 12px; color: #4a9eff; z-index: 100;';
        subtitle.textContent = `📂 Loaded from history (${data.modelType})`;
        document.body.appendChild(subtitle);

        // Show retopology section if original
        if (data.modelType === 'original') {
          document.getElementById('retopology-section').style.display = 'block';
        }

        setStatus('Complete!', 100);
        clearStatus();
        document.getElementById('canvas-overlay').classList.add('hidden');

        // Display stats if available
        if (data.originalVertices) {
          state.currentModel = data.modelType || 'original';
          document.getElementById('model-type').textContent = data.modelType === 'retopo' ? 'Retopologized' : 'Original';
          document.getElementById('vertex-count').textContent = (data.modelType === 'retopo' ? data.retopVertices : data.originalVertices)?.toLocaleString() || '?';
          document.getElementById('face-count').textContent = (data.modelType === 'retopo' ? data.retopFaces : data.originalFaces)?.toLocaleString() || '?';
          document.getElementById('model-stats').style.display = 'block';
        }
      } catch (err) {
        console.error('History model loading error:', err);
        showError('Failed to load model: ' + err.message);
      }
    }

    loadHistoryModel();
  } catch (err) {
    console.error('Failed to parse history load data:', err);
  }
}

// ============================================================================
// Initialize
// ============================================================================

function init() {
  loadStateFromStorage();
  setupAPIKeyUI();
  setupImagePaste();
  setupGenerateButton();
  setupRetopologyUI();
  initBabylon();

  // Check if loading from history
  checkAndLoadHistoryModel();

  restoreInFlightRequest();

  // Restore image preview if present
  if (state.imageB64) {
    updateImagePreview(state.imageB64);
  }

  // Setup download button
  document.getElementById('download-btn').addEventListener('click', downloadGLB);
}

// Call init at page load (script is at end of body)
init();
