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

test('player source keeps native controls available when custom playback fails', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../modules/audio-player.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../modules/audio-player.css', import.meta.url), 'utf8');
  assert.ok(source.includes('coordinator.activate(audio);'));
  assert.ok(source.includes('audio.controls = true;'));
  assert.ok(source.includes('showFallback(error)'));
  assert.ok(styles.includes('.voice-message-player.has-playback-error .voice-player-native-audio'));
  assert.ok(!styles.includes('.message .bubble .voice-message-player audio{display:none}'));
});
