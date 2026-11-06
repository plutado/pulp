/**
 * What the folder picker for Add sample media says (milestone 66): a button that names the act it
 * performs, and a message saying what will happen there — a folder of its own, how much goes in it,
 * how long it takes, and that it can go again. One text for every platform: macOS shows a picker's
 * message and not its title, Windows and Linux the title and not the message, so it is both.
 *
 * In the interface's language (milestone 59); the folder's own name is the one written on disk.
 */

import { tr } from './i18n';
import { SAMPLE_MEDIA, SAMPLE_MEDIA_FOLDER_NAME } from './sample-media';

export function sampleFolderPicker(count: number = SAMPLE_MEDIA.length): { title: string; message: string; buttonLabel: string } {
  const about = Math.max(100, Math.round(count / 100) * 100);
  const text = tr('dialog.sample-media.folder', { folder: SAMPLE_MEDIA_FOLDER_NAME, about });
  return { title: text, message: text, buttonLabel: tr('dialog.sample-media.choose') };
}
