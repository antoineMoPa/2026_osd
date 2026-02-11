// ============================================================================
// Constants
// ============================================================================

const LS_API_KEY = 'fal_key';

const FAL_BASE = 'https://queue.fal.run';
const FAL_MODEL = 'fal-ai/hunyuan3d-v3/image-to-3d';
const FAL_MODEL_BASE = 'fal-ai/hunyuan3d'; // For status/result requests
const FAL_REMESH = 'fal-ai/meshy/v5/remesh';
const FAL_REMESH_BASE = 'fal-ai/meshy'; // For status/result requests (no v5)
const REMESH_TARGET_POLYCOUNT = 3000;
const POLL_MS = 3000;
const MAX_POLLS = 200; // 10 min timeout

// ============================================================================
// Current Generation Helpers
// ============================================================================

function getCurrentGeneration() {
  try {
    return JSON.parse(localStorage.getItem('current_generation') || '{}');
  } catch {
    return {};
  }
}

function saveCurrentGeneration(gen) {
  localStorage.setItem('current_generation', JSON.stringify(gen));
}

function updateCurrentGeneration(updates) {
  const gen = getCurrentGeneration();
  Object.assign(gen, updates);
  saveCurrentGeneration(gen);
}

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
  state.apiKey = localStorage.getItem(LS_API_KEY) || '';
  const gen = getCurrentGeneration();
  state.imageB64 = gen.image_b64 || '';
  state.requestId = gen.request_id || '';
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

function calculateModelStats(meshes = null) {
  const meshesToUse = meshes || state.meshes;
  let totalVertices = 0;
  let totalFaces = 0;

  meshesToUse.forEach(mesh => {
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

// ============================================================================
// History Helpers
// ============================================================================

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem('history') || '[]');
  } catch {
    return [];
  }
}

function saveHistory(history) {
  localStorage.setItem('history', JSON.stringify(history));
}

function saveGenerationHistory(modelType, stats) {
  const generationId = Date.now();
  state.generationId = generationId;
  const gen = getCurrentGeneration();

  const entry = {
    id: generationId,
    timestamp: new Date().toISOString(),
    ai_model: 'hunyuan3d',
    original_image_data: state.imageB64,
    model: {
      glb_url: gen.glb_url,
      vertices: stats.vertices,
      faces: stats.faces
    },
    retopo: null
  };

  try {
    const history = getHistory();
    history.push(entry);
    saveHistory(history);
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
  const history = getHistory();
  const entry = history.find(e => e.id === generationId);
  if (entry) {
    Object.assign(entry, updates);
    saveHistory(history);
  }
}

function downloadGLB() {
  const gen = getCurrentGeneration();
  const glbUrl = gen.glb_url;
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

function downloadRetopoModel() {
  const gen = getCurrentGeneration();
  const glbUrl = gen.retopo_glb_url;
  if (!glbUrl) {
    showError('No remeshed model available');
    return;
  }

  fetch(glbUrl)
    .then(r => r.blob())
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'model-remeshed.glb';
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
    saveToLocalStorage(LS_API_KEY, input.value);
    closeSettings();
  });

  // Real-time update
  input.addEventListener('input', () => {
    state.apiKey = input.value;
  });
}

function setupInputZone() {
  const zone = document.getElementById('input-zone');
  const fileInput = document.getElementById('file-input');

  // Click to open file picker
  zone.addEventListener('click', () => fileInput.click());

  // Drag and drop
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.style.borderColor = '#4a9eff';
    zone.style.background = '#15151f';
  });

  zone.addEventListener('dragleave', () => {
    zone.style.borderColor = '#3a3a4e';
    zone.style.background = '#0f0f1a';
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.style.borderColor = '#3a3a4e';
    zone.style.background = '#0f0f1a';

    const files = e.dataTransfer?.files || [];
    if (files.length > 0) {
      handleInputFile(files[0]);
    }
  });

  // File input change
  fileInput.addEventListener('change', (e) => {
    if (e.target.files?.length > 0) {
      handleInputFile(e.target.files[0]);
    }
  });

  // Paste handler
  window.addEventListener('paste', handlePaste);
}

