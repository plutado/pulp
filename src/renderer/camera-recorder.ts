/**
 * Record from a camera with one click (milestone 64), the voice recorder's
 * idea for picture (src/renderer/recorder.ts). The camera button beside the
 * microphone — or File → Record Video — opens a live preview from the chosen
 * camera (the system's default until one is chosen) with its sound; Record
 * starts the take and the elapsed time shows over the picture; Record again,
 * Escape, Close or the menu ends it. The take lands in the managed Recordings
 * folder, converted to an MP4 the editors open (src/main/recording-service.ts),
 * and is selected in the results with its poster and hover scrub.
 *
 * The renderer records because it is the process with `getUserMedia`; the
 * recorder hands a piece of the file to the main process every second, so a
 * long take is never held here and a camera unplugged mid-take keeps what it
 * recorded. The preview is mirrored for a camera facing the person; the file
 * never is — the mirror is the preview's styling, and the recorder takes the
 * camera's own picture.
 */

import { runningTime } from '../core/display';
import type { MessageId, MessageValues } from '../core/i18n';
import { RECORDINGS_FOLDER_NAME } from '../core/recording';
import { cameraFrameRate, DEFAULT_VIDEO_INPUTS, mirrorsPreview, pickTakeMimeType, takeBitrate, type VideoInputs } from '../core/video-take';
import type { DeviceAccess, VideoTakeFacts } from '../shared/api';
import { menuStateChanged } from './menu';
import { recordingActive, registerVoiceBlocker, showSavedTake } from './recorder';
import { sayInTray } from './tray';
import { bindText, t } from './i18n';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

/** Closed; the preview up; a take recording; a take on its way into the library. */
type Phase = 'off' | 'preview' | 'recording' | 'saving';

interface Take {
  /**
   * The main process's id for the take, which arrives a round trip after Record is pressed. The take
   * does not wait for it — the recorder starts at the press — so a piece waits for it instead.
   */
  id: Promise<string>;
  recorder: MediaRecorder;
  facts: VideoTakeFacts;
  started: number;
  /** Every piece sent so far, in order: the take is finished only once the last has landed. */
  sent: Promise<void>;
  pieces: number;
  failed: Error | null;
  clock: ReturnType<typeof setInterval>;
  /** True once the take is being closed, so Record, Escape, Close and a dying camera cannot end it twice. */
  closing: boolean;
}

let phase: Phase = 'off';
let stream: MediaStream | null = null;
let inputs: VideoInputs = DEFAULT_VIDEO_INPUTS;
let take: Take | null = null;
/** Which opening of the camera is current, so a slow one finishing after a newer one is let go. */
let opening = 0;

/** Whether a camera's take is being recorded now: what File → Record Video reads for its label. */
export function cameraRecording(): boolean {
  return phase === 'recording';
}

const dialog = () => $<HTMLDialogElement>('camera-dialog');

function paint(): void {
  const recording = phase === 'recording';
  $('record-video').setAttribute('aria-pressed', String(recording));
  const record = $<HTMLButtonElement>('camera-record');
  // Bound, so a change of language reaches the button while nothing is recording too.
  bindText(record, recording ? 'camera.record.stop' : 'ui.camera-record');
  record.setAttribute('aria-pressed', String(recording));
  record.disabled = !(phase === 'recording' || (phase === 'preview' && stream !== null));
  $<HTMLSelectElement>('camera-source').disabled = phase !== 'preview';
  $<HTMLSelectElement>('camera-sound').disabled = phase !== 'preview';
  $('camera-live').hidden = !recording;
  menuStateChanged();
}

/** The status line from the catalog: a change of language rewrites it while it shows. */
function sayStatus(id: MessageId, values?: MessageValues): void {
  bindText($('camera-status'), id, values);
}

/** The status line emptied, and whatever message it held let go of, so a change of language does not bring it back. */
function sayNothing(): void {
  const status = $('camera-status');
  delete status.dataset.i18n;
  delete status.dataset.i18nValues;
  status.textContent = '';
}

