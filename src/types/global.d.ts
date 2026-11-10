import type { FoxApi } from './api';
declare global {
  interface Window {
    fox: FoxApi;
  }
}
