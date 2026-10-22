import { DEFAULT_SECONDS, ENTRY_SECONDS, MAX_ENTRIES, MAX_PLAYLISTS, describeEntry, unusedPlaylistId } from './playlist.js';

// Builds the playlist manager. `api` supplies:
//   get()            current playlist settings
//   commit(next)     validate, store and apply edited settings
//   currentLook()    an entry describing what is on screen now
//   show(entry)      put an entry on screen
//   play(index), stop(), skip(), player   playback
//   patternName(id), showError(message)
// Returns { refresh, status } for the app to call after outside changes and
// while playing.
export function bindPlaylistControls(container, api) {
  const element = (tag, properties = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), properties);
    node.append(...children);
    return node;
  };
  const button = (label, onClick, properties = {}) => {
    const node = element('button', { type: 'button', textContent: label, ...properties });
    node.addEventListener('click', () => run(onClick));
    return node;
  };
  const run = (action) => {
    try {
      action();
      api.showError('');
    } catch (error) {
      api.showError(error.message);
    }
  };
  const active = () => {
    const settings = api.get();
    return settings.lists.find(list => list.id === settings.activeId) ?? null;
  };
  // Replaces the active playlist's entries.
  const setEntries = (entries) => {
    const settings = api.get();
    api.commit({
      ...settings,
      lists: settings.lists.map(list => list.id === settings.activeId ? { ...list, entries } : list),
    });
    render();
  };
  const newId = () => unusedPlaylistId(api.get().lists);

  const statusLine = element('output', { id: 'playlist-status', className: 'hint' });
  let playButton;

  const status = () => {
    const list = active(), player = api.player;
    if (playButton) {
      playButton.textContent = player.playing ? 'Stop' : 'Play';
      playButton.classList.toggle('live', player.playing);
      playButton.disabled = !player.playing && !list?.entries.length;
    }
    statusLine.textContent = !player.playing ? (list ? `${list.entries.length} entries` : 'No playlist yet') :
      `Playing ${player.index + 1} of ${player.entries.length} · ${Math.ceil(player.remainingSeconds(api.now()))} s left`;
    for (const details of container.querySelectorAll('details[data-entry]'))
      details.classList.toggle('current', player.playing && Number(details.dataset.entry) === player.index);
  };

  const entryEditor = (entry, index, entries) => {
    const summary = element('summary');
    const label = () => {
      summary.textContent = `${index + 1}. ${entry.name ? `${entry.name}: ` : ''}` +
        `${describeEntry(entry, api.patternName)} · ${entry.seconds} s`;
    };
    label();
    const change = (next) => {
      const updated = [...entries];
      updated[index] = { ...entry, ...next };
      setEntries(updated);
    };
    const name = element('input', { type: 'text', value: entry.name, maxLength: 80, placeholder: 'Optional name' });
    name.addEventListener('change', () => run(() => change({ name: name.value })));
    const seconds = element('input', {
      type: 'number', value: entry.seconds, min: ENTRY_SECONDS[0], max: ENTRY_SECONDS[1], step: 1, required: true,
    });
    seconds.addEventListener('change', () => run(() => {
      if (!seconds.checkValidity()) throw new Error('Entry time must be a whole number of seconds from 1 to 3600.');
      change({ seconds: Number(seconds.value) });
    }));
    const move = (to) => {
      const updated = [...entries];
      updated.splice(to, 0, ...updated.splice(index, 1));
      setEntries(updated);
    };
    return element('details', { open: false },
      summary,
      element('label', {}, 'Name', name),
      element('label', {}, 'Show for (seconds)', seconds),
      element('div', { className: 'row' },
        button('Show now', () => (api.player.playing ? api.play(index) : api.show(entry))),
        button('Replace with current look', () => change({ ...api.currentLook(), name: entry.name, seconds: entry.seconds }))),
      element('div', { className: 'row' },
        button('Move up', () => move(index - 1), { disabled: index === 0 }),
        button('Move down', () => move(index + 1), { disabled: index === entries.length - 1 }),
        button('Remove', () => setEntries(entries.filter((_, i) => i !== index)))));
  };

  const render = () => {
    const settings = api.get(), list = active();
    container.replaceChildren();

    const picker = element('select', { id: 'playlist-select' });
    for (const each of settings.lists)
      picker.append(element('option', { value: each.id, textContent: each.name }));
    picker.value = settings.activeId ?? '';
    picker.disabled = settings.lists.length === 0;
    picker.addEventListener('change', () => run(() => {
      api.stop();
      api.commit({ ...api.get(), activeId: picker.value });
      render();
    }));
    container.append(element('label', {}, 'Playlist', picker));
    container.append(element('div', { className: 'row' },
      button('New', () => {
        const name = prompt('Name for the new playlist', `Playlist ${settings.lists.length + 1}`);
        if (name === null) return;
        const id = newId();
        api.stop();
        api.commit({ ...settings, lists: [...settings.lists, { id, name, entries: [] }], activeId: id });
        render();
      }, { disabled: settings.lists.length >= MAX_PLAYLISTS }),
      button('Rename', () => {
        const name = prompt('New name', list.name);
        if (name === null) return;
        api.commit({ ...settings, lists: settings.lists.map(each => each === list ? { ...list, name } : each) });
        render();
      }, { disabled: !list }),
      button('Delete', () => {
        if (!confirm(`Delete the playlist "${list.name}" and its ${list.entries.length} entries?`)) return;
        api.stop();
        api.commit({ ...settings, lists: settings.lists.filter(each => each !== list), activeId: null });
        render();
      }, { disabled: !list })));

    playButton = button('Play', () => {
      if (api.player.playing) api.stop();
      else api.play(0);
      status();
    }, { id: 'playlist-play', className: 'primary' });
    container.append(element('div', { className: 'row' },
      playButton,
      button('Next', () => { api.skip(); status(); }, { id: 'playlist-next' })));
    for (const [key, text] of [['loop', 'Repeat the playlist'], ['shuffle', 'Shuffle the order']]) {
      const box = element('input', { type: 'checkbox', checked: settings[key], id: `playlist-${key}` });
      box.addEventListener('change', () => run(() => api.commit({ ...api.get(), [key]: box.checked })));
      container.append(element('label', { className: 'check' }, box, text));
    }
    container.append(statusLine);

    container.append(button('Add current look', () => {
      setEntries([...list.entries, { ...api.currentLook(), seconds: DEFAULT_SECONDS }]);
      container.querySelector('details[data-entry]:last-of-type')?.setAttribute('open', '');
    }, { id: 'playlist-add', disabled: !list || list.entries.length >= MAX_ENTRIES }));

    list?.entries.forEach((entry, index, entries) => {
      const editor = entryEditor(entry, index, entries);
      editor.dataset.entry = index;
      container.append(editor);
    });
    status();
  };

  render();
  return { refresh: render, status };
}