function sayRefused(access: Extract<DeviceAccess, { ok: false }>): void {
  // A microphone refused still leaves the picture: No sound records without it.
  // The refusal's own words are the main process's (or the camera's, below), already in the language.
  const note = access.device === 'microphone' ? t('camera.denied.microphone', { message: access.message }) : access.message;
  $('camera-denied').hidden = false;
  $('camera-denied-note').textContent = note;
  const open = $<HTMLButtonElement>('camera-open-settings');
  open.hidden = !access.canOpenSettings;
  open.dataset.device = access.device;
}

/** The camera off: its light goes out the moment the preview is not needed. */
function release(): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = null;
  $<HTMLVideoElement>('camera-preview').srcObject = null;
}

/** The menus: the cameras, and the sound — No sound, the default microphone, each input — the remembered one chosen. */
async function fillMenus(): Promise<void> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((d) => d.kind === 'videoinput');
  const mics = devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
  // A device's own label is the system's; what Pulp names, it names from the catalog, bound so the
  // menus follow a change of language while the preview is up.
  const option = (value: string, label: string | null, id: MessageId, values?: MessageValues) => {
    const o = document.createElement('option');
    o.value = value;
    if (label) o.textContent = label;
    else bindText(o, id, values);
    return o;
  };
  const source = $<HTMLSelectElement>('camera-source');
  source.replaceChildren(option('', null, 'camera.source.default'), ...cameras.map((d, i) => option(d.deviceId, d.label, 'camera.source.unnamed', { number: i + 1 })));
  source.value = inputs.camera && cameras.some((d) => d.deviceId === inputs.camera!.id) ? inputs.camera.id : '';
  const sound = $<HTMLSelectElement>('camera-sound');
  sound.replaceChildren(option('off', null, 'camera.sound.off'), option('', null, 'camera.sound.default'), ...mics.map((d, i) => option(d.deviceId, d.label, 'camera.sound.unnamed', { number: i + 1 })));
  sound.value = !inputs.sound ? 'off' : inputs.microphone && mics.some((d) => d.deviceId === inputs.microphone!.id) ? inputs.microphone.id : '';
}

/** Open the chosen camera (and microphone, with sound) into the preview. */
async function startPreview(): Promise<void> {
  const ticket = ++opening;
  release();
  $('camera-denied').hidden = true;
  sayStatus('camera.status.opening');
  paint();
  const access = await window.pulp.cameraAccess(inputs.sound);
  if (ticket !== opening || phase !== 'preview') return;
  if (!access.ok) {
    sayRefused(access);
    sayNothing();
    return;
  }
  // The camera at up to 1080p and 30 frames/s, what it gives within that kept as it is: Chromium
  // opens a camera at 640 × 480 unless asked for more, and `ideal`, not `exact`, so a camera that
  // cannot reach it still opens — as a remembered device that is not plugged in today falls back.
  const video: MediaTrackConstraints = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, ...(inputs.camera ? { deviceId: { ideal: inputs.camera.id } } : {}) };
  const audio: MediaTrackConstraints | boolean = inputs.sound ? (inputs.microphone ? { deviceId: { ideal: inputs.microphone.id } } : true) : false;
  let opened: MediaStream;
  let noMicrophone = false;
  try {
    opened = await navigator.mediaDevices.getUserMedia({ video, audio });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (audio && name === 'NotFoundError') {
      // A camera and no microphone at all: the picture alone, said plainly, rather than nothing.
      try {
        opened = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        noMicrophone = true;
      } catch {
        if (ticket === opening) sayStatus('camera.status.no-camera');
        return;
      }
    } else {
      if (ticket !== opening) return;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        sayRefused({ ok: false, device: 'camera', message: t('camera.denied.camera'), canOpenSettings: false });
        sayNothing();
      } else {
        sayStatus('camera.status.no-camera');
      }
      return;
    }
  }
  if (ticket !== opening || phase !== 'preview') {
    for (const track of opened.getTracks()) track.stop();
    return;
  }
  stream = opened;
  const [track] = opened.getVideoTracks();
  const settings = track?.getSettings() ?? {};
  const preview = $<HTMLVideoElement>('camera-preview');
  preview.srcObject = opened;
  preview.classList.toggle('mirrored', mirrorsPreview(settings.facingMode));
  void preview.play().catch(() => undefined);
  // A camera that goes away while only previewing: said, and Record is off until it is back.
  track?.addEventListener('ended', () => {
    if (phase === 'preview' && stream === opened) {
      release();
      sayStatus('camera.status.stopped');
      paint();
    }
  });
  const rate = cameraFrameRate(settings.frameRate);
  const facts = { width: settings.width ?? '?', height: settings.height ?? '?', fps: Number(rate.fps.toFixed(2)) };
  sayStatus(noMicrophone ? 'camera.status.facts-no-microphone' : 'camera.status.facts', facts);
  await fillMenus();
  paint();
}

