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
 * which model it would fetch, how big it is and under what license, and
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
import { madeForVertical } from '../core/vertical-layout';
import { layerEditor } from './layer-edit';
import { bindAttr, bindText, locale, t, whenLocaleChanges } from './i18n';
import type { MessageId, MessageValues } from '../core/i18n';
import { appState } from './store';

/** Open or folded, kept across rebuilds of the form as the parameter cards' own state is. */
let cardOpen = true;

/** A source's name, as the message it is and the values that fill it, so its option follows a change of language. */
interface SourceLabel {
  id: MessageId;
  values?: MessageValues;
}

/** What the dialog is working with while it is open: the sources it found, and how it is going. */
let sources: { id: string; label: SourceLabel; segments: SpeechSegment[] }[] = [];

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
function speechSources(): { id: string; label: SourceLabel; segments: SpeechSegment[] }[] {
  const found: { id: string; label: SourceLabel; segments: SpeechSegment[] }[] = [];
  const track = layerEditor()?.track() ?? null;
  if (track && track.cuts.length > 0) {
    const segments = trackAudio(track).map(({ value, speed }): SpeechSegment => ({
      kind: 'clip',
      id: value.id!,
      from: value.inPoint,
      to: value.outPoint,
      at: value.delay,
      // A cut at a speed (milestone 56) is heard at that speed, so its words must be too.
      ...(speed !== undefined && speed !== 1 ? { speed } : {}),
    }));
    if (segments.length > 0) found.push({ id: 'track', label: { id: 'captions.source.track', values: { count: track.cuts.length } }, segments });
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
        label: { id: 'captions.source.sound', values: { label: layer.label } },
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
      label: { id: 'captions.source.clip', values: { label: layer.label } },
      segments: [{ kind: 'clip', id: clip.id!, from: window.first / fps, to: (window.last + 1) / fps, at: clip.delay }],
    });
  }
  if (found.length > 1) {
    found.unshift({ id: 'all', label: { id: 'captions.source.all' }, segments: found.flatMap((s) => s.segments) });
  }
  return found;
}

// ---------------------------------------------------------------- the card

