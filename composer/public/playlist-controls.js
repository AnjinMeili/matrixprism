import {
  DEFAULT_SECONDS, ENTRY_SECONDS, MAX_ENTRIES, MAX_PLAYLISTS, describeEntry, nextCuePlace, playlistMatches, trackName,
  unusedPlaylistId,
} from './playlist.js';

// Builds the playlist manager. `api` supplies:
//   get()            current playlist settings
//   commit(next)     validate, store and apply edited settings
//   currentLook()    an entry describing what is on screen now
//   show(entry)      put an entry on screen
//   play(index), stop(), skip(), player   playback
//   cue              a cue list's playback (T76): go(), next(), back(),
//                    hold() (on and off), stop(), and status(), null when
//                    no cue list is playing, else its bar, beat and cues
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
    if (list?.track) {
      // A cue list (T76): Go on the track's first downbeat, then bars.
      const cue = api.cue.status();
      if (playButton) {
        playButton.textContent = cue ? 'Stop' : 'Go';
        playButton.classList.toggle('live', !!cue);
        playButton.disabled = !cue && !list.entries.length;
      }
      if (holdButton) holdButton.setAttribute('aria-pressed', String(!!cue?.held));
      const count = list.entries.length;
      statusLine.textContent = !cue ? `${count} cues · press Go on the track's first downbeat` : [
        `Bar ${cue.bar}.${cue.beat}`,
        cue.current === null ? 'before the first cue' : `cue ${cue.current + 1} of ${count}`,
        cue.next === null ? 'no more cues' : `next in ${untilNext(cue.beatsToNext)}`,
        ...(cue.held ? ['held'] : []), ...(cue.waiting ? ['waiting for the bar line'] : []),
      ].join(' · ');
      for (const details of container.querySelectorAll('details[data-entry]'))
        details.classList.toggle('current', !!cue && Number(details.dataset.entry) === cue.current);
      return;
    }
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
  let holdButton;
  // "2 bars", "1 bar 3 beats", "1 beat": whole beats to the next cue.
  const untilNext = (beats) => {
    const left = Math.max(1, Math.ceil(beats - 1e-9));
    const bars = Math.floor(left / 4), rest = left % 4;
    const count = (n, word) => (n ? `${n} ${word}${n === 1 ? '' : 's'}` : '');
    return [count(bars, 'bar'), count(rest, 'beat')].filter(Boolean).join(' ');
  };

  const entryEditor = (entry, index, entries, cueList) => {
    const summary = element('summary');
    const label = () => {
      summary.textContent = `${index + 1}. ${entry.name ? `${entry.name}: ` : ''}` +
        `${describeEntry(entry, api.patternName)} · ${cueList ? `bar ${(entry.at?.bars ?? 0) + 1}` : `${entry.seconds} s`}`;
    };
    label();
    const change = (next) => {
      const updated = [...entries];
      updated[index] = { ...entry, ...next };
      // A cue is placed in bars, not timed in seconds.
      if (cueList) delete updated[index].seconds;
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
    // A cue's bar in the track, from 1, at the start of that bar.
    const bar = element('input', { type: 'number', value: (entry.at?.bars ?? 0) + 1, min: 1, max: 4097, step: 1, required: true });
    bar.addEventListener('change', () => run(() => {
      if (!bar.checkValidity()) throw new Error('A cue\'s bar is a whole number from 1.');
      change({ at: { marker: 'start', bars: Number(bar.value) - 1, beats: 0 } });
    }));
    return element('details', { open: false },
      summary,
      element('label', {}, 'Name', name),
      cueList ? element('label', {}, 'At bar', bar) : element('label', {}, 'Show for (seconds)', seconds),
      element('div', { className: 'row' },
        button('Show now', () => (!cueList && api.player.playing ? api.play(index) : api.show(entry))),
        button('Replace with current look', () => change({ ...api.currentLook(), name: entry.name,
          ...(cueList ? { at: entry.at } : { seconds: entry.seconds }) }))),
      element('div', { className: 'row' },
        button('Move up', () => move(index - 1), { disabled: index === 0 }),
        button('Move down', () => move(index + 1), { disabled: index === entries.length - 1 }),
        button('Remove', () => setEntries(entries.filter((_, i) => i !== index)))));
  };

  // Typed into Find: the playlist menu shows only the lists that match.
  let query = '';

  const render = () => {
    const settings = api.get(), list = active();
    container.replaceChildren();

    const picker = element('select', { id: 'playlist-select' });
    const fill = () => {
      picker.replaceChildren();
      for (const each of settings.lists) {
        if (each.id !== settings.activeId && !playlistMatches(each, query)) continue;
        picker.append(element('option', { value: each.id, textContent: each.track ? `♪ ${each.name}` : each.name }));
      }
      picker.value = settings.activeId ?? '';
    };
    fill();
    picker.disabled = settings.lists.length === 0;
    const choose = (id) => run(() => {
      api.stop();
      api.cue.stop();
      api.commit({ ...api.get(), activeId: id });
      render();
    });
    picker.addEventListener('change', () => choose(picker.value));
    // Find (T76): a playlist or a cue list by part of its name, or its track's
    // artist or title. Enter opens the first that matches.
    const find = element('input', { type: 'search', id: 'playlist-find', value: query, placeholder: 'Find by name, artist or title',
      autocomplete: 'off' });
    // A search, not a setting: it starts empty after a reload.
    find.dataset.notSaved = '';
    find.addEventListener('input', () => {
      query = find.value;
      fill();
    });
    find.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const first = api.get().lists.find((each) => playlistMatches(each, query));
      if (first && first.id !== api.get().activeId) choose(first.id);
    });
    container.append(element('label', {}, 'Find', find));
    container.append(element('label', {}, 'Playlist', picker));
    const create = (extra) => {
      const id = newId();
      api.stop();
      api.cue.stop();
      api.commit({ ...settings, lists: [...settings.lists, { id, entries: [], ...extra }], activeId: id });
      query = '';
      render();
    };
    container.append(element('div', { className: 'row' },
      button('New', () => {
        const name = prompt('Name for the new playlist', `Playlist ${settings.lists.length + 1}`);
        if (name !== null) create({ name });
      }, { disabled: settings.lists.length >= MAX_PLAYLISTS }),
      button('New cue list', () => {
        const artist = prompt('The track\'s artist', '');
        if (artist === null) return;
        const title = prompt('The track\'s title', '');
        if (title === null) return;
        if (!artist.trim() && !title.trim()) throw new Error('A cue list needs the track\'s artist or title.');
        create({ track: { artist, title } });
      }, { id: 'playlist-new-cue-list', disabled: settings.lists.length >= MAX_PLAYLISTS }),
      button('Rename', () => {
        const name = prompt('New name', list.name);
        if (name === null) return;
        api.commit({ ...settings, lists: settings.lists.map(each => each === list ? { ...list, name } : each) });
        render();
      }, { disabled: !list || !!list.track }),
      button('Delete', () => {
        if (!confirm(`Delete the playlist "${list.name}" and its ${list.entries.length} entries?`)) return;
        api.stop();
        api.cue.stop();
        api.commit({ ...settings, lists: settings.lists.filter(each => each !== list), activeId: null });
        render();
      }, { disabled: !list })));

    // A cue list's track: its name is the track's, "Artist – Title".
    if (list?.track) {
      const field = (key, label) => {
        const input = element('input', { type: 'text', value: list.track[key], maxLength: 80, id: `playlist-track-${key}` });
        input.addEventListener('change', () => run(() => {
          const track = { ...list.track, [key]: input.value };
          if (!track.artist.trim() && !track.title.trim()) throw new Error('A cue list needs the track\'s artist or title.');
          api.commit({ ...api.get(), lists: api.get().lists.map(each => each.id === list.id ? { ...list, track } : each) });
          render();
        }));
        return element('label', {}, label, input);
      };
      container.append(element('div', { className: 'row' }, field('artist', 'Artist'), field('title', 'Title')));
      container.append(element('p', { className: 'hint', textContent: `Cue list for ${trackName(list.track)}: ` +
        'each cue is placed at a bar of the track. Press Go on its first downbeat.' }));
    }

    container.append(element('label', {}, 'Plays on', pairPicker(settings)));
    if (list?.track) {
      playButton = button('Go', () => {
        if (api.cue.status()) api.cue.stop();
        else api.cue.go();
        status();
      }, { id: 'playlist-play', className: 'primary', title: 'Press on the track\'s first downbeat' });
      holdButton = button('Hold', () => { api.cue.hold(); status(); },
        { id: 'playlist-hold', title: 'Stop the cue list where it is, as when the DJ loops; press again to go on' });
      container.append(element('div', { className: 'row' },
        playButton,
        button('Back', () => { api.cue.back(); status(); },
          { id: 'playlist-back', title: 'The cue before, on the next bar line' }),
        button('Next', () => { api.cue.next(); status(); },
          { id: 'playlist-next', title: 'The next cue, on the next bar line' }),
        holdButton));
    } else {
      holdButton = null;
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
    }
    container.append(statusLine);

    container.append(button(list?.track ? 'Add current look as a cue' : 'Add current look', () => {
      const look = api.currentLook();
      if (list.track) delete look.seconds;
      setEntries([...list.entries, list.track ? { ...look, at: nextCuePlace(list.entries) } : { ...look, seconds: DEFAULT_SECONDS }]);
      container.querySelector('details[data-entry]:last-of-type')?.setAttribute('open', '');
    }, { id: 'playlist-add', disabled: !list || list.entries.length >= MAX_ENTRIES }));

    list?.entries.forEach((entry, index, entries) => {
      const editor = entryEditor(entry, index, entries, !!list.track);
      editor.dataset.entry = index;
      container.append(editor);
    });
    status();
  };

  // The pair entries show on and play on (T73); a whole-quad entry fills both.
  const pairPicker = (settings) => {
    const pair = element('select', { id: 'playlist-pair', title: 'The pair Show now, Play and Go load entries into. ' +
      'Set up the pair off air, then blend the main across to it' });
    for (const [value, text] of [['left', 'Left'], ['right', 'Right']])
      pair.append(element('option', { value, textContent: text }));
    pair.value = settings.pair;
    pair.addEventListener('change', () => run(() => api.commit({ ...api.get(), pair: pair.value })));
    return pair;
  };

  render();
  return { refresh: render, status };
}
