const loginCard = document.querySelector('#login-card');
const loginForm = document.querySelector('#product-login');
const accessCodeInput = document.querySelector('#product-access-code');
const loginError = document.querySelector('#login-error');
const workspace = document.querySelector('#workspace');
const logoutButton = document.querySelector('#logout');
const projectsNode = document.querySelector('#projects');
const selectedProjectNode = document.querySelector('#selected-project');
const selectedRoleNode = document.querySelector('#selected-role');
const workflowStatusNode = document.querySelector('#workflow-status');
const assetsNode = document.querySelector('#assets');
const jobForm = document.querySelector('#job-form');
const jobIdInput = document.querySelector('#job-id');
const jobPollingNode = document.querySelector('#job-polling');
const refreshAssetsButton = document.querySelector('#refresh-assets');
const jobResult = document.querySelector('#job-result');
const publishPreflightForm = document.querySelector('#publish-preflight-form');
const publishAssetInput = document.querySelector('#publish-asset');
const publishAccountInput = document.querySelector('#publish-account');
const publishCaptionInput = document.querySelector('#publish-caption');
const publishScheduleInput = document.querySelector('#publish-schedule');
const publishPreflightButton = document.querySelector('#publish-preflight-button');
const publishDryRunButton = document.querySelector('#publish-dry-run-button');
const publishRuntimeMode = document.querySelector('#publish-runtime-mode');
const publishPreflightResult = document.querySelector('#publish-preflight-result');

const JOB_POLL_INTERVAL_MS = 1500;
const JOB_POLL_MAX_ATTEMPTS = 40;
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'dead-letter', 'cancelled']);
let selectedProject = null;
let currentAssets = [];
let activePollToken = 0;
let runtimeInfo = { publisherDriver: 'youtube', dryRunPublishEnabled: false };
let lastPreflightPayload = null;

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  try {
    const response = await api('/api/product/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessCode: accessCodeInput.value }),
    });
    if (!response.ok) throw new Error(response.status === 401 ? 'Invalid access code.' : 'Unable to sign in.');
    accessCodeInput.value = '';
    await loadProjects();
  } catch (error) {
    loginError.textContent = error instanceof Error ? error.message : String(error);
  }
});

logoutButton.addEventListener('click', async () => {
  stopPolling();
  await api('/api/product/session', { method: 'DELETE' }).catch(() => undefined);
  showLogin();
});

jobForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedProject) {
    jobResult.textContent = 'Select a project first.';
    return;
  }
  const jobId = jobIdInput.value.trim();
  if (!jobId) return;
  stopPolling();
  await loadJob(jobId);
});

refreshAssetsButton.addEventListener('click', async () => {
  if (!selectedProject) return;
  await loadAssets(selectedProject.projectId);
});

publishPreflightForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedProject) {
    publishPreflightResult.textContent = 'Select a project first.';
    return;
  }
  const asset = currentAssets.find((item) => item.id === publishAssetInput.value);
  if (!asset) {
    publishPreflightResult.textContent = 'Select a video asset.';
    return;
  }
  publishPreflightButton.disabled = true;
  publishDryRunButton.disabled = true;
  publishPreflightButton.textContent = 'Checking…';
  publishPreflightResult.textContent = 'Validating publish request…';
  try {
    const payload = buildPublishPayload(asset);
    const response = await api(`/api/product/projects/${encodeURIComponent(selectedProject.projectId)}/publish-preflight`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.status === 401) return showLogin();
    if (response.status === 403) throw new Error('Your role cannot create publish requests.');
    if (response.status === 404) throw new Error('The selected asset is no longer available in this project.');
    if (!response.ok) throw new Error(`Publish preflight failed (${response.status}).`);
    const result = await response.json();
    lastPreflightPayload = payload;
    publishDryRunButton.disabled = !runtimeInfo.dryRunPublishEnabled;
    publishPreflightResult.textContent = JSON.stringify({
      ...result,
      message: runtimeInfo.dryRunPublishEnabled
        ? 'Preflight passed. Fake-mode dry-run is available; no external provider side effect will occur.'
        : 'Preflight passed. Real publishing remains locked pending live YouTube verification.',
    }, null, 2);
  } catch (error) {
    lastPreflightPayload = null;
    publishPreflightResult.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    publishPreflightButton.disabled = false;
    publishPreflightButton.textContent = 'Run preflight';
  }
});

