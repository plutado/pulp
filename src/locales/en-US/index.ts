/**
 * The interface's words in US English (milestone 59): the source catalog, one
 * file per part of the interface, put together here.
 * Every message id the interface reads is here, and every other catalog
 * (src/locales/en-GB.ts and those after it) holds only what it says
 * differently, falling back to these for the rest.
 *
 * An id names **where** a string sits, not what it says, so it stays put when
 * the words change: `ui.<element id>` for an element of the window's markup
 * (src/renderer/index.html), `ui.<container>.<slug>` for one with no id of
 * its own, a `.<attribute>` suffix for its tooltip or accessible name, and
 * `menu.<command>` for the application menu (src/core/menu.ts). A value may
 * hold `{name}` placeholders, and plural forms as `{ one, other }`.
 * docs/translating.md says how to add a language.
 */

import { markup } from './markup';
import { menu } from './menu';
import { windows } from './windows';
import { settings } from './settings';
import { inspector } from './inspector';
import { library } from './library';
import { stage } from './stage';
import { app } from './app';
import { mainProcess } from './main-process';

export const enUS = { ...markup, ...menu, ...windows, ...settings, ...inspector, ...library, ...stage, ...app, ...mainProcess } as const satisfies Record<string, string | ({ other: string } & Partial<Record<'zero' | 'one' | 'two' | 'few' | 'many', string>>)>;

export type MessageId = keyof typeof enUS;
