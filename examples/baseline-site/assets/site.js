const javascript = document.querySelector('#js-check');
const identity = document.querySelector('#identity-check');
const clock = document.querySelector('#clock');

javascript.textContent = 'loaded';
javascript.className = 'pass';
clock.textContent = 'assets verified';

try {
  const response = await fetch('/__up/me', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const viewer = await response.json();
  identity.textContent = viewer.email || 'authenticated';
  identity.className = 'pass';
} catch (error) {
  identity.textContent = `unavailable (${error instanceof Error ? error.message : 'unknown'})`;
  identity.className = 'fail';
}
