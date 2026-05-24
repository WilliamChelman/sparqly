const MIN_COLUMN_WIDTH = 80;

export function startColumnResize(
  event: PointerEvent,
  columnIndex: number,
  setWidth: (index: number, width: number) => void,
): void {
  event.preventDefault();
  const handle = event.currentTarget as HTMLElement;
  const cell = handle.parentElement;
  if (cell == null) return;

  const pointerId = event.pointerId;
  handle.setPointerCapture(pointerId);

  const startX = event.clientX;
  const startWidth = cell.getBoundingClientRect().width;

  const onMove = (e: PointerEvent) => {
    const delta = e.clientX - startX;
    setWidth(columnIndex, Math.max(MIN_COLUMN_WIDTH, startWidth + delta));
  };
  const onEnd = () => {
    handle.releasePointerCapture(pointerId);
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onEnd);
    handle.removeEventListener('pointercancel', onEnd);
  };

  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onEnd);
  handle.addEventListener('pointercancel', onEnd);
}
