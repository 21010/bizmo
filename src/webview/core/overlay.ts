// Non-destructive error state shown over the editor. Built from DOM nodes with textContent only:
// messages may contain text from the model file.

export interface OverlayAction {
  label: string;
  run: () => void;
}

const OVERLAY_ID = 'bizmo-overlay';

export function showOverlay(title: string, detail: string, actions: OverlayAction[]): void {
  hideOverlay();
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'bizmo-overlay';
  overlay.setAttribute('role', 'alert');

  const heading = document.createElement('h2');
  heading.textContent = title;
  const message = document.createElement('pre');
  message.textContent = detail;
  overlay.append(heading, message);

  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', action.run);
    overlay.append(button);
  }
  document.body.append(overlay);
}

export function hideOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

export function isOverlayVisible(): boolean {
  return document.getElementById(OVERLAY_ID) !== null;
}
