/**
 * The captions layer in the Parameters tab (milestone 50): the card that
 * holds a project's caption lines — the style that draws them, the words,
 * and the ways a line is changed — and the dialog that makes them from the
 * speech in the project.
 *
 * The lines are the project's, so they ride with the parameters under
 * `@captions` and every change goes through the layer editor
 * (./layer-edit.ts), exactly as a track edit does: one undo step each,
 * redrawn through the one pipeline. The arithmetic is src/core/captions.ts's
 * — what a line says, what splitting at a caret means, which word is being
 * spoken — and nothing here keeps a second answer of its own.
 *
 * Transcription happens in the main process on this machine. The dialog says
 * which model it would fetch, how big it is and under what licence, and
 * fetches nothing until the person presses the button (ADR 0021).
 */

import {
  captionsFromWords, captionsWordCount, lineEnd, lineStart, lineText, withCaptionStyle, withLinesMerged,
  withLineSplit, withLineText, type CaptionsValue,
} from '../core/captions';
import { clipAudible, clipWindow, DEFAULT_CLIP_SPEED, type ClipValue } from '../core/video-layer';
import { soundAudible, soundWindow, type SoundValue } from '../core/sound-layer';
import { trackAudio } from '../core/cut-track';
import { DEFAULT_SPEECH_MODEL, modelSizeText, SPEECH_LANGUAGE_AUTO, SPEECH_LANGUAGES, type SpeechSegment } from '../core/speech';
import type { Layer } from '../core/layers';
import { layerEditor } from './layer-edit';
import { appState } from './store';

/** Open or folded, kept across rebuilds of the form as the parameter cards' own state is. */
let cardOpen = true;

/** What the dialog is working with while it is open: the sources it found, and how it is going. */
let sources: { id: string; label: string; segments: SpeechSegment[] }[] = [];

const media = (id: string) => appState.value.index?.media.find((m) => m.id === id);

