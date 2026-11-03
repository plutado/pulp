/** Types for the panel packaging module (plain Node ESM), for the tests that import it. */

export interface PanelPackageEntry {
  name: string;
  data: Buffer;
}

export const PANEL_EXTENSION_ID: string;
export const PANEL_HOSTS: Record<'premiere' | 'resolve', { dir: string; artifact: (version: string) => string; zipRoot: string }>;
export function panelPackageEntries(root: string, host: 'premiere' | 'resolve'): PanelPackageEntry[];
export function crc32(buf: Uint8Array): number;
export function writeZip(entries: readonly PanelPackageEntry[]): Buffer;
export function panelVersion(root: string): string;
export function panelPackage(root: string, host: 'premiere' | 'resolve', version?: string): { name: string; entries: PanelPackageEntry[]; zip: Buffer };
export function isFile(path: string): boolean;
