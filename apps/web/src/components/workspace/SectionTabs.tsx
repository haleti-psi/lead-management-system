import { useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * FR-051 — accessible tab group for the Lead-360 sections.
 *
 * The LLD names the shadcn/ui `Tabs` primitive, but the merged web foundation
 * ships neither it nor its `@radix-ui/react-tabs` dependency (which the
 * dependency register would have to approve first — see AMBIGUITY.md). This
 * workspace-local stand-in implements the WAI-ARIA tabs pattern directly:
 * `tablist`/`tab`/`tabpanel` roles, roving tab-index, Arrow/Home/End keyboard
 * navigation, visible focus ring (WCAG 2.1 AA), and a horizontally scrollable
 * trigger row on mobile (LLD: tabs collapse to a scrollable chip row).
 */
export interface SectionTab {
  id: string;
  label: string;
  content: ReactNode;
}

export interface SectionTabsProps {
  tabs: readonly SectionTab[];
  /** Defaults to the first tab. */
  initialTabId?: string;
  /** Accessible name for the tablist. */
  ariaLabel: string;
}

export function SectionTabs({ tabs, initialTabId, ariaLabel }: SectionTabsProps): ReactElement {
  const firstId = tabs[0]?.id ?? '';
  const [activeId, setActiveId] = useState(initialTabId ?? firstId);
  const triggersRef = useRef<Map<string, HTMLButtonElement>>(new Map());

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  function focusAndActivate(index: number): void {
    const tab = tabs[(index + tabs.length) % tabs.length];
    if (!tab) return;
    setActiveId(tab.id);
    triggersRef.current.get(tab.id)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusAndActivate(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusAndActivate(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAndActivate(0);
        break;
      case 'End':
        event.preventDefault();
        focusAndActivate(tabs.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex gap-1 overflow-x-auto border-b pb-px"
      >
        {tabs.map((tab, index) => {
          const selected = tab.id === activeTab?.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) triggersRef.current.set(tab.id, el);
                else triggersRef.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveId(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                'whitespace-nowrap rounded-t-md px-3 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected
                  ? 'border-b-2 border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {activeTab ? (
        <div
          role="tabpanel"
          id={`panel-${activeTab.id}`}
          aria-labelledby={`tab-${activeTab.id}`}
          tabIndex={0}
          className="pt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {activeTab.content}
        </div>
      ) : null}
    </div>
  );
}
