import test from 'node:test';
import assert from 'node:assert/strict';
import voiceRecorderModule from '../modules/voice-recorder.js';

const { create, MAX_BYTES } = voiceRecorderModule;

class FakeMediaRecorder {
  static isTypeSupported(type) {
    return type === 'audio/webm;codecs=opus' || type === 'audio/webm';
  }

  constructor(stream, options = {}) {
    this.stream = stream;
    this.mimeType = options.mimeType || 'audio/webm';
    this.state = 'inactive';
    this.requested = false;
    FakeMediaRecorder.instances.push(this);
  }

  start(timeslice) {
    this.timeslice = timeslice;
    this.state = 'recording';
  }

  requestData() {
    this.requested = true;
    this.ondataavailable?.({ data: new Blob(['final-chunk'], { type: 'audio/webm' }) });
  }

  stop() {
    if (this.state === 'inactive') throw new Error('already stopped');
    this.state = 'inactive';
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(['stop-chunk'], { type: 'audio/webm' }) });
      this.onstop?.();
    });
  }

  pause() {
    if (this.state !== 'recording') throw new Error('not recording');
    this.state = 'paused';
  }

  resume() {
    if (this.state !== 'paused') throw new Error('not paused');
    this.state = 'recording';
  }
}
FakeMediaRecorder.instances = [];

function setup(overrides = {}) {
  FakeMediaRecorder.instances = [];
  const events = [];
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  const stream = { getTracks: () => tracks };
  let context = {
    active: { id: 'conversation-1', type: 'direct', members: [{ user_id: 'user-1', role: 'member' }] },
    user: { id: 'user-1' },
    groupSettings: null,
    uploading: false,
    attachment: null
  };
  let clock = 1000;
  const controller = create({
    getContext: () => context,
    mediaDevices: { getUserMedia: async () => stream },
    MediaRecorder: FakeMediaRecorder,
    isSecureContext: true,
    now: () => clock,
    setInterval: () => 1,
    clearInterval: () => {},
    toast: message => events.push(['toast', message]),
    onRecordingReady: payload => events.push(['ready', payload]),
    send: async () => { events.push(['send']); },
    ...overrides
  });
  return {
    controller, events, tracks, stream,
    get clock() { return clock; },
    set clock(value) { clock = value; },
    get context() { return context; },
    set context(value) { context = value; }
  };
}

test('a recording is sent once only after the final recorder chunk and stop event', async () => {
  const env = setup();
  assert.equal(await env.controller.start(), true);
  assert.equal(env.controller.getPhase(), 'recording');
  assert.equal(FakeMediaRecorder.instances[0].timeslice, 1000);

  const result = await env.controller.send();
  assert.equal(result, true);
  assert.equal(FakeMediaRecorder.instances[0].requested, true);
  assert.equal(env.events.filter(item => item[0] === 'ready').length, 1);
  assert.equal(env.events.filter(item => item[0] === 'send').length, 1);
  assert.equal(env.controller.isActive(), false);
  assert.equal(env.tracks[0].stopped, true);
});

test('pause and resume account for elapsed time without a fixed three-minute cutoff', async () => {
  const env = setup();
  assert.equal(await env.controller.start(), true);
  env.clock = 121000;
  assert.equal(env.controller.pause(), true);
  env.clock = 241000;
  assert.equal(env.controller.resume(), true);
  env.clock = 301000;
  assert.equal(await env.controller.send(), true);
  const ready = env.events.find(item => item[0] === 'ready')[1];
  assert.equal(ready.duration, 180);
  assert.equal(env.events.filter(item => item[0] === 'send').length, 1);
});

test('cancelling stops the microphone and never creates or sends an attachment', async () => {
  const env = setup();
  assert.equal(await env.controller.start(), true);
  assert.equal(env.controller.cancel(), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.controller.isActive(), false);
  assert.equal(env.events.some(item => item[0] === 'ready'), false);
  assert.equal(env.events.some(item => item[0] === 'send'), false);
  assert.equal(env.tracks[0].stopped, true);
});

test('a late microphone permission result cannot attach audio to a different conversation', async () => {
  let release;
  const env = setup({
    mediaDevices: { getUserMedia: () => new Promise(resolve => { release = resolve; }) }
  });
  const pending = env.controller.start();
  assert.equal(env.controller.getPhase(), 'requesting');
  env.context = {
    active: { id: 'conversation-2', type: 'direct', members: [] },
    user: { id: 'user-1' },
    uploading: false,
    attachment: null
  };
  env.controller.cancel();
  release(env.stream);
  assert.equal(await pending, false);
  assert.equal(env.tracks[0].stopped, true);
  assert.equal(env.events.some(item => item[0] === 'ready'), false);
});

test('recording is blocked for non-admins in admin-only groups and channels', async () => {
  const env = setup();
  env.context = {
    ...env.context,
    active: { id: 'group-1', type: 'group', members: [{ user_id: 'user-1', role: 'member' }] },
    groupSettings: { only_admins_can_send: true }
  };
  assert.equal(await env.controller.start(), false);
  assert.equal(env.controller.isActive(), false);
  assert.equal(FakeMediaRecorder.instances.length, 0);
  assert.ok(env.events.some(item => item[0] === 'toast'));
});

test('a recorder failure resets the controller and releases the microphone', async () => {
  const env = setup();
  assert.equal(await env.controller.start(), true);
  const recorder = FakeMediaRecorder.instances[0];
  recorder.onerror?.({ error: new Error('simulated recorder failure') });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.controller.isActive(), false);
  assert.equal(env.tracks[0].stopped, true);
});

test('the maximum attachment size remains 12 MiB', () => {
  assert.equal(MAX_BYTES, 12 * 1024 * 1024);
});
test('cancelling after stop was requested prevents the queued stop event from attaching audio', async () => {
  const env = setup();
  assert.equal(await env.controller.start(), true);
  const pendingSend = env.controller.send();
  assert.equal(env.controller.getPhase(), 'stopping');
  assert.equal(env.controller.cancel(), true);
  assert.equal(await pendingSend, false);
  assert.equal(env.controller.isActive(), false);
  assert.equal(env.events.some(item => item[0] === 'ready'), false);
  assert.equal(env.events.some(item => item[0] === 'send'), false);
});
