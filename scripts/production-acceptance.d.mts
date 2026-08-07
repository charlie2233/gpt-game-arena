export const PRODUCTION_ACCEPTANCE_FORMAT_VERSION: 1;
export const CURRENT_WIDGET_RESOURCE_URI: "ui://gpt-game-arena/v21/widget.html";
export const CURRENT_WIDGET_RELEASE_MARKER: "turnplay-v21-20260807-3f4c9d2";
export const CURRENT_WIDGET_BUNDLE_SHA256: "298e927861ff9c48b77560c5b6acc3e581eca9f1bfa933c22165dd518746a781";
export const EXPECTED_TOOL_NAMES: string[];

export class ProductionAcceptanceError extends Error {}

export type ProductionAcceptanceOptions = {
  phase: "seed" | "resume";
  baseUrl: string;
  stateFile: string;
  challengeTokenFile?: string;
  localExpectedWidgetDigest?: string;
  requireChallenge?: boolean;
  allowHttpLocalhost?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type ProductionAcceptanceResult = {
  phase: "seed" | "resume";
  production: boolean;
  origin: string;
  widgetResourceUri: string;
  stateVersion: number;
  resetEpoch: number;
  challengePresent: boolean;
  challengeExact: boolean;
  restartProven: boolean;
  snapshotDigest: string;
  stateFile: string;
};

export function normalizeProductionOrigin(value: string, options?: { allowHttpLocalhost?: boolean }): string;
export function parseProductionAcceptanceArgs(argv: string[], cwd?: string): {
  phase: "seed" | "resume" | undefined;
  baseUrl: string | undefined;
  stateFile: string;
  challengeTokenFile: string | undefined;
  requireChallenge: boolean;
  allowHttpLocalhost: boolean;
  help: boolean;
};
export function productionSnapshotDigest(snapshot: Record<string, unknown>): string;
export function readChallengeTokenFile(path: string): Promise<string>;
export function validateConfirmationReceipt(text: string, prefix: string, expected: Record<string, unknown>): Record<string, unknown>;
export function validateWidgetResource(result: unknown, origin: string, expectedBundleDigest?: string): Record<string, unknown>;
export function validateProductionReceipt(value: unknown): Record<string, unknown>;
export function runProductionAcceptance(options: ProductionAcceptanceOptions): Promise<ProductionAcceptanceResult>;
