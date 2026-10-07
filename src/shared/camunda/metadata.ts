// Camunda Desktop Modeler metadata written into new BPMN and DMN files.
import type { ExecutionPlatform } from '../protocol';

/** Execution platform versions written into new diagrams (Camunda Desktop Modeler convention). */
export const DEFAULT_PLATFORM_VERSION: Record<ExecutionPlatform, string> = {
  c8: '8.8.0',
  c7: '7.24.0',
};

/** `modeler:executionPlatform` values. */
export const PLATFORM_NAME: Record<ExecutionPlatform, string> = {
  c8: 'Camunda Cloud',
  c7: 'Camunda Platform',
};

/** `modeler:executionPlatform` and `modeler:executionPlatformVersion`, as XML attributes. */
export const platformAttributes = (platform: ExecutionPlatform): string =>
  `modeler:executionPlatform="${PLATFORM_NAME[platform]}" modeler:executionPlatformVersion="${DEFAULT_PLATFORM_VERSION[platform]}"`;

/** Random 7-character suffix in the style of Desktop Modeler IDs (e.g. `Definitions_0f9wx1k`). */
export function randomIdSuffix(random: () => number = Math.random): string {
  let suffix = '';
  for (let i = 0; i < 7; i++) suffix += Math.floor(random() * 36).toString(36);
  return suffix;
}
