import type { ExecutionPlatform } from '../protocol';

const DEFINITIONS_START = /<(?:[\w-]+:)?definitions\b[^>]*>/;
const EXECUTION_PLATFORM = /\bmodeler:executionPlatform\s*=\s*(["'])(.*?)\1/;

/**
 * Detects the Camunda execution platform from `modeler:executionPlatform` on the `definitions`
 * element of a BPMN or DMN file (written by Camunda Desktop Modeler). Files without the attribute
 * use the given default.
 */
export function detectExecutionPlatform(
  xml: string,
  fallback: ExecutionPlatform = 'c8',
): ExecutionPlatform {
  const definitions = DEFINITIONS_START.exec(xml)?.[0];
  const platform = definitions ? EXECUTION_PLATFORM.exec(definitions)?.[2] : undefined;
  if (platform === 'Camunda Platform') return 'c7';
  if (platform === 'Camunda Cloud') return 'c8';
  return fallback;
}
