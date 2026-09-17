const loginCard = document.querySelector('#login-card');
const loginForm = document.querySelector('#product-login');
const accessCodeInput = document.querySelector('#product-access-code');
const loginError = document.querySelector('#login-error');
const workspace = document.querySelector('#workspace');
const logoutButton = document.querySelector('#logout');
const projectsNode = document.querySelector('#projects');
const selectedProjectNode = document.querySelector('#selected-project');
const selectedRoleNode = document.querySelector('#selected-role');
const assetsNode = document.querySelector('#assets');
const jobForm = document.querySelector('#job-form');
const jobIdInput = document.querySelector('#job-id');
const jobResult = document.querySelector('#job-result');

let selectedProject = null;

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
  jobResult.textContent = 'Loading…';
  const response = await api(`/api/product/projects/${encodeURIComponent(selectedProject.projectId)}/jobs/${encodeURIComponent(jobId)}`);
  if (response.status === 401) return showLogin();
  if (response.status === 403) {
    jobResult.textContent = 'You do not have access to this project.';
    return;
  }
  if (!response.ok) {
    jobResult.textContent = `Unable to load job (${response.status}).`;
    return;
  }
  const payload = await response.json();
  jobResult.textContent = payload.job ? JSON.stringify(payload.job, null, 2) : 'Job not found in this project.';
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

async function selectProject(project, button) {
  selectedProject = project;
  for (const row of projectsNode.querySelectorAll('.project-row')) row.classList.toggle('active', row === button);
  selectedProjectNode.textContent = project.projectId;
  selectedRoleNode.textContent = `Role: ${project.role}`;
  assetsNode.innerHTML = '<p class="muted">Loading assets…</p>';
  jobResult.textContent = 'No job selected.';

  const response = await api(`/api/product/projects/${encodeURIComponent(project.projectId)}/assets`);
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
  renderAssets(payload.assets);
}

function renderAssets(assets) {
  if (!assets.length) {
    assetsNode.innerHTML = '<p class="muted">No assets in this project.</p>';
    return;
  }
  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = '<thead><tr><th>ID</th><th>Kind</th><th>Type</th><th>Bytes</th><th>Created</th></tr></thead>';
  const body = document.createElement('tbody');
  for (const asset of assets) {
    const row = document.createElement('tr');
    for (const value of [asset.id, asset.kind, asset.contentType, formatBytes(asset.bytes), formatDate(asset.createdAt)]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
  table.append(body);
  assetsNode.replaceChildren(table);
}

function showLogin(message = '') {
  selectedProject = null;
  loginCard.hidden = false;
  workspace.hidden = true;
  logoutButton.hidden = true;
  loginError.textContent = message;
}

async function api(path, options = {}) {
  return fetch(path, { ...options, cache: 'no-store', credentials: 'same-origin' });
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
