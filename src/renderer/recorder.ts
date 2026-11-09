/**
 * Record a voice with one click (milestone 63). The microphone button starts
 * listening at once from the chosen input (the system's default until one is
 * chosen from the small menu beside it); a strip over the window shows the
 * level and the elapsed time while it records; the button again, the strip's
 * Stop, Escape, or File → Record Audio ends the take. The samples become a
 * 16-bit WAV (src/core/recording.ts) and land in the managed Recordings
 * folder through the main process, which adds it to the library; the new take
 * is then selected in the results, waveform and all.
 *
 * The renderer records because it is the process with `getUserMedia`; the
 * elapsed time and the meter are read from the samples themselves, so what
 * the strip says is what the file will hold. An input that dies mid-take — a
 * USB microphone unplugged — ends the take and keeps what it has.
 */

import type { MenuItemSpec } from '../core/menu';
import { runningTime } from '../core/display';
import { encodeWav, RECORDING_SAMPLE_RATE, RECORDINGS_FOLDER_NAME } from '../core/recording';
import { openContextMenu } from './context-menu';
import { menuStateChanged } from './menu';
import { sayInTray } from './tray';
import { t } from './i18n';
import { isRtl } from './direction';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

interface Take {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  tap: ScriptProcessorNode;
  chunks: Float32Array[];
  samples: number;
  level: number;
  /** True once the take is being closed, so a button, Escape and a dying input cannot save it twice. */
  closing: boolean;
}

let take: Take | null = null;

/** Whether a voice is being recorded now: what the File menu reads for its label. */
export function recordingActive(): boolean {
  return take !== null;
}

/** How the saved take is shown in the results; main.ts registers the window's own select. */
let opener: (id: string) => void = () => undefined;

export function registerRecordingOpener(fn: (id: string) => void): void {
  opener = fn;
}

/** A saved take shown the same way, whichever recorder made it (the camera's too, milestone 64). */
export function showSavedTake(id: string): void {
  opener(id);
}

/**
 * Why a voice cannot be recorded right now, or null: the camera's preview registers its own, so a
 * voice take and a camera take never hold the microphone at once — File → Record Audio still
 * answers with the preview up, where the button is behind it.
 */
let blocker: () => string | null = () => null;

export function registerVoiceBlocker(fn: () => string | null): void {
  blocker = fn;
}

function paint(): void {
  const recording = take !== null;
  $('record-audio').setAttribute('aria-pressed', String(recording));
  $('rec-strip').hidden = !recording && $('rec-denied').hidden;
  $('rec-live').hidden = !recording;
  menuStateChanged();
}

/** The strip carries the refusal and the way to the settings, where a tray line could hold no button. */
function sayRefused(message: string, canOpenSettings: boolean): void {
  $('rec-denied').hidden = false;
  $('rec-denied-note').textContent = message;
  $('rec-open-settings').hidden = !canOpenSettings;
  paint();
}

function dismissRefusal(): void {
  $('rec-denied').hidden = true;
  paint();
}

/** While a take runs, Escape is its key alone: seen before the start screen or a dialog hears it. */
function onEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  void stopRecording();
}

async function startRecording(): Promise<void> {
  const blocked = blocker();
  if (blocked) {
    sayInTray(blocked);
    return;
  }
  dismissRefusal();
  const access = await window.pulp.microphoneAccess();
  if (!access.ok) {
    sayRefused(access.message, access.canOpenSettings);
    return;
  }
  const chosen = await window.pulp.getRecordingInput();
  let stream: MediaStream;
  try {
    // `ideal`, not `exact`: a remembered microphone that is not plugged in today falls back to the
    // system's default rather than refusing to record.
    stream = await navigator.mediaDevices.getUserMedia({ audio: chosen ? { deviceId: { ideal: chosen.id } } : true });
  } catch (err) {
    const wasRefused = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    sayRefused(t(wasRefused ? 'recorder.denied' : 'recorder.no-microphone'), wasRefused);
    return;
  }
  if (take) {
    // Two starts raced (the button and the menu's key): the second yields.
    for (const track of stream.getTracks()) track.stop();
    return;
  }
  const context = new AudioContext({ sampleRate: RECORDING_SAMPLE_RATE });
  const source = context.createMediaStreamSource(stream);
  // A script processor rather than a worklet: the tap only copies samples out, and a worklet would
  // be the one module loaded over a URL in a page whose scripts are otherwise its own.
  const tap = context.createScriptProcessor(4096, 1, 1);
  take = { stream, context, source, tap, chunks: [], samples: 0, level: 0, closing: false };
  tap.onaudioprocess = (e) => {
    if (!take) return;
    const heard = e.inputBuffer.getChannelData(0);
    take.chunks.push(new Float32Array(heard));
    take.samples += heard.length;
    // The time and the level come from the samples themselves: what is shown is what will be saved.
    let peak = 0;
    for (let i = 0; i < heard.length; i++) peak = Math.max(peak, Math.abs(heard[i]!));
    take.level = Math.max(peak, take.level * 0.85);
    // A live clock floors: 0:01 only once a whole second is really on tape. (runningTime rounds and
    // never reads 0:00, which is right for a card's length and wrong for a clock that is running.)
    const whole = Math.floor(take.samples / take.context.sampleRate);
    $('rec-time').textContent = whole <= 0 ? '0:00' : runningTime(whole);
    $('rec-level').style.width = `${Math.min(100, Math.round(take.level * 100))}%`;
  };
  source.connect(tap);
  // The tap runs only while wired through to an output; its own output stays silent, so nothing echoes.
  tap.connect(context.destination);
  // The input dying mid-take — unplugged, or taken by the system — ends the take and keeps what it has.
  for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => void stopRecording());
  document.addEventListener('keydown', onEscape, true);
  $('rec-time').textContent = '0:00';
  $('rec-level').style.width = '0%';
  paint();
}

