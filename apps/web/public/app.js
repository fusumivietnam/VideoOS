const readiness = document.querySelector('#readiness');
const milestone = document.querySelector('#milestone');
const milestoneName = document.querySelector('#milestone-name');
const updatedAt = document.querySelector('#updated-at');
const gates = document.querySelector('#gates');
const focus = document.querySelector('#focus');
const commands = document.querySelector('#commands');
const health = document.querySelector('#health');

await Promise.all([loadState(), loadHealth()]);

async function loadState() {
  try {
    const response = await fetch('/api/launch-state', { cache: 'no-store' });
    if (!response.ok) throw new Error(`launch state HTTP ${response.status}`);
    const state = await response.json();

    readiness.textContent = state.ready ? 'GO' : 'NOT READY';
    readiness.className = `status ${state.ready ? 'status-ready' : 'status-blocked'}`;
    milestone.textContent = state.milestone ?? '—';
    milestoneName.textContent = state.milestoneName ?? '—';
    updatedAt.textContent = state.updatedAt ?? '—';

    gates.replaceChildren(...state.gates.map(renderGate));
    focus.replaceChildren(...state.currentFocus.map((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      return li;
    }));
    commands.replaceChildren(...state.commands.map((command) => {
      const pre = document.createElement('div');
      pre.className = 'command';
      pre.textContent = command;
      return pre;
    }));
  } catch (error) {
    readiness.textContent = 'ERROR';
    readiness.className = 'status status-blocked';
    const message = document.createElement('p');
    message.className = 'error';
    message.textContent = error instanceof Error ? error.message : String(error);
    gates.replaceChildren(message);
  }
}

async function loadHealth() {
  try {
    const response = await fetch('/health', { cache: 'no-store' });
    const payload = await response.json();
    health.textContent = payload.status === 'ok' ? 'Service healthy' : 'Service degraded';
  } catch {
    health.textContent = 'Health unavailable';
  }
}

function renderGate(gate) {
  const row = document.createElement('div');
  row.className = `gate ${gate.ok ? 'gate-ok' : 'gate-no'}`;

  const mark = document.createElement('span');
  mark.className = 'gate-mark';
  mark.textContent = gate.ok ? '✓' : '!';

  const label = document.createElement('span');
  label.className = 'gate-label';
  label.textContent = gate.label;

  const detail = document.createElement('span');
  detail.className = 'gate-detail';
  detail.textContent = gate.detail;

  row.append(mark, label, detail);
  return row;
}
