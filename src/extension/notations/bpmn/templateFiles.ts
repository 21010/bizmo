// Parsing and classification of Camunda element template files (ADR 0010, D4). Pure: no `vscode`.
// Template files are workspace content: they are size-limited, parsed defensively, and treated as
// data. Schema validation happens in the webview with the official validator.
import type { ExecutionPlatform } from '../../../shared/protocol';

export const TEMPLATE_LIMITS = {
  fileBytes: 1024 * 1024,
  totalBytes: 10 * 1024 * 1024,
  templates: 2000,
} as const;

export type ElementTemplate = Record<string, unknown>;

export interface TemplateSet {
  c7: ElementTemplate[];
  c8: ElementTemplate[];
}

/** Keys that could reach prototypes if a consumer merged the data into objects. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isPlainObject = (value: unknown): value is ElementTemplate =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Camunda 8 templates declare the Zeebe schema; everything else (including templates without
 * `$schema`, the historic default) is treated as Camunda 7, as in Camunda Desktop Modeler.
 */
export function templatePlatform(template: ElementTemplate): ExecutionPlatform {
  const schema = template['$schema'];
  return typeof schema === 'string' && schema.includes('zeebe-element-templates-json-schema')
    ? 'c8'
    : 'c7';
}

/** Parses one file: a template object or an array of them. Throws with a readable message. */
export function parseTemplateFile(text: string): ElementTemplate[] {
  const parsed: unknown = JSON.parse(text, (key, value: unknown) => {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`forbidden key "${key}"`);
    return value;
  });
  const items = Array.isArray(parsed) ? (parsed as unknown[]) : [parsed];
  if (!items.every(isPlainObject)) {
    throw new Error('expected a template object or an array of template objects');
  }
  return items;
}

export interface TemplateFile {
  path: string;
  text: string;
}

export interface LoadResult {
  templates: TemplateSet;
  errors: string[];
}

/** Builds the template set from file contents, enforcing the limits. */
export function collectTemplates(files: Iterable<TemplateFile>): LoadResult {
  const templates: TemplateSet = { c7: [], c8: [] };
  const errors: string[] = [];
  let totalBytes = 0;
  let count = 0;

  for (const { path, text } of files) {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > TEMPLATE_LIMITS.fileBytes) {
      errors.push(`${path}: skipped, larger than ${TEMPLATE_LIMITS.fileBytes / 1024} KB`);
      continue;
    }
    if (totalBytes + bytes > TEMPLATE_LIMITS.totalBytes) {
      errors.push(
        `${path}: skipped, element templates exceed ${TEMPLATE_LIMITS.totalBytes / 1024 / 1024} MB in total`,
      );
      continue;
    }
    let parsed: ElementTemplate[];
    try {
      parsed = parseTemplateFile(text);
    } catch (error) {
      errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (count + parsed.length > TEMPLATE_LIMITS.templates) {
      errors.push(`${path}: skipped, more than ${TEMPLATE_LIMITS.templates} element templates`);
      continue;
    }
    totalBytes += bytes;
    count += parsed.length;
    for (const template of parsed) templates[templatePlatform(template)].push(template);
  }
  return { templates, errors };
}