/** Seconds as a caption line reads them: 1:04.2, the form a person matches against the playhead. */
function captionTime(seconds: number): string {
  const whole = Math.max(0, seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole - minutes * 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

// ---------------------------------------------------------------- what has sound to listen to

/** Every layer of the project, with the block it is in, for the sources below. */
function projectLayers(): { block: string; layer: Layer }[] {
  const editor = layerEditor();
  if (!editor) return [];
  return editor.blocks().flatMap((block) => (editor.stack(block.id) ?? []).map((layer) => ({ block: block.id, layer })));
}

/**
 * What there is to listen to in this project, each as the stretches of sound
 * it is: the cut track's mix (every cut where it is heard), an audio layer,
 * and a video layer whose clip carries its own sound. A clip playing at other
 * than its recorded speed is left out — the words would land where the sound
 * was taken from, not where it is heard — and so is anything muted or hidden,
 * which is not in the project's sound at all.
 */
function speechSources(): { id: string; label: string; segments: SpeechSegment[] }[] {
  const found: { id: string; label: string; segments: SpeechSegment[] }[] = [];
  const track = layerEditor()?.track() ?? null;
  if (track && track.cuts.length > 0) {
    const segments = trackAudio(track).map(({ value }): SpeechSegment => ({
      kind: 'clip',
      id: value.id!,
      from: value.inPoint,
      to: value.outPoint,
      at: value.delay,
    }));
    if (segments.length > 0) found.push({ id: 'track', label: `The cut track (${track.cuts.length} ${track.cuts.length === 1 ? 'shot' : 'shots'})`, segments });
  }
  for (const { block, layer } of projectLayers()) {
    if (layer.type === 'audio') {
      const sound = (layer as { sound?: SoundValue | null }).sound ?? null;
      if (!soundAudible(sound)) continue;
      const duration = media(sound.id!)?.meta?.duration ?? 0;
      const window = soundWindow(sound, { duration });
      if (window.seconds <= 0) continue;
      found.push({
        id: `${block}.${layer.id}`,
        label: `${layer.label} (sound)`,
        segments: [{ kind: 'sound', id: sound.id!, from: window.from, to: window.to, at: sound.delay }],
      });
      continue;
    }
    if (layer.type !== 'video') continue;
    const clip = (layer as { clip?: ClipValue | null }).clip ?? null;
    if (!clipAudible(clip) || clip.speed !== DEFAULT_CLIP_SPEED) continue;
    const meta = media(clip.id!)?.meta;
    const fps = meta?.fps ?? 0;
    const frames = fps > 0 ? Math.round((meta?.duration ?? 0) * fps) : 0;
    if (!fps || !frames) continue;
    const window = clipWindow(clip, { fps, frames });
    if (window.frames <= 0) continue;
    found.push({
      id: `${block}.${layer.id}`,
      label: `${layer.label} (clip)`,
      segments: [{ kind: 'clip', id: clip.id!, from: window.first / fps, to: (window.last + 1) / fps, at: clip.delay }],
    });
  }
  if (found.length > 1) {
    found.unshift({ id: 'all', label: 'Everything with sound', segments: found.flatMap((s) => s.segments) });
  }
  return found;
}

// ---------------------------------------------------------------- the card

/** The caption styles the library holds: templates whose manifest says they draw captions. */
function captionStyles(): { id: string; name: string }[] {
  return (appState.value.index?.templates ?? [])
    .filter((t) => t.manifest.captions === true)
    .map((t) => ({ id: t.id, name: t.manifest.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The style a fresh set of captions is drawn with: the first bundled one, by name. */
function defaultCaptionStyle(): string | null {
  return captionStyles()[0]?.id ?? null;
}

function setCaptions(next: CaptionsValue | null): void {
  layerEditor()?.setCaptions(next && next.lines.length > 0 ? next : null, true);
}

/**
 * The captions as they stand, rather than as they stood when the card was
 * built: a field committing on its way out rebuilds the card, so a button
 * pressed in the same breath must act on what that edit left behind.
 */
function now(): CaptionsValue | null {
  return layerEditor()?.captions() ?? null;
}

/**
 * One line: when it is said, the words to change, and the two edits that
 * change how the lines are cut up — split at the caret, and join with the
 * line below. The words commit when the field is left or Enter is pressed, so
 * typing is not an undo step per keystroke.
 */
function lineRow(value: CaptionsValue, index: number): HTMLElement {
  const line = value.lines[index]!;
  const row = document.createElement('div');
  row.className = 'caption-line';
  row.dataset.line = String(index);

  const at = document.createElement('span');
  at.className = 'note caption-at';
  at.textContent = captionTime(lineStart(line));
  at.title = `${captionTime(lineStart(line))} to ${captionTime(lineEnd(line))}`;
  row.append(at);

  const text = document.createElement('input');
  text.type = 'text';
  text.className = 'caption-text';
  text.value = lineText(line);
  text.setAttribute('aria-label', `Caption at ${captionTime(lineStart(line))}`);
  const commit = (): void => {
    const current = now();
    if (!current || text.value.trim() === lineText(line)) return;
    setCaptions(withLineText(current, index, text.value));
  };
  text.addEventListener('change', commit);
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  });
  row.append(text);

  const split = document.createElement('button');
  split.type = 'button';
  split.className = 'ghost';
  split.textContent = 'Split';
  split.title = 'Break this line in two at the caret, both halves keeping their timings';
  split.addEventListener('click', () => {
    const current = now();
    if (!current) return;
    const next = withLineSplit(current, index, text.selectionStart ?? Math.floor(text.value.length / 2));
    if (next !== current) setCaptions(next);
  });
  row.append(split);

  const merge = document.createElement('button');
  merge.type = 'button';
  merge.className = 'ghost';
  merge.textContent = 'Merge';
  merge.title = 'Join this line with the one below it';
  merge.disabled = index >= value.lines.length - 1;
  merge.addEventListener('click', () => {
    const current = now();
    if (current) setCaptions(withLinesMerged(current, index));
  });
  row.append(merge);
  return row;
}

/**
 * The Captions card: what was said, in the style that draws it. It is in the
 * Parameters tab because the captions are part of the project, beside the
 * layers and the length, and it is the last card for the same reason the
 * length is — it belongs to the whole graphic rather than to one part of it.
 */
export function captionsCard(captions: CaptionsValue | null): HTMLElement {
  const section = document.createElement('section');
  section.className = 'param-card captions-card';
  section.dataset.card = '@captions';
  const head = document.createElement('div');
  head.className = 'card-head';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'card-toggle';
  toggle.setAttribute('aria-expanded', String(cardOpen));
  const name = document.createElement('span');
  name.className = 'layer-label';
  name.textContent = 'Captions';
  toggle.append(name);
  head.append(toggle);
  section.append(head);

  const body = document.createElement('div');
  body.className = 'card-body';
  body.hidden = !cardOpen;
  toggle.addEventListener('click', () => {
    cardOpen = !cardOpen;
    body.hidden = !cardOpen;
    toggle.setAttribute('aria-expanded', String(cardOpen));
  });
  section.append(body);

  const styles = captionStyles();
  const style = document.createElement('select');
  style.setAttribute('aria-label', 'Caption style');
  for (const option of [{ id: '', name: 'None (not drawn)' }, ...styles]) {
    const el = document.createElement('option');
    el.value = option.id;
    el.textContent = option.name;
    style.append(el);
  }
  style.value = captions?.style ?? '';
  style.disabled = !captions;
  style.addEventListener('change', () => {
    const current = now();
    if (current) setCaptions(withCaptionStyle(current, style.value || null));
  });
  const field = document.createElement('label');
  field.className = 'type-field wide';
  const label = document.createElement('span');
  label.textContent = 'Style';
  field.append(label, style);
  body.append(field);

  const actions = document.createElement('div');
  actions.className = 'caption-actions';
  const transcribe = document.createElement('button');
  transcribe.type = 'button';
  transcribe.textContent = captions ? 'Transcribe again…' : 'Transcribe…';
  transcribe.title = 'Listen to the project\'s sound on this machine and write the captions from it';
  transcribe.addEventListener('click', () => openCaptionsDialog());
  actions.append(transcribe);
  if (captions) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'ghost';
    clear.textContent = 'Remove';
    clear.title = 'Take the captions off this project';
    clear.addEventListener('click', () => setCaptions(null));
    actions.append(clear);
  }
  const count = document.createElement('span');
  count.className = 'note';
  count.textContent = captions
    ? `${captions.lines.length} ${captions.lines.length === 1 ? 'line' : 'lines'}, ${captionsWordCount(captions)} words`
    : 'None yet. Transcription runs on this machine; nothing is sent anywhere.';
  actions.append(count);
  body.append(actions);

  if (captions) {
    const lines = document.createElement('div');
    lines.className = 'caption-lines';
    for (let i = 0; i < captions.lines.length; i++) lines.append(lineRow(captions, i));
    body.append(lines);
  }
  return section;
}

// ---------------------------------------------------------------- the dialog

const $ = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

function say(text: string): void {
  const status = $('captions-status');
  if (status) status.textContent = text;
}

/** What the model line says: which model, how big, under what licence, and whether it is here. */
async function showStatus(): Promise<void> {
  const line = $('captions-model');
  const fetchButton = $<HTMLButtonElement>('captions-fetch');
  const run = $<HTMLButtonElement>('captions-run');
  if (!line || !fetchButton || !run) return;
  const status = await window.pulp.speechStatus({});
  const { model } = status;
  line.textContent = `${model.label} · ${modelSizeText(model.bytes)} · ${model.license} — ${model.installed ? 'on this machine' : 'not fetched yet'}. ${model.note}`;
  fetchButton.hidden = model.installed;
  fetchButton.textContent = `Get the model (${modelSizeText(model.bytes)})`;
  run.disabled = !model.installed || !status.runner.ok || !status.ffmpeg || sources.length === 0;
  if (!status.ffmpeg) say('ffmpeg is needed to read the project\'s sound; install it and restart Pulp.');
  else if (!status.runner.ok) say(status.runner.message ?? '');
  else if (sources.length === 0) say('Nothing in this project has sound yet.');
  else if (!model.installed) say('The model is fetched once, from its publisher, and kept beside your settings. Nothing else ever leaves this machine.');
  else say('');
}

function openCaptionsDialog(): void {
  const dialog = $<HTMLDialogElement>('captions-dialog');
  const select = $<HTMLSelectElement>('captions-source');
  if (!dialog || !select) return;
  sources = speechSources();
  select.replaceChildren();
  for (const source of sources) {
    const option = document.createElement('option');
    option.value = source.id;
    option.textContent = source.label;
    select.append(option);
  }
  select.disabled = sources.length <= 1;
  void showStatus();
  dialog.showModal();
}

/** Wire the dialog once, at startup: the fetch, the run, and the progress the main process sends. */
export function mountCaptions(): void {
  const dialog = $<HTMLDialogElement>('captions-dialog');
  if (!dialog) return;
  const fetchButton = $<HTMLButtonElement>('captions-fetch')!;
  const run = $<HTMLButtonElement>('captions-run')!;
  const select = $<HTMLSelectElement>('captions-source')!;
  // The model's languages (milestone 50), with "Detect" first: whisper decides unless told. The
  // choice is kept for the session, since a project is rarely in two languages.
  const language = $<HTMLSelectElement>('captions-language')!;
  for (const option of [{ code: SPEECH_LANGUAGE_AUTO, name: 'Detect the language' }, ...SPEECH_LANGUAGES]) {
    const el = document.createElement('option');
    el.value = option.code;
    el.textContent = option.name;
    language.append(el);
  }
  language.value = SPEECH_LANGUAGE_AUTO;

  fetchButton.addEventListener('click', () => {
    fetchButton.disabled = true;
    say('Fetching the model…');
    void window.pulp.fetchSpeechModel({ model: DEFAULT_SPEECH_MODEL }).then(async (result) => {
      fetchButton.disabled = false;
      if (!result.ok) say(result.message);
      await showStatus();
    });
  });

  run.addEventListener('click', () => {
    const source = sources.find((s) => s.id === select.value) ?? sources[0];
    if (!source) return;
    run.disabled = true;
    say('Listening…');
    void window.pulp.transcribe({ segments: source.segments, language: language.value }).then((result) => {
      run.disabled = false;
      if (!result.ok) {
        say(result.message);
        return;
      }
      const editor = layerEditor();
      if (!editor) return;
      // The lines are made from the words here rather than in the main process: how speech is
      // broken into lines is the captions model's own rule (src/core/captions.ts). A style
      // already chosen stays chosen; a first transcription takes the first bundled style.
      const style = editor.captions()?.style ?? defaultCaptionStyle();
      const captions = captionsFromWords(result.words, style);
      setCaptions(captions);
      const lines = captions.lines.length;
      say(`${result.words.length} words in ${lines} ${lines === 1 ? 'line' : 'lines'}.`);
      dialog.close();
    });
  });

  window.pulp.onSpeechProgress(({ note, fraction }) => {
    if (!dialog.open) return;
    say(fraction === null ? note : `${note} ${Math.round(fraction * 100)}%`);
  });
}