function handleGLBFile(file) {
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const arrayBuffer = evt.target.result;
      const blob = new Blob([arrayBuffer], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);

      // Store in current generation for retopology
      const gen = getCurrentGeneration();
      gen.glb_url = url;
      gen.glb_source = 'uploaded'; // Mark as uploaded (not from FAL)
      gen.image_b64 = ''; // Clear image since we're not generating
      saveCurrentGeneration(gen);

      // Show in UI
      clearScene();
      loadUploadedGLB(url, file.name);

      // Update UI to show GLB is loaded
      const text = document.getElementById('input-zone-text');
      const glbText = document.getElementById('glb-loaded-text');
      const preview = document.getElementById('image-preview');

      text.style.display = 'none';
      preview.style.display = 'none';
      glbText.style.display = 'block';
      document.getElementById('glb-filename').textContent = file.name;

      // Show retopology section since we have a model
      document.getElementById('retopology-section').style.display = 'block';

      clearError();
    } catch (err) {
      showError('Failed to load GLB file: ' + err.message);
    }
  };

  reader.onerror = () => {
    showError('Failed to read GLB file');
  };

  reader.readAsArrayBuffer(file);
}

async function loadUploadedGLB(blobUrl, filename) {
  try {
    setStatus('Loading uploaded model...', 10);

    const blob = await fetch(blobUrl).then(r => r.blob());
    const BABYLON = window.BABYLON;
    BABYLON.FilesInput.FilesToLoad['uploaded.glb'] = new File([blob], filename, { type: 'model/gltf-binary' });

    setStatus('Rendering model...', 50);
    const importResult = await BABYLON.SceneLoader.ImportMeshAsync(
      '',
      'file:',
      'uploaded.glb',
      state.scene
    );

    state.meshes = importResult.meshes.filter(m => m.name !== '__root__');

    if (state.meshes.length > 0) {
      fitCameraToMeshes(state.meshes);
      displayModelStats();
    }

    setStatus('Complete!', 100);
    clearStatus();
    document.getElementById('canvas-overlay').classList.add('hidden');
  } catch (err) {
    console.error('GLB loading error:', err);
    showError('Failed to load model: ' + err.message);
  }
}

function handleInputFile(file) {
  const isGLB = file.name.toLowerCase().endsWith('.glb');
  const isImage = file.type.startsWith('image/');

  if (isGLB) {
    handleGLBFile(file);
  } else if (isImage) {
    handleImageFile(file);
  } else {
    showError('Please select an image or GLB file');
  }
}

function handleImageFile(file) {
  const reader = new FileReader();
  reader.onload = (evt) => {
    const dataUrl = evt.target.result;
    state.imageB64 = dataUrl;
    updateCurrentGeneration({ image_b64: dataUrl });
    updateImagePreview(dataUrl);
    document.getElementById('generate-btn').disabled = false;
    clearError();
  };
  reader.readAsDataURL(file);
}

function handlePaste(e) {
  const items = e.clipboardData?.items || [];
  for (let item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      handleImageFile(file);
      break;
    }
  }
}