/** Open the preview; the first step of one click, Record being the second. */
async function openPreview(): Promise<void> {
  if (phase !== 'off') return;
  if (recordingActive()) {
    sayInTray(t('camera.voice-busy'));
    return;
  }
  phase = 'preview';
  inputs = await window.pulp.getVideoInputs();
  sayNothing();
  if (!dialog().open) dialog().showModal();
  paint();
  await startPreview();
}

function startTake(): void {
  if (phase !== 'preview' || !stream || take) return;
  const opened = stream;
  const [track] = opened.getVideoTracks();
  if (!track || track.readyState !== 'live') return;
  const sound = opened.getAudioTracks().length > 0;
  const mimeType = pickTakeMimeType(sound, (type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) {
    sayStatus('camera.unsupported');
    return;
  }
  const settings = track.getSettings();
  const facts: VideoTakeFacts = { width: settings.width ?? 0, height: settings.height ?? 0, frameRate: settings.frameRate, sound };
  const fps = cameraFrameRate(settings.frameRate).fps;
  const recorder = new MediaRecorder(opened, { mimeType, videoBitsPerSecond: takeBitrate(facts.width, facts.height, fps, 0.2), audioBitsPerSecond: 192_000 });
  // The take begins at the press: the recorder starts now and the clock reads from now. Waiting for
  // the main process to open the take first lost its first moments, and a Stop pressed inside that
  // round trip — a slow machine's half second — found no take and dropped the recording.
  const id = window.pulp.beginVideoTake();
  const started = performance.now();
  const current: Take = {
    id, recorder, facts, started, pieces: 0, failed: null, closing: false,
    sent: id.then(() => undefined, (err: Error) => { current.failed ??= new Error(t('camera.take.begin-failed', { reason: err.message })); }),
    // A live clock floors, as the voice's does: 0:01 only once a whole second has gone by.
    clock: setInterval(() => {
      const whole = Math.floor((performance.now() - started) / 1000);
      $('camera-time').textContent = whole <= 0 ? '0:00' : runningTime(whole);
    }, 250),
  };
  take = current;
  recorder.addEventListener('dataavailable', (e) => {
    if (e.data.size === 0) return;
    current.pieces += 1;
    // In order, each after the one before and after the take has its id.
    current.sent = current.sent
      .then(async () => { if (!current.failed) await window.pulp.appendVideoTake(await id, await e.data.arrayBuffer()); })
      .catch((err: Error) => { current.failed ??= err; });
  });
  recorder.addEventListener('stop', () => void saveTake(current));
  recorder.addEventListener('error', () => stopTake());
  // The camera or the microphone dying mid-take — unplugged, or taken by the system — ends the take and keeps what it has.
  for (const t of opened.getTracks()) t.addEventListener('ended', () => stopTake());
  $('camera-time').textContent = '0:00';
  phase = 'recording';
  recorder.start(1000);
  paint();
}

/** End the take: the recorder hands over its last piece, then 'stop' saves it. */
function stopTake(): void {
  if (!take || take.closing) return;
  take.closing = true;
  if (take.recorder.state !== 'inactive') take.recorder.stop();
  else void saveTake(take);
}

async function saveTake(done: Take): Promise<void> {
  if (phase === 'saving' || take !== done) return;
  phase = 'saving';
  take = null;
  clearInterval(done.clock);
  const seconds = (performance.now() - done.started) / 1000;
  // The camera off and the preview gone at once: the take is over the moment it is stopped.
  release();
  if (dialog().open) dialog().close();
  paint();
  await done.sent;
  phase = 'off';
  paint();
  // Nothing to finish when the take never began: there is no id to abandon either.
  const id = await done.id.catch(() => null);
  if (id === null || done.pieces === 0 || done.failed) {
    if (id !== null) await window.pulp.abandonVideoTake(id).catch(() => undefined);
    if (done.failed) sayInTray(t('camera.save-failed', { reason: done.failed.message }), true);
    else sayInTray(t('camera.nothing'));
    return;
  }
  sayInTray(t('camera.saving', { folder: RECORDINGS_FOLDER_NAME }));
  try {
    const saved = await window.pulp.finishVideoTake(id, done.facts);
    sayInTray(saved.note ?? t('camera.saved', { time: runningTime(seconds), folder: RECORDINGS_FOLDER_NAME }));
    if (saved.id) showSavedTake(saved.id);
  } catch (err) {
    sayInTray(t('camera.save-failed', { reason: (err as Error).message }), true);
  }
}

/** The one behavior behind File → Record Video: open the preview; with it up, record; recording, stop. */
export function toggleCamera(): void {
  if (phase === 'off') void openPreview();
  else if (phase === 'preview') startTake();
  else if (phase === 'recording') stopTake();
}

/** A remembered choice changed in a menu: kept, and the preview reopened on it. */
function choose(change: Partial<VideoInputs>): void {
  inputs = { ...inputs, ...change };
  void window.pulp.setVideoInputs(inputs);
  void startPreview();
}

export function initCameraRecorder(): void {
  $('record-video').addEventListener('click', () => void openPreview());
  $('camera-record').addEventListener('click', () => (phase === 'recording' ? stopTake() : startTake()));
  $('camera-open-settings').addEventListener('click', (e) => {
    void window.pulp.openPrivacySettings((e.currentTarget as HTMLElement).dataset.device === 'microphone' ? 'microphone' : 'camera');
  });
  $<HTMLSelectElement>('camera-source').addEventListener('change', (e) => {
    const select = e.currentTarget as HTMLSelectElement;
    choose({ camera: select.value ? { id: select.value, label: select.selectedOptions[0]?.textContent ?? t('camera.source.fallback') } : null });
  });
  $<HTMLSelectElement>('camera-sound').addEventListener('change', (e) => {
    const select = e.currentTarget as HTMLSelectElement;
    if (select.value === 'off') choose({ sound: false });
    else choose({ sound: true, microphone: select.value ? { id: select.value, label: select.selectedOptions[0]?.textContent ?? t('camera.sound.fallback') } : null });
  });
  // Escape while recording ends the take rather than the preview under it.
  // Escape with nothing recording turns the camera off at the key, not a task later when 'close' runs.
  dialog().addEventListener('cancel', (e) => {
    if (phase === 'recording') {
      e.preventDefault();
      stopTake();
    } else if (phase === 'preview') {
      opening += 1;
      release();
    }
  });
  // However the preview closes — Close, Escape — a take running is ended and kept, never dropped.
  dialog().addEventListener('close', () => {
    if (phase === 'recording') stopTake();
    else if (phase === 'preview') {
      opening += 1;
      release();
      phase = 'off';
      paint();
    }
  });
  // A voice and a camera's take never hold the microphone at once.
  registerVoiceBlocker(() => (phase === 'off' ? null : t('camera.blocks-voice')));
}