/** The caption styles the library holds: templates whose manifest says they draw captions. */
function captionStyles(): { id: string; name: string; vertical: boolean }[] {
  return (appState.value.index?.templates ?? [])
    .filter((t) => t.manifest.captions === true)
    .map((t) => ({ id: t.id, name: t.manifest.name, vertical: madeForVertical(t.manifest) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The style a fresh set of captions is drawn with: the first by name of those drawn for every shape.
 * Not one made for vertical (milestone 65), which is placed for a tall frame alone: a wide project
 * must not start on it just because its name sorts first.
 */
function defaultCaptionStyle(): string | null {
  const styles = captionStyles();
  return (styles.find((s) => !s.vertical) ?? styles[0])?.id ?? null;
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
  bindAttr(at, 'title', 'captions.line.at.title', { start: captionTime(lineStart(line)), end: captionTime(lineEnd(line)) });
  row.append(at);

  const text = document.createElement('input');
  text.type = 'text';
  text.className = 'caption-text';
  text.value = lineText(line);
  bindAttr(text, 'aria-label', 'captions.line.text.aria-label', { time: captionTime(lineStart(line)) });
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
  bindText(split, 'captions.line.split');
  bindAttr(split, 'title', 'captions.line.split.title');
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
  bindText(merge, 'captions.line.merge');
  bindAttr(merge, 'title', 'captions.line.merge.title');
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
  bindText(name, 'captions.card.name');
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
  bindAttr(style, 'aria-label', 'captions.card.style.aria-label');
  const none = document.createElement('option');
  none.value = '';
  bindText(none, 'captions.card.style.none');
  style.append(none);
  for (const option of styles) {
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
  bindText(label, 'captions.card.style');
  field.append(label, style);
  body.append(field);

  const actions = document.createElement('div');
  actions.className = 'caption-actions';
  const transcribe = document.createElement('button');
  transcribe.type = 'button';
  bindText(transcribe, captions ? 'captions.card.transcribe-again' : 'captions.card.transcribe');
  bindAttr(transcribe, 'title', 'captions.card.transcribe.title');
  transcribe.addEventListener('click', () => openCaptionsDialog());
  actions.append(transcribe);
  if (captions) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'ghost';
    bindText(clear, 'captions.card.remove');
    bindAttr(clear, 'title', 'captions.card.remove.title');
    clear.addEventListener('click', () => setCaptions(null));
    actions.append(clear);
  }
  const count = document.createElement('span');
  count.className = 'note';
  if (captions) bindText(count, 'captions.card.count', { count: captions.lines.length, words: captionsWordCount(captions) });
  else bindText(count, 'captions.card.empty');
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

/** The dialog's status line in words already worked out — the main process's, or none — clearing any message stamped on it. */
function say(text: string): void {
  const status = $('captions-status');
  if (!status) return;
  delete status.dataset.i18n;
  delete status.dataset.i18nValues;
  status.textContent = text;
}

/** The dialog's status line from the catalog: a change of language rewrites it while it shows. */
function sayMessage(id: MessageId, values?: MessageValues): void {
  const status = $('captions-status');
  if (status) bindText(status, id, values);
}

/** What the model line says: which model, how big, under what license, and whether it is here. */
async function showStatus(): Promise<void> {
  const line = $('captions-model');
  const fetchButton = $<HTMLButtonElement>('captions-fetch');
  const run = $<HTMLButtonElement>('captions-run');
  if (!line || !fetchButton || !run) return;
  const status = await window.pulp.speechStatus({});
  const { model } = status;
  // The model's name and note come translated from the main process; the dialog asks again when the language changes.
  const said = { model: model.label, size: modelSizeText(model.bytes), licenseName: model.license, note: model.note };
  line.textContent = t(model.installed ? 'captions.model.installed' : 'captions.model.missing', said);
  fetchButton.hidden = model.installed;
  bindText(fetchButton, 'captions.fetch.size', { size: modelSizeText(model.bytes) });
  run.disabled = !model.installed || !status.runner.ok || !status.ffmpeg || sources.length === 0;
  if (!status.ffmpeg) sayMessage('captions.status.no-ffmpeg');
  else if (!status.runner.ok) say(status.runner.message ?? '');
  else if (sources.length === 0) sayMessage('captions.status.no-sound');
  else if (!model.installed) sayMessage('captions.status.not-fetched');
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
    bindText(option, source.label.id, source.label.values);
    select.append(option);
  }
  select.disabled = sources.length <= 1;
  void showStatus();
  dialog.showModal();
}

/** The language menu: Detect first, then the model's languages by the names the interface gives them now. */
function fillLanguages(select: HTMLSelectElement): void {
  const option = (code: string, name: string): HTMLOptionElement => {
    const el = document.createElement('option');
    el.value = code;
    el.textContent = name;
    return el;
  };
  const named = SPEECH_LANGUAGES.map((l) => ({ code: l.code, name: l.name })).sort((a, b) => a.name.localeCompare(b.name, locale.value));
  select.replaceChildren(option(SPEECH_LANGUAGE_AUTO, t('captions.language.detect')), ...named.map((l) => option(l.code, l.name)));
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
  fillLanguages(language);
  language.value = SPEECH_LANGUAGE_AUTO;
  // The languages are named, and so sorted, in the interface's language: a change lists them again,
  // the choice kept. The model line names the model in it too, so an open dialog asks for it again.
  whenLocaleChanges(() => {
    const chosen = language.value;
    fillLanguages(language);
    language.value = chosen;
    if (dialog.open) void showStatus();
  });

  fetchButton.addEventListener('click', () => {
    fetchButton.disabled = true;
    sayMessage('captions.status.fetching');
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
    sayMessage('captions.status.listening');
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
      sayMessage('captions.status.done', { count: lines, words: result.words.length });
      dialog.close();
    });
  });

  window.pulp.onSpeechProgress(({ note, fraction }) => {
    if (!dialog.open) return;
    if (fraction === null) say(note);
    else say(t('captions.status.progress', { note, percent: Math.round(fraction * 100) }));
  });
}
