// Diagram images for export (M7): SVG from the modeler, PNG drawn from that SVG on a canvas. The
// webview only produces the data; the host asks where to save it and checks it.
import type BaseViewer from 'bpmn-js/lib/BaseViewer';
import type { ImageFormat } from '../../../shared/protocol';

/** PNGs are rendered at twice the diagram size for sharp text, within these bounds. */
const PNG_SCALE = 2;
const MAX_SIDE = 16384;
const MAX_PIXELS = 32 * 1024 * 1024;

/** Returns SVG markup, or the PNG as base64. */
export async function exportImage(modeler: BaseViewer, format: ImageFormat): Promise<string> {
  const svg = withoutExternalImages((await modeler.saveSVG()).svg);
  return format === 'svg' ? svg : toBase64(await renderPng(svg));
}

const XLINK = 'http://www.w3.org/1999/xlink';
const isInlineReference = (href: string): boolean => /^\s*(?:#|data:image\/)/i.test(href);

/**
 * Element template icons may point anywhere. The CSP keeps them off the canvas, so the image
 * leaves them out too; the host refuses SVGs that reference external content.
 */
function withoutExternalImages(svg: string): string {
  const start = svg.indexOf('<svg');
  if (start === -1) return svg;
  // Parsed without the bpmn-js header, so no DOCTYPE reaches the parser.
  const doc = new DOMParser().parseFromString(svg.slice(start), 'image/svg+xml');
  if (doc.querySelector('parsererror')) return svg;
  const external = [...doc.querySelectorAll('image')].filter(
    (image) =>
      !isInlineReference(image.getAttribute('href') ?? image.getAttributeNS(XLINK, 'href') ?? ''),
  );
  if (external.length === 0) return svg;
  for (const image of external) image.remove();
  return svg.slice(0, start) + new XMLSerializer().serializeToString(doc.documentElement);
}

async function renderPng(svg: string): Promise<Blob> {
  const image = new Image();
  // A data: URL (allowed by the CSP's img-src); an SVG without scripts or foreign content
  // does not taint the canvas.
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width <= 0 || height <= 0) throw new Error('The diagram is empty');
  const scale = Math.min(
    PNG_SCALE,
    MAX_SIDE / width,
    MAX_SIDE / height,
    Math.sqrt(MAX_PIXELS / (width * height)),
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available');
  // The diagram is drawn on white, as on the modeler canvas.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The image could not be created'));
    }, 'image/png');
  });
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
