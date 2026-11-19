import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Filter,
  ArrowUpAZ,
  ArrowDownAZ,
  ArrowUpDown,
  Search,
  X,
  Check,
  CheckSquare,
  Square,
  RotateCcw,
} from 'lucide-react';

export type SortDirection = 'asc' | 'desc' | null;

export interface ColumnFilterItem {
  value: string;
  label: string;
  count?: number;
  group?: string;
}

interface SheetColumnFilterProps {
  title: string;
  items: ColumnFilterItem[];
  selectedValues: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
  sortDirection?: SortDirection;
  onSortChange?: (direction: SortDirection) => void;
  sortAscLabel?: string;
  sortDescLabel?: string;
  children?: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

export const SheetColumnFilter: React.FC<SheetColumnFilterProps> = ({
  title,
  items,
  selectedValues,
  onSelectionChange,
  sortDirection = null,
  onSortChange,
  sortAscLabel = 'Sort A → Z',
  sortDescLabel = 'Sort Z → A',
  children,
  align = 'left',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Is column actively filtered (not all selected, or specific selection)
  const isFiltered = selectedValues.size > 0 && selectedValues.size < items.length;
  const isSorted = sortDirection !== null;
  const hasActiveConfig = isFiltered || isSorted;

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.value.toLowerCase().includes(q) ||
        (item.group && item.group.toLowerCase().includes(q))
    );
  }, [items, searchQuery]);

  const handleToggleValue = (value: string) => {
    const next = new Set(selectedValues);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onSelectionChange(next);
  };

  const handleSelectAll = () => {
    const all = new Set(items.map((i) => i.value));
    onSelectionChange(all);
  };

  const handleClearAll = () => {
    onSelectionChange(new Set());
  };

  const handleReset = () => {
    // Reset to "all selected" (unfiltered)
    onSelectionChange(new Set(items.map((i) => i.value)));
    if (onSortChange) onSortChange(null);
  };

  return (
    <div className={`relative inline-flex items-center gap-1 group/sheet-th ${className}`}>
      {children || <span>{title}</span>}
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        title={`Filter & sort "${title}" like in Sheets`}
        aria-label={`Filter and sort ${title}`}
        className={`p-1 rounded-[4px] transition-colors cursor-pointer inline-flex items-center justify-center shrink-0 ${
          hasActiveConfig
            ? 'bg-sky-500 text-white shadow-xs hover:bg-sky-600'
            : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] opacity-70 group-hover/sheet-th:opacity-100'
        }`}
      >
        <Filter className="h-3 w-3 stroke-[2.2]" />
        {isSorted && (
          <span className="text-[9px] font-bold ml-0.5">
            {sortDirection === 'asc' ? '↑' : '↓'}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          onClick={(e) => e.stopPropagation()}
          className={`absolute top-full z-50 mt-1.5 w-64 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] shadow-xl p-2.5 space-y-2.5 animate-in fade-in zoom-in-95 duration-100 text-left font-normal ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
          style={{ minWidth: '240px' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
            <div className="text-[12px] font-semibold flex items-center gap-1.5 text-[var(--text-primary)]">
              <Filter className="h-3.5 w-3.5 text-sky-600" />
              <span>Filter: {title}</span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
              title="Close filter menu"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Sort Buttons */}
          {onSortChange && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                Sort
              </div>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => onSortChange(sortDirection === 'asc' ? null : 'asc')}
                  className={`flex items-center justify-center gap-1.5 py-1 px-2 text-[11px] font-medium rounded-[4px] border transition-colors cursor-pointer ${
                    sortDirection === 'asc'
                      ? 'border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                      : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
                  }`}
                >
                  <ArrowUpAZ className="h-3 w-3" />
                  <span className="truncate">{sortAscLabel}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSortChange(sortDirection === 'desc' ? null : 'desc')}
                  className={`flex items-center justify-center gap-1.5 py-1 px-2 text-[11px] font-medium rounded-[4px] border transition-colors cursor-pointer ${
                    sortDirection === 'desc'
                      ? 'border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                      : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
                  }`}
                >
                  <ArrowDownAZ className="h-3 w-3" />
                  <span className="truncate">{sortDescLabel}</span>
                </button>
              </div>
            </div>
          )}

          {/* Search Box */}
          <div className="space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              Filter by Values
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search values..."
                className="w-full pl-7 pr-2 py-1 text-[12px] rounded-[4px] border border-[var(--border)] bg-[var(--surface-input,var(--surface))] text-[var(--text-primary)] focus:outline-hidden focus:ring-1 focus:ring-sky-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Quick Select All / Clear */}
          <div className="flex items-center justify-between text-[11px] text-[var(--text-tertiary)] px-0.5">
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-sky-600 hover:underline font-medium cursor-pointer"
            >
              Select All
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-[var(--text-secondary)] hover:underline font-medium cursor-pointer"
            >
              Clear All
            </button>
            <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">
              {selectedValues.size} / {items.length}
            </span>
          </div>

          {/* Items Checkbox List */}
          <div className="max-h-44 overflow-y-auto space-y-0.5 border border-[var(--border)] rounded-[4px] p-1 bg-[var(--bg-subtle)]/40">
            {filteredItems.length === 0 ? (
              <div className="py-3 text-center text-[11px] text-[var(--text-tertiary)]">
                No matching values
              </div>
            ) : (
              filteredItems.map((item) => {
                const isChecked = selectedValues.has(item.value);
                return (
                  <label
                    key={item.value}
                    className="flex items-center justify-between gap-2 px-1.5 py-1 rounded text-[11px] hover:bg-[var(--surface)] cursor-pointer select-none"
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleValue(item.value)}
                        className="rounded border-[var(--border)] text-sky-600 focus:ring-sky-500 h-3.5 w-3.5"
                      />
                      <span
                        className={`truncate ${
                          isChecked
                            ? 'text-[var(--text-primary)] font-medium'
                            : 'text-[var(--text-secondary)]'
                        }`}
                        title={item.label}
                      >
                        {item.label}
                      </span>
                    </span>
                    {item.count !== undefined && (
                      <span className="text-[10px] font-mono text-[var(--text-tertiary)] shrink-0 ml-1">
                        {item.count}
                      </span>
                    )}
                  </label>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-[var(--border)] pt-2 text-[11px]">
            {hasActiveConfig ? (
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1 text-[var(--status-danger,#ef4444)] hover:underline font-medium cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                Reset column
              </button>
            ) : (
              <span className="text-[10px] text-[var(--text-tertiary)]">All values active</span>
            )}
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="py-1 px-3 rounded-[4px] bg-sky-600 text-white font-medium hover:bg-sky-700 transition-colors cursor-pointer text-[11px]"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
