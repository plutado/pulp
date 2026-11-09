/**
 * The shown item's favorite star, tags and themes — and, in the Info tab, the
 * whole property panel: a header card, then collapsible sections of key–value
 * rows (docs/ui-style.md).
 *
 * Mounted twice: the strip under the stage takes the quick actions alone, the
 * Info tab takes everything. Both render from the same state, so an edit in one
 * shows in the other at once. What each row *says* is in `src/core/item-info.ts`;
 * this file only turns it into elements.
 */

import { render } from 'preact';
import { computed, effect, signal } from '@preact/signals';
import { shownEntry } from '../core/app-state';
import { revealLabel, styleLabel, tagLabel, themeLabel } from '../core/display';
import {
  aboutRows,
  creditsRows,
  fileRows,
  formatRows,
  INFO_SECTIONS,
  pieceLabel,
  typeRow,
  usageRows,
  type InfoRow,
  type InfoSectionId,
} from '../core/item-info';
import type { LibraryEntry, MediaEntry, TemplateEntry } from '../core/library-types';
import { entryMoods, moodLabel, entryType, typeInfo } from '../core/taxonomy';
import { appState, selectedTemplate, slotNotes } from './store';
import { Icon, scopeIcon, TYPE_GROUP_ICONS, type IconName } from './icons';
import { Thumb } from './item-preview';
import { layersTopFirst, layerShown, psdLimitSummary, type PsdBlend } from '../core/psd';
import type { MessageId } from '../core/i18n';
import { hiddenFor, isPsdEntry, psdOutlineFor, psdOutlines, togglePsdLayer } from './psd-state';
import { openChromaKey, openStabilize } from './cleanup';
import { t } from './i18n';

const shown = computed(() => shownEntry(appState.value));

/** Which sections are open. Loaded from settings at start and written back as they are used. */
const openSections = signal<Record<string, boolean>>({});
/** Defaults: the facts people reach for first are open, the rest wait to be asked for. */
const OPEN_BY_DEFAULT = new Set<string>(['about', 'format', 'layers', 'categories', 'tags']);

function isOpen(id: InfoSectionId): boolean {
  return openSections.value[id] ?? OPEN_BY_DEFAULT.has(id);
}

function toggleSection(id: InfoSectionId): void {
  const next = { ...openSections.value, [id]: !isOpen(id) };
  openSections.value = next;
  void window.pulp.saveInfoSections(next);
}

/** Saved preset counts per template, for Usage; asked for once per template. */
const presetCounts = signal<ReadonlyMap<string, number>>(new Map());
const askedPresets = new Set<string>();

function presetCountFor(entry: LibraryEntry): number {
  if (entry.kind !== 'template') return 0;
  const id = entry.manifest.id;
  const known = presetCounts.value.get(id);
  if (known !== undefined) return known;
  if (!askedPresets.has(id)) {
    askedPresets.add(id);
    void window.pulp.listPresets(id).then((presets) => {
      presetCounts.value = new Map(presetCounts.value).set(id, Object.keys(presets).length);
    });
  }
  return 0;
}

/** A layer's blend mode as the layer list names it, lower case as Photoshop's menu reads in a sentence. */
const BLEND_NAMES: Record<PsdBlend, MessageId> = {
  'normal': 'info.layers.blend.normal',
  'multiply': 'info.layers.blend.multiply',
  'screen': 'info.layers.blend.screen',
  'overlay': 'info.layers.blend.overlay',
  'darken': 'info.layers.blend.darken',
  'lighten': 'info.layers.blend.lighten',
  'color-dodge': 'info.layers.blend.color-dodge',
  'color-burn': 'info.layers.blend.color-burn',
  'hard-light': 'info.layers.blend.hard-light',
  'soft-light': 'info.layers.blend.soft-light',
  'difference': 'info.layers.blend.difference',
  'exclusion': 'info.layers.blend.exclusion',
  'hue': 'info.layers.blend.hue',
  'saturation': 'info.layers.blend.saturation',
  'color': 'info.layers.blend.color',
  'luminosity': 'info.layers.blend.luminosity',
};