publishDryRunButton.addEventListener('click', async () => {
  if (!selectedProject || !lastPreflightPayload || !runtimeInfo.dryRunPublishEnabled) return;
  publishDryRunButton.disabled = true;
  publishDryRunButton.textContent = 'Running dry-run…';
  publishPreflightResult.textContent = 'Queueing approved fake publish and running one publisher worker iteration…';
  try {
    const payload = {
      ...lastPreflightPayload,
      idempotencyKey: `web-dry-run-${crypto.randomUUID()}`,
      confirmed: true,
    };
    const response = await api(`/api/product/projects/${encodeURIComponent(selectedProject.projectId)}/publish-dry-run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.status === 401) return showLogin();
    if (response.status === 403) throw new Error('Your role cannot approve this dry-run publish.');
    if (response.status === 423) throw new Error('Dry-run publish is locked because this runtime is not using the fake publisher.');
    if (!response.ok) throw new Error(`Publish dry-run failed (${response.status}).`);
    const result = await response.json();
    jobIdInput.value = result.jobId;
    publishPreflightResult.textContent = JSON.stringify({
      ...result,
      message: 'Fake publish completed without an external provider side effect.',
    }, null, 2);
    workflowStatusNode.textContent = 'Fake publish dry-run executed. Tracking terminal job state.';
    await pollJob(result.jobId);
  } catch (error) {
    publishPreflightResult.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    publishDryRunButton.disabled = !runtimeInfo.dryRunPublishEnabled || !lastPreflightPayload;
    publishDryRunButton.textContent = 'Run fake publish dry-run';
  }
});

await loadProjects();

async function loadProjects() {
  const response = await api('/api/product/me/projects');
  if (response.status === 401) return showLogin();
  if (!response.ok) {
    showLogin(`Unable to load projects (${response.status}).`);
    return;
  }

  const payload = await response.json();
  loginCard.hidden = true;
  workspace.hidden = false;
  logoutButton.hidden = false;
  projectsNode.replaceChildren();
  await loadRuntimeInfo();

  if (!payload.projects.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No project memberships found.';
    projectsNode.append(empty);
    return;
  }

  for (const project of payload.projects) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'project-row';
    button.dataset.projectId = project.projectId;
    button.innerHTML = `<span>${escapeHtml(project.projectId)}</span><strong>${escapeHtml(project.role)}</strong>`;
    button.addEventListener('click', () => selectProject(project, button));
    projectsNode.append(button);
  }

  const firstButton = projectsNode.querySelector('.project-row');
  if (firstButton) firstButton.click();
}

async function loadRuntimeInfo() {
  const response = await api('/api/product/runtime');
  if (response.status === 401) return showLogin();
  if (!response.ok) {
    runtimeInfo = { publisherDriver: 'youtube', dryRunPublishEnabled: false };
    publishRuntimeMode.textContent = 'Unable to read runtime publish mode. Dry-run remains locked.';
    publishDryRunButton.hidden = true;
    publishDryRunButton.disabled = true;
    return;
  }
  runtimeInfo = await response.json();
  if (runtimeInfo.dryRunPublishEnabled) {
    publishRuntimeMode.textContent = 'Runtime publisher: fake · safe dry-run enabled · no external provider side effect.';
    publishDryRunButton.hidden = false;
    publishDryRunButton.disabled = !lastPreflightPayload;
  } else {
    publishRuntimeMode.textContent = `Runtime publisher: ${runtimeInfo.publisherDriver} · real publish enqueue remains locked.`;
    publishDryRunButton.hidden = true;
    publishDryRunButton.disabled = true;
  }
}

async function selectProject(project, button) {
  stopPolling();
  selectedProject = project;
  currentAssets = [];
  lastPreflightPayload = null;
  publishDryRunButton.disabled = true;
  for (const row of projectsNode.querySelectorAll('.project-row')) row.classList.toggle('active', row === button);
  selectedProjectNode.textContent = project.projectId;
  selectedRoleNode.textContent = `Role: ${project.role}`;
  workflowStatusNode.textContent = ['owner', 'admin', 'editor'].includes(project.role)
    ? runtimeInfo.dryRunPublishEnabled
      ? 'Media processing and fake publish dry-run enabled. Real provider publishing remains gated.'
      : 'Media processing enabled. YouTube publish preflight available; real publishing remains gated.'
    : 'Read access only for this role.';
  jobResult.textContent = 'No job selected.';
  jobPollingNode.textContent = 'Manual lookup until a job is queued.';
  publishPreflightResult.textContent = 'No preflight run yet.';
  refreshAssetsButton.disabled = false;
  populatePublishAssets([]);
  await loadAssets(project.projectId);
}

async function loadAssets(projectId) {
  assetsNode.innerHTML = '<p class="muted">Loading assets…</p>';
  const response = await api(`/api/product/projects/${encodeURIComponent(projectId)}/assets`);
  if (response.status === 401) return showLogin();
  if (response.status === 403) {
    assetsNode.innerHTML = '<p class="error">Access denied.</p>';
    return;
  }
  if (!response.ok) {
    assetsNode.innerHTML = `<p class="error">Unable to load assets (${response.status}).</p>`;
    return;
  }
  const payload = await response.json();
  currentAssets = payload.assets;
  renderAssets(currentAssets);
  populatePublishAssets(currentAssets);
}

function populatePublishAssets(assets) {
  const videos = assets.filter((asset) => asset.contentType?.startsWith('video/'));
  publishAssetInput.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = videos.length ? 'Select video asset' : 'No video assets available';
  publishAssetInput.append(placeholder);
  for (const asset of videos) {
    const option = document.createElement('option');
    option.value = asset.id;
    option.textContent = `${asset.id} · ${asset.contentType}`;
    publishAssetInput.append(option);
  }
  publishAssetInput.disabled = videos.length === 0;
}

function renderAssets(assets) {
  if (!assets.length) {
    assetsNode.innerHTML = '<p class="muted">No assets in this project.</p>';
    return;
  }
  const canWrite = selectedProject && ['owner', 'admin', 'editor'].includes(selectedProject.role);
  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `<thead><tr><th>ID</th><th>Kind</th><th>Type</th><th>Bytes</th><th>Created</th>${canWrite ? '<th>Action</th>' : ''}</tr></thead>`;
  const body = document.createElement('tbody');
  for (const asset of assets) {
    const row = document.createElement('tr');
    for (const value of [asset.id, asset.kind, asset.contentType, formatBytes(asset.bytes), formatDate(asset.createdAt)]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    if (canWrite) {
      const actionCell = document.createElement('td');
      if (asset.contentType?.startsWith('video/')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'table-action';
        button.textContent = 'Create 720p proxy';
        button.addEventListener('click', () => create720pProxy(asset, button));
        actionCell.append(button);
      } else {
        actionCell.textContent = '—';
      }
      row.append(actionCell);
    }
    body.append(row);
  }
  table.append(body);
  assetsNode.replaceChildren(table);
}

async function create720pProxy(asset, button) {
  if (!selectedProject) return;
  const jobId = `media:web:${crypto.randomUUID()}`;
  button.disabled = true;
  button.textContent = 'Queueing…';
  try {
    const response = await api(`/api/product/projects/${encodeURIComponent(selectedProject.projectId)}/media-jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assetId: asset.id,
        jobId,
        transform: {
          operations: [{ type: 'resize', width: 1280, height: 720, fit: 'contain' }],
          output: {
            container: 'mp4',
            videoCodec: 'h264',
            audioCodec: 'aac',
            width: 1280,
            height: 720,
            fps: 30,
          },
        },
      }),
    });
    if (response.status === 401) return showLogin();
    if (response.status === 403) throw new Error('Your role cannot create media jobs.');
    if (!response.ok) throw new Error(`Unable to create media job (${response.status}).`);
    const payload = await response.json();
    jobIdInput.value = payload.jobId;
    button.textContent = 'Queued';
    workflowStatusNode.textContent = `Processing ${asset.id}`;
    await pollJob(payload.jobId);
  } catch (error) {
    jobResult.textContent = error instanceof Error ? error.message : String(error);
    workflowStatusNode.textContent = 'Unable to queue media processing.';
    button.disabled = false;
    button.textContent = 'Create 720p proxy';
  }
}

