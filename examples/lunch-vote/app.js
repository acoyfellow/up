import { up } from '/_up/client.js';

const viewer = document.querySelector('#viewer');
const activity = document.querySelector('#activity');
const liveStatus = document.querySelector('#live-status');
const summary = document.querySelector('#summary');
const menuLink = document.querySelector('#menu-link');
const votes = up.db.collection('votes');
const room = up.realtime.channel('votes');
let currentUser;

function note(text) {
  const item = document.createElement('li');
  item.textContent = text;
  activity.prepend(item);
  while (activity.children.length > 6) activity.lastElementChild?.remove();
}

async function refresh() {
  const { documents } = await votes.list();
  const counts = new Map();
  for (const vote of documents) counts.set(vote.choice, (counts.get(vote.choice) || 0) + 1);
  for (const button of document.querySelectorAll('[data-choice]')) {
    button.querySelector('span').textContent = String(counts.get(button.dataset.choice) || 0);
  }
  return documents;
}

async function vote(choice) {
  const created = await votes.create({
    choice,
    voter: currentUser.email,
    votedAt: new Date().toISOString(),
  });
  note(`${currentUser.email} voted for ${choice}`);
  room.send('vote', created);
  await refresh();
}

room.on('open', () => {
  liveStatus.textContent = 'Connected · updates appear in every open browser';
});
room.on('vote', async (message) => {
  if (message.sender !== currentUser?.email)
    note(`${message.sender} voted for ${message.data.choice}`);
  await refresh();
});
room.on('presence', (message) => {
  if (message.event === 'join') note(`${message.email} joined`);
});
room.connect();

for (const button of document.querySelectorAll('[data-choice]')) {
  button.addEventListener('click', () => vote(button.dataset.choice));
}

document.querySelector('#menu').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const stored = await up.files.put(`menus/${file.name}`, file);
  menuLink.href = stored.url;
  menuLink.textContent = `Open ${file.name} ↗`;
  menuLink.hidden = false;
  note(`${currentUser.email} shared ${file.name}`);
  room.send('file', { name: file.name });
});

document.querySelector('#summarize').addEventListener('click', async () => {
  const documents = await refresh();
  summary.textContent = 'Asking Workers AI…';
  const result = await up.ai.chat([
    {
      role: 'user',
      content: `Summarize this lunch vote in one short sentence: ${JSON.stringify(documents)}`,
    },
  ]);
  summary.textContent = result.response || result.result?.response || JSON.stringify(result);
});

currentUser = await up.identity.current();
viewer.textContent = `Signed in as ${currentUser.email}`;
await refresh();
