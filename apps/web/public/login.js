const form = document.querySelector('#login-form');
const input = document.querySelector('#access-code');
const error = document.querySelector('#login-error');

const session = await fetch('/api/session', { cache: 'no-store' }).then((response) => response.json()).catch(() => null);
if (session?.authenticated) window.location.replace('/');
if (session && session.protected === false) window.location.replace('/');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';
  const accessCode = input.value;
  input.value = '';

  try {
    const response = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessCode }),
    });
    if (!response.ok) {
      error.textContent = response.status === 401 ? 'Invalid access code.' : 'Unable to sign in.';
      return;
    }
    window.location.replace('/');
  } catch {
    error.textContent = 'Unable to reach the control plane.';
  }
});
