// DMN versions. dmn-js opens only DMN 1.3; older files are migrated before import (ADR 0014).

/** Namespaces of the DMN versions that are migrated to DMN 1.3. */
const OLD_DMN = {
  '1.1': 'http://www.omg.org/spec/DMN/20151101/dmn.xsd',
  '1.2': 'http://www.omg.org/spec/DMN/20180521/MODEL/',
} as const;

export type OldDmnVersion = keyof typeof OLD_DMN;

/** The DMN 1.3 model namespace, written by migration and by new diagrams. */
export const DMN13_NAMESPACE = 'https://www.omg.org/spec/DMN/20191111/MODEL/';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const declares = (namespace: string) =>
  new RegExp(`\\bxmlns(?::[\\w.-]+)?\\s*=\\s*(["'])${escape(namespace)}\\1`);
const PATTERNS = Object.entries(OLD_DMN).map(
  ([version, namespace]) => [version as OldDmnVersion, declares(namespace)] as const,
);

/** The older DMN version the file declares, or undefined for DMN 1.3 (and anything else). */
export function oldDmnVersion(xml: string): OldDmnVersion | undefined {
  return PATTERNS.find(([, pattern]) => pattern.test(xml))?.[0];
}
