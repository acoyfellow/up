const views = document.querySelector('#views');
const room = document.querySelector('#room');
const notesCount = document.querySelector('#notes-count');
const notes = document.querySelector('#notes');
const form = document.querySelector('#note-form');
const input = document.querySelector('#note');

async function load() {
  const response = await fetch('/api/state');
  const state = await response.json();
  views.textContent = state.pageViews;
  room.textContent = state.roomVisits;
  notesCount.textContent = state.notes.length;
  notes.replaceChildren(
    ...(state.notes.length
      ? state.notes.map((note) => {
          const item = document.createElement('li');
          item.textContent = note.body;
          return item;
        })
      : [Object.assign(document.createElement('li'), { textContent: 'No notes yet.' })]),
  );
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: input.value }),
  });
  if (!response.ok) return;
  input.value = '';
  await load();
});

load().catch(() => {
  notes.replaceChildren(
    Object.assign(document.createElement('li'), { textContent: 'Bindings are unavailable.' }),
  );
});
