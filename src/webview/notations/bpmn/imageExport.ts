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
  const { svg } = await modeler.saveSVG();
  return format === 'svg' ? svg : toBase64(await renderPng(svg));
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
