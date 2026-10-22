import type RFB from '@novnc/novnc';

/** Draw the server's own RFB cursor sprite at its reported native hotspot.
 * Never uses the last commanded click or browser mouse position as ground truth.
 */
export function remotePointer(viewer: HTMLElement, rfb: RFB, width: number, height: number) {
  const overlay = document.createElement('canvas');
  overlay.dataset.remotePointer = 'true';
  overlay.setAttribute('aria-hidden', 'true');
  Object.assign(overlay.style, { position: 'absolute', pointerEvents: 'none', display: 'none', zIndex: '1', left: '0', top: '0' });
  viewer.append(overlay);
  let point: { x: number; y: number } | undefined;
  let hotspot = { x: 0, y: 0 };
  let frame = 0;
  function render() {
    frame = 0;
    const screen = viewer.querySelector('canvas:not([data-remote-pointer])');
    if (!screen || !point || !rfb.viewOnly || !overlay.width || !overlay.height) { overlay.style.display = 'none'; return; }
    const source = screen.getBoundingClientRect(), parent = viewer.getBoundingClientRect();
    const sx = source.width/width, sy = source.height/height;
    overlay.style.display = 'block';
    overlay.style.width = `${overlay.width*sx}px`; overlay.style.height = `${overlay.height*sy}px`;
    overlay.style.transform = `translate(${source.left-parent.left-viewer.clientLeft+(point.x-hotspot.x)*sx}px, ${source.top-parent.top-viewer.clientTop+(point.y-hotspot.y)*sy}px)`;
  }
  const refresh = () => { if (!frame) frame = requestAnimationFrame(render); };
  function position(event: Event) {
    const next = (event as CustomEvent<{x: number; y: number}>).detail;
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || next.x < 0 || next.x >= width || next.y < 0 || next.y >= height) return;
    point = next; overlay.dataset.x = String(next.x); overlay.dataset.y = String(next.y); refresh();
  }
  function image(event: Event) {
    const value = (event as CustomEvent<{ rgbaPixels: Uint8Array; hotx: number; hoty: number; w: number; h: number }>).detail;
    if (!Number.isInteger(value.w) || !Number.isInteger(value.h) || value.w < 0 || value.h < 0 || value.w > 512 || value.h > 512 || value.rgbaPixels.length !== value.w*value.h*4) return;
    overlay.width = value.w; overlay.height = value.h;
    hotspot = { x: value.hotx, y: value.hoty };
    overlay.dataset.hotspotX = String(value.hotx); overlay.dataset.hotspotY = String(value.hoty);
    if (value.w && value.h) overlay.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(value.rgbaPixels), value.w, value.h), 0, 0);
    refresh();
  }
  rfb.addEventListener('cursorposition', position); rfb.addEventListener('cursorimage', image);
  const observer = new ResizeObserver(refresh); observer.observe(viewer);
  const screen = viewer.querySelector('canvas:not([data-remote-pointer])'); if (screen) observer.observe(screen);
  window.addEventListener('resize', refresh);
  return { refresh, remove() { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', refresh); rfb.removeEventListener('cursorposition', position); rfb.removeEventListener('cursorimage', image); overlay.remove(); } };
}
