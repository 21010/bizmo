// Canvas | splitter | side panel layout. The panel is resizable with the mouse or the keyboard
// (arrow keys on the focused splitter) and collapsible; its size survives tab switches.
import { getState, updateState } from './bridge';

export interface SplitPane {
  canvasHost: HTMLElement;
  panelHost: HTMLElement;
}

interface PanelState {
  width: number;
  collapsed: boolean;
}

const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 220;
const KEYBOARD_STEP = 20;
const maxWidth = () => Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.7));
const clamp = (width: number) => Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(width)));

function savedPanelState(): PanelState {
  const saved = (getState() as { panel?: Partial<PanelState> } | undefined)?.panel;
  return {
    width: typeof saved?.width === 'number' ? clamp(saved.width) : DEFAULT_WIDTH,
    collapsed: saved?.collapsed === true,
  };
}

export function createSplitPane(root: HTMLElement, panelLabel: string): SplitPane {
  const state = savedPanelState();

  const layout = document.createElement('div');
  layout.className = 'bizmo-layout';

  // The canvas area holds the toggle; the modeler is placed in its own slot (replaced on recreate).
  const canvasArea = document.createElement('div');
  canvasArea.className = 'bizmo-canvas-area';
  const canvasHost = document.createElement('div');
  canvasHost.className = 'bizmo-canvas-host';

  const splitter = document.createElement('div');
  splitter.className = 'bizmo-splitter';
  splitter.setAttribute('role', 'separator');
  splitter.setAttribute('aria-orientation', 'vertical');
  splitter.setAttribute('aria-label', `Resize ${panelLabel}`);
  splitter.setAttribute('aria-controls', 'bizmo-panel');
  splitter.tabIndex = 0;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'bizmo-panel-toggle';
  toggle.setAttribute('aria-controls', 'bizmo-panel');

  const panelHost = document.createElement('aside');
  panelHost.id = 'bizmo-panel';
  panelHost.className = 'bizmo-panel';
  panelHost.setAttribute('aria-label', panelLabel);

  canvasArea.append(canvasHost, toggle);
  layout.append(canvasArea, splitter, panelHost);
  root.append(layout);

  const apply = () => {
    layout.style.setProperty('--bizmo-panel-width', `${state.width}px`);
    layout.classList.toggle('bizmo-panel-collapsed', state.collapsed);
    splitter.hidden = state.collapsed;
    panelHost.hidden = state.collapsed;
    toggle.setAttribute('aria-expanded', String(!state.collapsed));
    toggle.textContent = state.collapsed ? `Show ${panelLabel}` : `Hide ${panelLabel}`;
    toggle.title = toggle.textContent;
    splitter.setAttribute('aria-valuemin', String(MIN_WIDTH));
    splitter.setAttribute('aria-valuemax', String(maxWidth()));
    splitter.setAttribute('aria-valuenow', String(state.width));
    // The canvas size changed: let diagram-js recompute its viewport.
    window.dispatchEvent(new Event('resize'));
  };
  const save = () => {
    updateState({ panel: { ...state } });
  };

  toggle.addEventListener('click', () => {
    state.collapsed = !state.collapsed;
    apply();
    save();
  });

  splitter.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    splitter.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = state.width;
    const onMove = (move: PointerEvent) => {
      state.width = clamp(startWidth + (startX - move.clientX));
      apply();
    };
    const onUp = () => {
      splitter.removeEventListener('pointermove', onMove);
      splitter.removeEventListener('pointerup', onUp);
      save();
    };
    splitter.addEventListener('pointermove', onMove);
    splitter.addEventListener('pointerup', onUp);
  });

  splitter.addEventListener('keydown', (event) => {
    const delta =
      event.key === 'ArrowLeft' ? KEYBOARD_STEP : event.key === 'ArrowRight' ? -KEYBOARD_STEP : 0;
    if (!delta) return;
    event.preventDefault();
    state.width = clamp(state.width + delta);
    apply();
    save();
  });

  apply();
  return { canvasHost, panelHost };
}
