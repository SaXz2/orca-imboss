import { useEffect, useRef, useState, type ReactNode } from "react";
import { cls } from "reactutils";
import "./index.css";
import { useVirtualList } from "./use-virtual-list";

const FOOTER_KEY = "__virtual-list-footer__";

export interface VirtualListProps<T> {
  items: readonly T[];
  getItemKey: (item: T, index: number) => React.Key;
  /**
   * Render one row's content. `ItemList` (selectable mode) owns the row
   * click; this should render the visual row only (e.g. `<ListRow />`).
   */
  renderItem: (item: T, index: number) => ReactNode;
  /** Initial row height guess (rows self-measure afterwards). */
  estimateSize?: (index: number) => number;
  overscan?: number;
  /** Fixed gap (px) between rows. Applied in layout math, not CSS (rows are absolutely positioned). */
  gap?: number;
  /**
   * Extra row rendered after the last item (e.g. a "loading more" sentinel).
   * While present, the row count is `items.length + 1`, which also guarantees
   * there is scrollable space below the last real row.
   */
  footer?: ReactNode;
  /** Invoked when the last real row becomes (nearly) visible. */
  onNearEnd?: () => void;
  /**
   * One-shot entrance animation for a genuinely-new top row (see
   * `.imb-vlist-row-enter`). Fires only when a *new* item is pushed onto the
   * head of the list while the previous head is still present — so scroll
   * remounts and filter/replace updates never replay it. Intended for
   * newest-first lists.
   */
  animateNewTop?: boolean;
  className?: string;
}

/**
 * Generic windowed list over an internal scroll container. Renders
 * absolutely positioned, dynamically measured rows (`data-index` +
 * `measureElement`), with the same visual contract as the old `.imb-list`
 * (horizontal `8px` padding moved into each row wrapper so the virtualizer's
 * scroll math stays exact).
 */
export function VirtualList<T>({
  items,
  getItemKey,
  renderItem,
  estimateSize,
  overscan = 5,
  gap,
  footer,
  onNearEnd,
  animateNewTop = false,
  className,
}: VirtualListProps<T>): React.JSX.Element {
  const { scrollRef, virtualizer } = useVirtualList({
    count: items.length + (footer !== undefined ? 1 : 0),
    estimateSize,
    overscan,
    gap,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex =
    virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : -1;

  // Track the head key so a freshly-prepended row can animate once. The
  // previous head must still exist in the list (otherwise the change was a
  // filter/replace, not a prepend).
  const topKey = items.length > 0 ? getItemKey(items[0], 0) : null;
  const prevTopRef = useRef<React.Key | null | undefined>(undefined);
  const [enterKey, setEnterKey] = useState<React.Key | null>(null);

  useEffect(() => {
    if (!animateNewTop) return;
    if (prevTopRef.current === undefined) {
      prevTopRef.current = topKey;
      return;
    }
    if (topKey === prevTopRef.current) return;
    const previous = prevTopRef.current;
    prevTopRef.current = topKey;
    const previousStillPresent =
      previous !== null &&
      items.some((item, index) => getItemKey(item, index) === previous);
    if (previousStillPresent && topKey !== null) setEnterKey(topKey);
  }, [topKey, animateNewTop, items, getItemKey]);

  useEffect(() => {
    if (enterKey === null) return;
    const timer = window.setTimeout(() => setEnterKey(null), 600);
    return () => window.clearTimeout(timer);
  }, [enterKey]);

  // Lazy loading: fetch the next page when the user scrolls close to the
  // bottom (or when the loaded rows don't fill the viewport — the sentinel is
  // already visible). All re-entry guards live in the caller's `loadMore`.
  useEffect(() => {
    if (footer === undefined || onNearEnd === undefined) return;
    if (lastIndex >= items.length - 1) onNearEnd();
  }, [footer, onNearEnd, lastIndex, items.length]);

  return (
    <div ref={scrollRef} className={cls("imb-vlist", className)}>
      <div
        className="imb-vlist-inner"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((virtualItem) => {
          const rowStyle: React.CSSProperties = {
            transform: `translateY(${virtualItem.start}px)`,
          };
          if (virtualItem.index >= items.length) {
            // Footer/sentinel row (e.g. "loading more").
            return (
              <div
                key={FOOTER_KEY}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                className="imb-vlist-row imb-vlist-footer-row"
                style={rowStyle}
              >
                {footer}
              </div>
            );
          }
          const item = items[virtualItem.index];
          const key = getItemKey(item, virtualItem.index);
          return (
            <div
              key={key}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              className={cls(
                "imb-vlist-row",
                enterKey !== null &&
                  virtualItem.index === 0 &&
                  key === enterKey &&
                  "imb-vlist-row-enter",
              )}
              style={rowStyle}
            >
              {renderItem(item, virtualItem.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