/** Element ids, for the instance the end-to-end test drives (the strip). */
interface Ids {
  favorite?: string;
  chips?: string;
  input?: string;
}

const BADGE_ICONS: Record<string, IconName> = { alpha: 'checkerboard', loop: 'repeat', duration: 'clock' };

function Rows({ rows }: { rows: InfoRow[] }) {
  if (rows.length === 0) return null;
  return (
    <dl class="facts">
      {rows.map((row) => (
        <div class="fact" key={row.label}>
          <dt>{row.label}</dt>
          <dd class={row.tone === 'warn' ? 'warn' : undefined} {...(row.tip ? { 'data-tip': row.tip } : {})}>
            {row.icon && <Icon name={BADGE_ICONS[row.icon]!} />}
            {row.badge ? <span class={`tag-chip license${row.tone === 'warn' ? ' warn' : ''}`}>{row.value}</span> : <span>{row.value}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The scenes flow says what it is doing here, per item; the key has a dialog of its own. Its words
 * are worked out when drawn, so they follow a change of language; a failure's reason is the main
 * process's own.
 */
const sceneStatus = signal<{ id: string; say: () => string; busy?: boolean; error?: boolean } | null>(null);

function Cleanup({ entry }: { entry: MediaEntry }) {
  const status = sceneStatus.value;
  const splitting = status?.id === entry.id && status.busy === true;
  const split = async () => {
    sceneStatus.value = { id: entry.id, say: () => t('info.cleanup.looking'), busy: true };
    const result = await window.pulp.splitScenes(entry.id);
    if (result.ok) {
      const values = { count: result.clips, folder: result.folder.split(/[\\/]/).pop() ?? '' };
      sceneStatus.value = { id: entry.id, say: () => t('info.cleanup.split-done', values) };
    } else {
      const message = result.message;
      sceneStatus.value = { id: entry.id, say: () => message, error: true };
    }
  };
  return (
    <div class="cleanup-actions">
      <p class="note">{t('info.cleanup.note')}</p>
      <div class="render-actions">
        <button type="button" id="cleanup-key" onClick={() => openChromaKey(entry.id)}>
          {t('info.cleanup.key')}
        </button>
        <button type="button" id="cleanup-split" disabled={splitting} onClick={() => void split()}>
          {t('info.cleanup.split')}
        </button>
        <button type="button" id="cleanup-stabilize" onClick={() => openStabilize(entry.id)}>
          {t('info.cleanup.stabilize')}
        </button>
      </div>
      {status?.id === entry.id && (
        <p id="cleanup-status" class={`note${status.error ? ' error' : ''}`} role="status">
          {status.say()}
        </p>
      )}
    </div>
  );
}

function Section({ id, label, children }: { id: InfoSectionId; label: string; children: preact.ComponentChildren }) {
  const open = isOpen(id);
  return (
    <section class="info-section" data-section={id}>
      <button type="button" class="section-heading" aria-expanded={open} onClick={() => toggleSection(id)}>
        <Icon name={open ? 'caret-down' : 'caret-right'} />
        <span class="label">{label}</span>
      </button>
      {open && <div class="section-body">{children}</div>}
    </section>
  );
}

/** A removable chip row that ends with its own add control, rather than a field of its own. */
function Chips({
  values,
  mine,
  label,
  empty,
  placeholder,
  onAdd,
  onRemove,
  ids,
}: {
  values: string[];
  mine: Set<string>;
  label: (v: string) => string;
  empty: string;
  placeholder: string;
  onAdd: (added: string[]) => void;
  onRemove: (value: string) => void;
  ids?: { chips?: string; input?: string };
}) {
  return (
    <div class="chip-row">
      {values.length === 0 && <span class="empty-note">{empty}</span>}
      <span id={ids?.chips} class="tag-chips">
        {values.map((value) => (
          <span key={value} class={mine.has(value) ? 'tag-chip user' : 'tag-chip folder'} data-tag={value} data-theme={value} title={mine.has(value) ? t('info.chip.yours') : t('info.chip.from-folder')}>
            {label(value)}
            {mine.has(value) && (
              <button type="button" aria-label={t('info.chip.remove', { label: label(value) })} onClick={() => onRemove(value)}>
                <Icon name="x" />
              </button>
            )}
          </span>
        ))}
      </span>
      <input
        id={ids?.input}
        type="text"
        class="tag-input"
        placeholder={placeholder}
        autocomplete="off"
        spellcheck={false}
        aria-label={placeholder}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const input = e.target as HTMLInputElement;
          const added = input.value.split(',').map((t) => t.trim()).filter(Boolean);
          if (added.length === 0) return;
          input.value = '';
          onAdd(added);
        }}
      />
    </div>
  );
}

function Favorite({ entry, id }: { entry: LibraryEntry; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      class="favorite"
      aria-pressed={entry.favorite === true ? 'true' : 'false'}
      aria-label={t('info.favorite.aria-label')}
      onClick={() => void window.pulp.setItemFavorite(entry.id, !entry.favorite)}
    >
      <Icon name={entry.favorite ? 'star-fill' : 'star'} />
    </button>
  );
}

/** Tags and themes, which the strip under the stage shows as well as the Info tab. */
function Tools({ entry, ids }: { entry: LibraryEntry; ids: Ids }) {
  const mine = new Set(entry.userTags ?? []);
  return (
    <>
      <Favorite entry={entry} {...(ids.favorite ? { id: ids.favorite } : {})} />
      <Chips
        values={entry.tags}
        mine={mine}
        label={tagLabel}
        empty={t('info.tags.empty')}
        placeholder={t('info.tags.placeholder')}
        onAdd={(added) => void window.pulp.setItemTags(entry.id, [...(entry.userTags ?? []), ...added])}
        onRemove={(tag) => void window.pulp.setItemTags(entry.id, (entry.userTags ?? []).filter((own) => own !== tag))}
        ids={ids}
      />
    </>
  );
}

/** The header: the item's picture, its name with the favorite star, and its type. */
function Header({ entry }: { entry: LibraryEntry }) {
  const type = entryType(entry);
  const group = type ? typeInfo(type)?.group : undefined;
  const row = typeRow(entry);
  return (
    <div class="info-header">
      <span class="info-poster">
        <Thumb entry={entry} scrubbable />
      </span>
      <div class="info-heading">
        <div class="name-row">
          <h2 id="info-name">{entry.kind === 'template' ? entry.manifest.name : entry.name}</h2>
          <Favorite entry={entry} />
        </div>
        {row && (
          <p class="info-type">
            <Icon name={group ? (TYPE_GROUP_ICONS[group] ?? 'shapes') : scopeIcon('untyped', undefined)} />
            <span>{row.value}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/** A description long enough to crowd the panel is clamped until it is asked for. */
function About({ entry }: { entry: LibraryEntry }) {
  const rows = aboutRows(entry);
  const more = signal(false);
  if (rows.length === 0) return <p class="empty-note">{t('info.about.empty')}</p>;
  const text = rows[0]!.value;
  const long = text.length > 180;
  return (
    <p class={`info-about${long && !more.value ? ' clamped' : ''}`}>
      {text}
      {long && (
        <button type="button" class="more" onClick={() => (more.value = !more.value)}>
          {more.value ? t('info.about.less') : t('info.about.more')}
        </button>
      )}
    </p>
  );
}

/** The rest of the pack an item belongs to, as thumbnails that select their piece. */
function Set_({ entry, onSelect }: { entry: TemplateEntry; onSelect: (e: LibraryEntry) => void }) {
  const pack = entry.pack;
  const siblings = (appState.value.index?.templates ?? []).filter((t) => t.pack?.slug === pack?.slug && t.id !== entry.id);
  return (
    <>
      <Rows rows={[{ label: t('info.set.pack'), value: pack?.name ?? '' }]} />
      {siblings.length === 0 ? (
        <p class="empty-note">{t('info.set.empty')}</p>
      ) : (
        <div class="set-pieces">
          {siblings.map((t) => (
            <button key={t.id} type="button" class="set-piece" data-id={t.id} onClick={() => onSelect(t)} data-tip={t.manifest.name}>
              <span class="thumb checker">{t.thumbnail ? <img src={t.thumbnail} alt="" /> : <Icon name="shapes" />}</span>
              <span class="label">{pieceLabel(t.manifest.name, pack?.name ?? '')}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function FileSection({ entry }: { entry: LibraryEntry }) {
  return (
    <>
      <Rows rows={fileRows(entry)} />
      <div class="file-actions">
        <button type="button" id="info-reveal" onClick={() => void window.pulp.revealItem(entry.id)}>
          {revealLabel(window.pulp.platform)}
        </button>
        <button type="button" id="info-copy-path" onClick={() => void window.pulp.copyItemPath(entry.id)}>
          {t('info.copy-path')}
        </button>
      </div>
    </>
  );
}

function Categories({ entry }: { entry: LibraryEntry }) {
  const myThemes = new Set(entry.userThemes ?? []);
  const styles = entry.kind === 'template' ? (entry.manifest.styles ?? []) : [];
  // How it feels (milestone 16's moods): from its folders and its file's own genre tag, said rather than edited.
  const moods = entryMoods(entry);
  const row = typeRow(entry);
  return (
    <>
      {row && <Rows rows={[row]} />}
      <p class="chip-label">{t('info.themes')}</p>
      <Chips
        values={entry.themes ?? []}
        mine={myThemes}
        label={themeLabel}
        empty={t('info.themes.empty')}
        placeholder={t('info.themes.placeholder')}
        onAdd={(added) => void window.pulp.setItemThemes(entry.id, [...(entry.userThemes ?? []), ...added])}
        onRemove={(theme) => void window.pulp.setItemThemes(entry.id, (entry.userThemes ?? []).filter((own) => own !== theme))}
        ids={{ chips: 'theme-chips', input: 'theme-input' }}
      />
      <p class="chip-label">{t('info.styles')}</p>
      {styles.length === 0 ? (
        <p class="empty-note">{t('info.styles.empty')}</p>
      ) : (
        <span class="tag-chips">
          {styles.map((style) => (
            <span key={style} class="tag-chip folder" data-style={style}>
              {styleLabel(style)}
            </span>
          ))}
        </span>
      )}
      {moods.length > 0 && (
        <>
          <p class="chip-label">{t('info.mood')}</p>
          <span class="tag-chips">
            {moods.map((mood) => (
              <span key={mood} class="tag-chip folder" data-mood={mood}>
                {moodLabel(mood)}
              </span>
            ))}
          </span>
        </>
      )}
    </>
  );
}

/**
 * A layered file's layers (milestone 33), top first as Photoshop lists them:
 * groups as groups, each with a box to show or hide it on the stage, its
 * opacity and blend where they are not plain, and what of it Pulp does not
 * reproduce. What is hidden here is what a picture placed from here starts with.
 */
function Layers({ entry }: { entry: LibraryEntry }) {
  void psdOutlines.value;
  const state = psdOutlineFor(entry.id);
  if (state.ok === 'pending') return <p class="empty-note">{t('info.layers.reading')}</p>;
  // The reason is the layered-file reader's own detail (src/core/psd.ts), in a frame of this window's.
  if (!state.ok) return <p class="empty-note warn">{t('info.layers.unreadable', { reason: state.message })}</p>;
  const { outline } = state;
  const hidden = new Set(hiddenFor(entry.id, outline));
  const summary = psdLimitSummary(outline);
  return (
    <>
      {outline.layers.length === 0 ? (
        <p class="empty-note">{t('info.layers.none')}</p>
      ) : (
        <ul class="psd-layers" data-count={outline.layers.length}>
          {layersTopFirst(outline.layers).map((layer) => {
            const own = hidden.has(layer.id);
            const shown = layerShown(outline.layers, layer.id, hidden);
            const facts = [
              layer.opacity < 1 ? `${Math.round(layer.opacity * 100)}%` : '',
              layer.blend !== 'normal' ? t(BLEND_NAMES[layer.blend]) : '',
            ].filter(Boolean).join(' · ');
            return (
              <li key={layer.id} class={`psd-layer${layer.kind === 'group' ? ' group' : ''}${shown ? '' : ' hidden'}`} style={{ paddingLeft: `${layer.depth * 16}px` }} data-layer={layer.id}>
                <label>
                  <input type="checkbox" checked={!own} disabled={layer.hasPixels === false} onChange={() => togglePsdLayer(entry.id, outline, layer.id)} aria-label={layer.name ? t('info.layers.show', { name: layer.name }) : t('info.layers.show-unnamed')} />
                  {layer.kind === 'group' && <Icon name="folder" />}
                  <span class="name">{layer.name || (layer.kind === 'group' ? t('info.layers.unnamed-group') : t('info.layers.unnamed-layer'))}</span>
                  {facts && <span class="facts">{facts}</span>}
                </label>
                {layer.limits.length > 0 && <span class="limits" data-tip={layer.limits.join('; ')}>{layer.limits.length === 1 ? layer.limits[0] : t('info.layers.limits', { count: layer.limits.length })}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {summary && <p class="note psd-limits">{summary}</p>}
    </>
  );
}

function Panel({ onSelect }: { onSelect: (e: LibraryEntry) => void }) {
  const entry = shown.value;
  if (!entry) return null;
  const sections: Partial<Record<InfoSectionId, preact.ComponentChildren>> = {
    about: <About entry={entry} />,
    format: <Rows rows={formatRows(entry)} />,
    ...(isPsdEntry(entry) ? { layers: <Layers entry={entry} /> } : {}),
    categories: <Categories entry={entry} />,
    tags: (
      <Chips
        values={entry.tags}
        mine={new Set(entry.userTags ?? [])}
        label={tagLabel}
        empty={t('info.tags.empty')}
        placeholder={t('info.tags.placeholder')}
        onAdd={(added) => void window.pulp.setItemTags(entry.id, [...(entry.userTags ?? []), ...added])}
        onRemove={(tag) => void window.pulp.setItemTags(entry.id, (entry.userTags ?? []).filter((own) => own !== tag))}
      />
    ),
    ...(entry.kind === 'template' && entry.pack ? { set: <Set_ entry={entry} onSelect={onSelect} /> } : {}),
    file: <FileSection entry={entry} />,
    // Clip clean-up (milestone 52): footage made ready to sit in a frame. Only a clip that is a
    // file has streams to key or split, so a sequence and a sound are not offered it.
    ...(entry.kind === 'media' && entry.mediaKind === 'video' && !entry.sequence && !entry.offline ? { cleanup: <Cleanup entry={entry} /> } : {}),
    // Image slots whose chosen image has gone or is offline, as the Parameters tab found them.
    ...(entry.kind === 'template' && slotNotes.value.length > 0 && selectedTemplate.value?.manifest.id === entry.manifest.id
      ? { images: <Rows rows={slotNotes.value.map((n) => ({ label: n.label, value: n.note, tone: 'warn' as const }))} /> }
      : {}),
    ...(entry.kind === 'template' ? { credits: <Rows rows={creditsRows(entry)} /> } : {}),
    usage: <Rows rows={usageRows(entry, presetCountFor(entry))} />,
  };
  return (
    <>
      <Header entry={entry} />
      {INFO_SECTIONS.filter((s) => sections[s.id] !== undefined).map((s) => (
        <Section key={s.id} id={s.id} label={s.label}>
          {sections[s.id]}
        </Section>
      ))}
    </>
  );
}

function ItemInfo({ ids, withDetails, onSelect }: { ids: Ids; withDetails: boolean; onSelect: (e: LibraryEntry) => void }) {
  const entry = shown.value;
  if (!entry) return null;
  // The strip's container is itself the .item-tools row; the Info tab brings the panel.
  if (!withDetails) return <Tools entry={entry} ids={ids} />;
  return <Panel onSelect={onSelect} />;
}

/** The container keeps its own hidden attribute, which the end-to-end test reads. */
export function mountItemInfo(container: HTMLElement, ids: Ids, withDetails: boolean, onSelect: (e: LibraryEntry) => void = () => undefined): void {
  if (withDetails) {
    void window.pulp.getInfoSections().then((saved) => {
      openSections.value = saved;
    });
  }
  render(<ItemInfo ids={ids} withDetails={withDetails} onSelect={onSelect} />, container);
  effect(() => {
    container.hidden = shown.value === null;
  });
}
