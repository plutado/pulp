import type { PulpApi } from '../shared/api';

declare global {
  interface Window {
    pulp: PulpApi;
  }
}

export {};
