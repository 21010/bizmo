// Non-blocking information shown above the editor (e.g. "this file will be converted"). Built from
// DOM nodes with textContent only. It sits in the layout, not over the canvas, so the palette and
// the bpmn.io watermark stay unobstructed.

const NOTICE_ID = 'bizmo-notice';

export function showNotice(text: string): void {
  const app = document.getElementById('app');
  if (!app) return;
  const existing = document.getElementById(NOTICE_ID);
  if (existing?.firstElementChild?.textContent === text) return;
  existing?.remove();

  const notice = document.createElement('div');
  notice.id = NOTICE_ID;
  notice.className = 'bizmo-notice';
  notice.setAttribute('role', 'status');
  const message = document.createElement('span');
  message.textContent = text;
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = '×';
  dismiss.title = 'Dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.addEventListener('click', hideNotice);
  notice.append(message, dismiss);
  app.prepend(notice);
  resized();
}

export function hideNotice(): void {
  const notice = document.getElementById(NOTICE_ID);
  if (!notice) return;
  notice.remove();
  resized();
}

/** The editor area changed size: let the modeler recompute its viewport. */
const resized = () => {
  window.dispatchEvent(new Event('resize'));
};