async function stopRecording(): Promise<void> {
  if (!take || take.closing) return;
  take.closing = true;
  const done = take;
  document.removeEventListener('keydown', onEscape, true);
  done.tap.onaudioprocess = null;
  done.source.disconnect();
  done.tap.disconnect();
  for (const track of done.stream.getTracks()) track.stop();
  void done.context.close().catch(() => undefined);
  take = null;
  paint();
  if (done.samples === 0) {
    sayInTray(t('recorder.nothing'));
    return;
  }
  const samples = new Float32Array(done.samples);
  let at = 0;
  for (const chunk of done.chunks) {
    samples.set(chunk, at);
    at += chunk.length;
  }
  const wav = encodeWav(samples, done.context.sampleRate || RECORDING_SAMPLE_RATE);
  try {
    const saved = await window.pulp.saveRecording(wav.buffer as ArrayBuffer);
    sayInTray(t('recorder.saved', { time: runningTime(done.samples / (done.context.sampleRate || RECORDING_SAMPLE_RATE)), folder: RECORDINGS_FOLDER_NAME }));
    if (saved.id) opener(saved.id);
  } catch (err) {
    sayInTray(t('recorder.save-failed', { reason: (err as Error).message }), true);
  }
}

/** The one behavior behind the button, File → Record Audio and its key. */
export function toggleRecording(): void {
  if (take) void stopRecording();
  else void startRecording();
}

/** The small menu beside the button: the inputs, the one remembered ticked, the default first. */
async function openInputMenu(): Promise<void> {
  const button = $('record-input');
  const [devices, chosen] = await Promise.all([navigator.mediaDevices.enumerateDevices(), window.pulp.getRecordingInput()]);
  const inputs = devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const labels = new Map(inputs.map((d, i) => [d.deviceId, d.label || t('recorder.input.unnamed', { number: i + 1 })]));
  const items: MenuItemSpec[] = [
    { command: 'record.input', label: t('recorder.input.default'), arg: '', type: 'radio', checked: chosen === null, enabled: true },
    ...inputs.map((d): MenuItemSpec => ({ command: 'record.input', label: labels.get(d.deviceId)!, arg: d.deviceId, type: 'radio', checked: chosen?.id === d.deviceId, enabled: true })),
  ];
  // Hung from the button's leading edge: its left, or its right in a mirrored window (milestone 70).
  const box = button.getBoundingClientRect();
  const rtl = isRtl(button);
  openContextMenu({
    x: rtl ? box.right : box.left,
    alignEnd: rtl,
    y: box.bottom + 2,
    items,
    run: (_command, arg) => {
      void window.pulp.setRecordingInput(arg ? { id: arg, label: labels.get(arg) ?? t('recorder.input.fallback') } : null);
    },
    focusBack: button,
  });
}

export function initRecorder(): void {
  $('record-audio').addEventListener('click', toggleRecording);
  $('rec-stop').addEventListener('click', () => void stopRecording());
  $('record-input').addEventListener('click', () => void openInputMenu());
  $('rec-open-settings').addEventListener('click', () => void window.pulp.openPrivacySettings('microphone'));
  $('rec-dismiss').addEventListener('click', dismissRefusal);
}
