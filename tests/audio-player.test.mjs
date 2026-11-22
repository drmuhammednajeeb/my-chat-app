import test from 'node:test';
import assert from 'node:assert/strict';
import audioPlayer from '../modules/audio-player.js';

test('starting another voice message pauses the previously active audio', () => {
  const coordinator = audioPlayer.createPlaybackCoordinator();
  const events = [];
  const first = { pause() { events.push('first-paused'); } };
  const second = { pause() { events.push('second-paused'); } };
  coordinator.activate(first);
  assert.equal(coordinator.getActive(), first);
  coordinator.activate(second);
  assert.deepEqual(events, ['first-paused']);
  assert.equal(coordinator.getActive(), second);
});

test('re-activating the same audio does not pause itself', () => {
  const coordinator = audioPlayer.createPlaybackCoordinator();
  let pauses = 0;
  const audio = { pause() { pauses += 1; } };
  coordinator.activate(audio);
  coordinator.activate(audio);
  assert.equal(pauses, 0);
  assert.equal(coordinator.getActive(), audio);
});

test('a delayed pause event from an older player cannot clear the newer active player', () => {
  const coordinator = audioPlayer.createPlaybackCoordinator();
  const first = { pause() {} };
  const second = { pause() {} };
  coordinator.activate(first);
  coordinator.activate(second);
  coordinator.release(first);
  assert.equal(coordinator.getActive(), second);
});

test('stopAll pauses the active audio and clears the shared playback reference', () => {
  const coordinator = audioPlayer.createPlaybackCoordinator();
  let pauses = 0;
  const audio = { pause() { pauses += 1; } };
  coordinator.activate(audio);
  coordinator.stop();
  assert.equal(pauses, 1);
  assert.equal(coordinator.getActive(), null);
});

test('time formatter handles empty and fractional durations', () => {
  assert.equal(audioPlayer.formatTime(0), '00:00');
  assert.equal(audioPlayer.formatTime(61.9), '01:01');
});

test('voice timer shows the fixed total before playback and counts down while playing', () => {
  assert.equal(audioPlayer.formatPlaybackTime(83, 0, false, false, true), '01:23');
  assert.equal(audioPlayer.formatPlaybackTime(83, 17, true, false, true), '01:06');
  assert.equal(audioPlayer.formatPlaybackTime(83, 83, true, true, true), '01:23');
});

test('voice timer does not display a false zero while audio metadata is unavailable', () => {
  assert.equal(audioPlayer.formatPlaybackTime(NaN, 0, false, false, false), '--:--');
  assert.equal(audioPlayer.formatPlaybackTime(0, 0, false, false, true), '00:00');
});

test('player source keeps native controls available when custom playback fails', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../modules/audio-player.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../modules/audio-player.css', import.meta.url), 'utf8');
  assert.ok(source.includes('coordinator.activate(audio);'));
  assert.ok(source.includes('playButton.setAttribute("aria-pressed", playing ? "true" : "false")'));
  assert.ok(source.includes('timerLabel.textContent = formatPlaybackTime'));
  assert.ok(!source.includes('currentTime.textContent = formatTime(elapsed)'));
  assert.ok(source.includes('audio.controls = true;'));
  assert.ok(source.includes('showFallback(error)'));
  assert.ok(styles.includes('.voice-message-player.has-playback-error .voice-player-native-audio'));
  assert.ok(styles.includes('.voice-player-glyph-play'));
  assert.ok(styles.includes('.voice-player-glyph-pause'));
  assert.ok(!source.includes('ph-play-fill'));
  assert.ok(!source.includes('ph-pause-fill'));
  assert.ok(styles.includes('.voice-player-timer{justify-self:end'));
  assert.ok(!styles.includes('.message .bubble .voice-message-player audio{display:none}'));
});


test('voice player keeps visible controls, loads metadata after attachment, seeks and updates remaining time', async () => {
  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.attributes = {};
      this.dataset = {};
      this.style = {};
      this.listeners = new Map();
      this.className = '';
      this.textContent = '';
      this.innerHTML = '';
      this.paused = true;
      this.ended = false;
      this.duration = NaN;
      this.currentTime = 0;
      this.readyState = 0;
      this.loadCalls = 0;
      this.classList = {
        add: name => { if (!this.className.split(/\\s+/).includes(name)) this.className = (this.className + ' ' + name).trim(); },
        toggle: (name, force) => {
          const names = this.className.split(/\\s+/).filter(Boolean);
          const enabled = force === undefined ? !names.includes(name) : !!force;
          this.className = (enabled ? [...new Set([...names, name])] : names.filter(item => item !== name)).join(' ');
          return enabled;
        }
      };
    }
    append(...nodes) { this.children.push(...nodes); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, callback) {
      const callbacks = this.listeners.get(name) || [];
      callbacks.push(callback);
      this.listeners.set(name, callbacks);
    }
    dispatch(name, event = {}) { for (const callback of this.listeners.get(name) || []) callback(event); }
    load() { this.loadCalls += 1; }
    pause() { this.paused = true; this.dispatch('pause'); }
    play() { this.paused = false; this.dispatch('play'); return Promise.resolve(); }
    getBoundingClientRect() { return { left: 0, width: 100 }; }
  }

  const document = { createElement: tag => new FakeElement(tag) };
  const player = audioPlayer.create({ document }).createPlayer({
    messageId: 'voice-player-ui',
    src: 'https://example.invalid/voice.webm'
  });
  const find = (node, className) => {
    if (node.className.split(/\\s+/).includes(className)) return node;
    for (const child of node.children) {
      const match = find(child, className);
      if (match) return match;
    }
    return null;
  };
  const button = find(player, 'voice-player-toggle');
  const waveform = find(player, 'voice-player-waveform');
  const timer = find(player, 'voice-player-timer');
  const audio = find(player, 'voice-player-native-audio');
  const messageBubble = new FakeElement('div');
  messageBubble.append(player);

  assert.match(button.innerHTML, /voice-player-glyph-play/);
  assert.equal(audio.loadCalls, 0);
  await Promise.resolve();
  assert.equal(audio.loadCalls, 1);

  audio.duration = 90;
  audio.readyState = 1;
  audio.dispatch('loadedmetadata');
  assert.equal(timer.textContent, '01:30');

  button.dispatch('click');
  await Promise.resolve();
  assert.match(button.innerHTML, /voice-player-glyph-pause/);
  audio.currentTime = 20;
  audio.dispatch('timeupdate');
  assert.equal(timer.textContent, '01:10');

  waveform.dispatch('click', { clientX: 75 });
  assert.equal(audio.currentTime, 67.5);
  assert.equal(timer.textContent, '00:22');

  audio.ended = true;
  audio.paused = true;
  audio.currentTime = 90;
  audio.dispatch('ended');
  assert.match(button.innerHTML, /voice-player-glyph-play/);
  assert.equal(timer.textContent, '01:30');
});
