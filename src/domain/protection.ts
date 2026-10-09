export interface DataDiagnostics {
  version: string; schemaVersion: number; databaseStatus: 'OK'; databasePath: string;
  userDataPath: string; architecture: string; platform: string; signing: 'SIGNED'|'UNSIGNED';
  lastBackup: {createdAt:string; path:string}|null;
  missingPrices: number; missingCosts: number; missingStockConfiguration: number;
}
export interface DataActionResult { ok: boolean; cancelled?: boolean; message: string; }