async function pollJob(jobId) {
  const token = ++activePollToken;
  for (let attempt = 1; attempt <= JOB_POLL_MAX_ATTEMPTS && token === activePollToken; attempt += 1) {
    const job = await loadJob(jobId);
    if (!job || token !== activePollToken) return;
    if (TERMINAL_JOB_STATUSES.has(job.status)) {
      jobPollingNode.textContent = `Finished with status: ${job.status}`;
      const completed = job.status === 'completed';
      workflowStatusNode.textContent = completed
        ? 'Job completed. Project state refreshed.'
        : `Job ${job.status}.`;
      if (completed && selectedProject) await loadAssets(selectedProject.projectId);
      return;
    }
    jobPollingNode.textContent = `Tracking job · ${job.status} · check ${attempt}/${JOB_POLL_MAX_ATTEMPTS}`;
    await delay(JOB_POLL_INTERVAL_MS);
  }
  if (token === activePollToken) jobPollingNode.textContent = 'Automatic tracking stopped. Use Check job to refresh manually.';
}

async function loadJob(jobId) {
  if (!selectedProject) return null;
  jobResult.textContent = 'Loading…';
  const response = await api(`/api/product/projects/${encodeURIComponent(selectedProject.projectId)}/jobs/${encodeURIComponent(jobId)}`);
  if (response.status === 401) {
    showLogin();
    return null;
  }
  if (response.status === 403) {
    jobResult.textContent = 'You do not have access to this project.';
    return null;
  }
  if (!response.ok) {
    jobResult.textContent = `Unable to load job (${response.status}).`;
    return null;
  }
  const payload = await response.json();
  jobResult.textContent = payload.job ? JSON.stringify(payload.job, null, 2) : 'Job not found in this project.';
  return payload.job ?? null;
}

function buildPublishPayload(asset) {
  const payload = {
    assetId: asset.id,
    accountId: publishAccountInput.value.trim(),
    idempotencyKey: `web-${crypto.randomUUID()}`,
    mimeType: asset.contentType,
    caption: publishCaptionInput.value,
  };
  if (publishScheduleInput.value) payload.scheduledAt = new Date(publishScheduleInput.value).toISOString();
  return payload;
}

function stopPolling() {
  activePollToken += 1;
}

function showLogin(message = '') {
  stopPolling();
  selectedProject = null;
  currentAssets = [];
  lastPreflightPayload = null;
  runtimeInfo = { publisherDriver: 'youtube', dryRunPublishEnabled: false };
  loginCard.hidden = false;
  workspace.hidden = true;
  logoutButton.hidden = true;
  publishDryRunButton.hidden = true;
  publishDryRunButton.disabled = true;
  loginError.textContent = message;
}

async function api(path, options = {}) {
  return fetch(path, { ...options, cache: 'no-store', credentials: 'same-origin' });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}