function updateImagePreview(dataUrl) {
  const preview = document.getElementById('image-preview');
  const text = document.getElementById('input-zone-text');
  const glbText = document.getElementById('glb-loaded-text');

  preview.src = dataUrl;
  preview.style.display = 'block';
  text.style.display = 'none';
  glbText.style.display = 'none';
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
  updateCurrentGeneration({
    glb_url: null,
    retopo_glb_url: null,
    request_id: '',
    last_status: '',
    last_result: null,
    retopo_request_id: '',
    retopo_status: '',
    retopo_result: null,
    glb_source: null // Clear the glb_source flag
  });
  state.retopoMeshes = [];
  state.currentModel = 'original';
  document.getElementById('model-selector').style.display = 'none';
  document.getElementById('retopology-section').style.display = 'none';
  document.getElementById('download-retopo-btn').style.display = 'none';
  // Reset input zone display
  document.getElementById('input-zone-text').style.display = 'block';
  document.getElementById('image-preview').style.display = 'none';
  document.getElementById('glb-loaded-text').style.display = 'none';

  const url = `${FAL_BASE}/${FAL_MODEL}`;
  const body = {
    input_image_url: state.imageB64,
    enable_pbr: true
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
        updateCurrentGeneration({
          request_id: data.request_id,
          last_status: 'pending'
        });
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
        updateCurrentGeneration({ last_status: 'completed' });
        setStatus('Processing result...', 85);
        fetchResult();
      } else if (status === 'FAILED') {
        const reason = data.error || 'Unknown error';
        showError('Generation failed: ' + reason);
        updateCurrentGeneration({ last_status: 'failed' });
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
        updateCurrentGeneration({
          last_result: data,
          glb_url: data.model_glb.url
        });
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
  updateCurrentGeneration({ request_id: '' });
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
    // Check if there's a stored retopo model - if so, skip loading original (saves 30MB)
    const gen = getCurrentGeneration();
    const retopoResult = gen.retopo_result;
    const hasRetopo = retopoResult && retopoResult.model_glb?.url;

    if (hasRetopo) {
      // Load only retopo, skip original
      try {
        setStatus('Loading retopologized model...', 95);
        const retopoData = JSON.parse(retopoResult);
        if (retopoData.model_glb?.url) {
          await loadStoredRetopoModel(retopoData);
        }
      } catch (e) {
        console.error('Failed to load stored retopo model:', e);
      }
    } else {
      // Load original model
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

      if (state.meshes.length > 0) {
        fitCameraToMeshes(state.meshes);
        displayModelStats();
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

  // Normalize model size: scale to target diagonal of 10 units for consistent camera distance
  const targetDiag = 10;
  if (diag > 0 && diag !== targetDiag) {
    const scale = targetDiag / diag;
    meshes.forEach(mesh => {
      mesh.scaling = new window.BABYLON.Vector3(scale, scale, scale);
    });
    // Recalculate center after scaling
    minX *= scale;
    minY *= scale;
    minZ *= scale;
    maxX *= scale;
    maxY *= scale;
    maxZ *= scale;
    center.scaleInPlace(scale);
  }

  const radius = (targetDiag / 2) * 0.6; // Consistent distance: half diagonal * 0.6

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
  const gen = getCurrentGeneration();
  const lastStatus = gen.last_status;
  const lastResult = gen.last_result;

  if (lastStatus === 'completed' && lastResult) {
    setStatus('Restoring previous result...', 5);
    // Load the model - loadGLBModel handles retopo loading automatically
    loadGLBModel(lastResult);
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

  const gen = getCurrentGeneration();
  const glbUrl = gen.glb_url;
  if (!glbUrl) {
    showError('No model to remesh');
    return;
  }

  setStatus('Submitting remesh...', 5);

  const topology = document.getElementById('polygon-type').value === 'quadrilateral' ? 'quad' : 'triangle';

  const url = `${FAL_BASE}/${FAL_REMESH}`;
  const body = {
    model_url: glbUrl,
    target_formats: ['glb'],
    topology: topology,
    target_polycount: REMESH_TARGET_POLYCOUNT
  };

  console.log('Remesh request URL:', url);
  console.log('Remesh request body:', body);
  console.log('GLB URL being sent:', glbUrl);

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
      console.log('Retopo response:', data);
      if (data.request_id) {
        state.retopoRequestId = data.request_id;
        updateCurrentGeneration({
          retopo_request_id: data.request_id,
          retopo_status: 'pending'
        });
        state.repoPollCount = 0;
        pollRetopoStatus();
      } else {
        console.error('Remesh error detail:', data.detail || data);
        showError(data.detail || 'Failed to start remesh');
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
    showError('Remesh timeout (6 min exceeded)');
    state.retopoRequestId = '';
    updateCurrentGeneration({ retopo_request_id: '' });
    return;
  }

  const url = `${FAL_BASE}/${FAL_REMESH_BASE}/requests/${state.retopoRequestId}/status`;

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
        setStatus(`Remeshing... (${status})`, pct);
        scheduleRetopoPoll();
      } else if (status === 'COMPLETED') {
        updateCurrentGeneration({ retopo_status: 'completed' });
        setStatus('Loading remeshed model...', 85);
        fetchRetopoResult();
      } else if (status === 'FAILED') {
        const reason = data.error || 'Unknown error';
        showError('Remesh failed: ' + reason);
        updateCurrentGeneration({
          retopo_status: 'failed',
          retopo_request_id: ''
        });
        state.retopoRequestId = '';
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
    showError('No active remesh request');
    return;
  }

  const url = `${FAL_BASE}/${FAL_REMESH_BASE}/requests/${state.retopoRequestId}`;

  fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Key ${state.apiKey}`
    }
  })
    .then(r => r.json())
    .then(data => {
      if (data.model_glb?.url) {
        updateCurrentGeneration({
          retopo_result: data,
          retopo_glb_url: data.model_glb.url,
          retopo_request_id: ''
        });
        loadRetopoModel(data);
        state.retopoRequestId = '';
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
    const retopoStats = calculateModelStats(retopoMeshes);
    const gen = getCurrentGeneration();

    // Ensure we have a generation ID - find or create
    let generationId = state.generationId;
    if (!generationId && gen.id) {
      // If we have an ID in the current generation, use that
      generationId = gen.id;
      state.generationId = generationId;
    } else if (!generationId) {
      // If still no ID, find the most recent model in history
      const history = getHistory();
      const recentEntry = history
        .filter(e => e.ai_model === 'hunyuan3d')
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
      if (recentEntry) {
        generationId = recentEntry.id;
        state.generationId = generationId;
      }
    }

    if (generationId) {
      updateGenerationHistory(generationId, {
        retopo: {
          glb_url: gen.retopo_glb_url || glbUrl,
          vertices: retopoStats.vertices,
          faces: retopoStats.faces
        }
      });
      console.log('Saved retopo to history:', { generationId, glbUrl: gen.retopo_glb_url || glbUrl });
    } else {
      console.warn('No generation ID found - retopo not saved to history');
    }

    setStatus('Complete!', 100);
    clearStatus();

    // Show model selector and download button
    document.getElementById('model-selector').style.display = 'block';
    document.getElementById('download-retopo-btn').style.display = 'block';

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
    if (!glbUrl) {
      console.warn('No GLB URL in retopo result');
      return;
    }

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

    // Switch to retopo view (hide original, show retopo)
    state.currentModel = 'original';
    switchModel('retopo');
  } catch (err) {
    console.error('Failed to load stored retopo model:', err);
  }
}

async function switchModel(modelType) {
  state.currentModel = modelType;

  let meshesToDisplay = modelType === 'retopo' ? state.retopoMeshes : state.meshes;
  let meshesToHide = modelType === 'retopo' ? state.meshes : state.retopoMeshes;

  // If switching to original and it's not loaded, load it on demand
  if (modelType === 'original' && (!meshesToDisplay || meshesToDisplay.length === 0)) {
    const gen = getCurrentGeneration();
    const glbUrl = gen.glb_url;
    if (!glbUrl) {
      showError('Original model not available');
      return;
    }

    try {
      setStatus('Loading original model...', 50);
      const glbBlob = await fetch(glbUrl).then(r => r.blob());
      const BABYLON = window.BABYLON;
      BABYLON.FilesInput.FilesToLoad['model.glb'] = new File([glbBlob], 'model.glb', { type: 'model/gltf-binary' });

      const importResult = await BABYLON.SceneLoader.ImportMeshAsync(
        '',
        'file:',
        'model.glb',
        state.scene
      );

      state.meshes = importResult.meshes.filter(m => m.name !== '__root__');
      // Hide retopo meshes when showing original
      if (state.retopoMeshes) {
        state.retopoMeshes.forEach(mesh => {
          if (mesh) mesh.isVisible = false;
        });
      }
      clearStatus();
    } catch (err) {
      showError('Failed to load original model: ' + err.message);
      return;
    }
  }

  // Re-evaluate meshes in case they were loaded on demand
  meshesToDisplay = modelType === 'retopo' ? state.retopoMeshes : state.meshes;
  meshesToHide = modelType === 'retopo' ? state.meshes : state.retopoMeshes;

  if (!meshesToDisplay || meshesToDisplay.length === 0) {
    showError('Model not loaded');
    return;
  }

  // Hide meshes we're switching away from
  meshesToHide.forEach(mesh => {
    if (mesh) mesh.isVisible = false;
  });

  // Show meshes we're switching to
  meshesToDisplay.forEach(mesh => {
    if (mesh) mesh.isVisible = true;
  });

  if (meshesToDisplay.length > 0) {
    fitCameraToMeshes(meshesToDisplay);
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
  document.getElementById('download-retopo-btn').addEventListener('click', downloadRetopoModel);
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

    // Reset input zone display when loading from history
    document.getElementById('input-zone-text').style.display = 'block';
    document.getElementById('image-preview').style.display = 'none';
    document.getElementById('glb-loaded-text').style.display = 'none';

    setStatus('Loading model from history...', 10);

    // Load the GLB model - only load retopo for performance
    async function loadHistoryModel() {
      try {
        // Load retopo if available, otherwise original
        const glbUrl = data.retopo?.glb_url || data.model?.glb_url;
        if (!glbUrl) {
          console.warn('No model available in history');
          return;
        }

        const BABYLON = window.BABYLON;
        const fileName = data.retopo?.glb_url ? 'model_retopo.glb' : 'model.glb';

        // Load model
        const modelBlob = await fetch(glbUrl).then(r => r.blob());
        BABYLON.FilesInput.FilesToLoad[fileName] = new File([modelBlob], fileName, { type: 'model/gltf-binary' });

        const result = await BABYLON.SceneLoader.ImportMeshAsync(
          '',
          'file:',
          fileName,
          state.scene
        );

        const meshes = result.meshes.filter(m => m.name !== '__root__');

        if (meshes.length > 0) {
          // Store model URLs in current_generation for retopology access
          updateCurrentGeneration({
            glb_url: data.model?.glb_url,
            retopo_glb_url: data.retopo?.glb_url
          });

          if (data.retopo?.glb_url) {
            state.retopoMeshes = meshes;
            state.currentModel = 'original';
            switchModel('retopo');

            // Display retopo stats
            document.getElementById('model-type').textContent = 'Retopologized';
            document.getElementById('vertex-count').textContent = data.retopo.vertices?.toLocaleString() || '?';
            document.getElementById('face-count').textContent = data.retopo.faces?.toLocaleString() || '?';

            // Show model selector and download button for retopo
            document.getElementById('model-selector').style.display = 'block';
            document.getElementById('download-retopo-btn').style.display = 'block';
            document.getElementById('retopology-section').style.display = 'none';
          } else {
            state.meshes = meshes;
            fitCameraToMeshes(meshes);

            // Display original stats
            document.getElementById('model-type').textContent = 'Original';
            document.getElementById('vertex-count').textContent = data.model.vertices?.toLocaleString() || '?';
            document.getElementById('face-count').textContent = data.model.faces?.toLocaleString() || '?';

            // Show retopology section for models without retopo
            document.getElementById('retopology-section').style.display = 'block';
          }

          document.getElementById('model-stats').style.display = 'block';

          setStatus('Complete!', 100);
          clearStatus();
          document.getElementById('canvas-overlay').classList.add('hidden');
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
  setupInputZone();
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
