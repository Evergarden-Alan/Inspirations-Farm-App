"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

interface VirtualizedListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  estimateSize?: number; // 预估高度
  overscan?: number; // 缓冲区项数
  className?: string;
  getItemKey?: (item: T, index: number) => string | number;
}

/**
 * 虚拟滚动列表组件
 *
 * 使用 @tanstack/react-virtual 实现高性能列表渲染。
 * 只渲染可视区域的项目，大幅减少 DOM 节点数量。
 *
 * @example
 * <VirtualizedList
 *   items={filteredItems}
 *   estimateSize={250}
 *   overscan={5}
 *   className="max-h-[80vh]"
 *   renderItem={(item) => <ItemCard item={item} />}
 * />
 */
export function VirtualizedList<T>({
  items,
  renderItem,
  estimateSize = 200,
  overscan = 5,
  className = "",
  getItemKey,
}: VirtualizedListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  // TanStack Virtual intentionally exposes mutable measurement functions.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });

  return (
    <div
      ref={parentRef}
      className={`overflow-auto ${className}`}
      style={{ contain: "layout paint style" }}
      role="list"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = items[virtualItem.index];
          const key = getItemKey
            ? getItemKey(item, virtualItem.index)
            : virtualItem.key;

          return (
            <div
              key={key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              role="listitem"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {renderItem(item, virtualItem.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
