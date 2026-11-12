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

test('voice timer uses persisted duration before browser audio metadata is ready', () => {
  assert.equal(audioPlayer.formatPlaybackTime(NaN, 0, false, false, false, 83), '01:23');
  assert.equal(audioPlayer.formatPlaybackTime(83, 17, true, false, false, 83), '01:06');
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

test('player renders persisted duration immediately and keeps play/pause glyphs visible', () => {
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
    dispatch(name) { for (const callback of this.listeners.get(name) || []) callback({}); }
    load() {}
    pause() { this.paused = true; this.dispatch('pause'); }
    play() { this.paused = false; this.dispatch('play'); return Promise.resolve(); }
    getBoundingClientRect() { return { left: 0, width: 100 }; }
  }
  const document = { createElement: tag => new FakeElement(tag) };
  const player = audioPlayer.create({ document }).createPlayer({
    messageId: 'voice-1',
    src: 'https://example.invalid/voice.webm',
    durationSeconds: 83
  });
  const find = (node, className) => {
    if (node.className.split(/\\s+/).includes(className)) return node;
    for (const child of node.children) {
      const match = find(child, className);
      if (match) return match;
    }
    return null;
  };
  const timer = find(player, 'voice-player-timer');
  const button = find(player, 'voice-player-toggle');
  const audio = find(player, 'voice-player-native-audio');
  assert.equal(timer.textContent, '01:23');
  assert.match(button.innerHTML, /voice-player-glyph-play/);

  audio.duration = 83;
  audio.readyState = 1;
  audio.dispatch('loadedmetadata');
  assert.equal(timer.textContent, '01:23');
  audio.currentTime = 17;
  audio.paused = false;
  audio.dispatch('play');
  assert.equal(timer.textContent, '01:06');
  assert.match(button.innerHTML, /voice-player-glyph-pause/);

  audio.paused = true;
  audio.dispatch('pause');
  assert.equal(timer.textContent, '01:06');
  assert.match(button.innerHTML, /voice-player-glyph-play/);

  audio.currentTime = 83;
  audio.ended = true;
  audio.dispatch('ended');
  assert.equal(timer.textContent, '01:23');
});
