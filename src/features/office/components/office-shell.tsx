"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/features/auth/components/logout-button";
import {
  OFFICE_AREAS,
  type OfficeAreaId,
} from "@/features/office/office-navigation";
import { ATLAS_UI_STRINGS } from "@/lib/strings";

type OfficeShellProps = Readonly<{
  activeArea: OfficeAreaId;
  onAreaChange: (area: OfficeAreaId) => void;
  children: ReactNode;
}>;

const OfficePageScrollResetContext = createContext<() => void>(() => undefined);

export function useOfficePageScrollReset() {
  return useContext(OfficePageScrollResetContext);
}

export function OfficeShell({
  activeArea,
  onAreaChange,
  children,
}: OfficeShellProps) {
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);
  const [officeViewHash, setOfficeViewHash] = useState("#dashboard");
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavigationRef = useRef<HTMLElement>(null);
  const activeAreaLabel = OFFICE_AREAS.find((area) => area.id === activeArea)?.label
    ?? "Dashboard";
  const resetOfficePageScroll = useCallback(() => {
    const pageScroller = document.scrollingElement;
    if (pageScroller) pageScroller.scrollTop = 0;
  }, []);

  useEffect(() => {
    function syncOfficeViewHash() {
      setOfficeViewHash(window.location.hash || "#dashboard");
    }

    syncOfficeViewHash();
    window.addEventListener("hashchange", syncOfficeViewHash);
    return () => window.removeEventListener("hashchange", syncOfficeViewHash);
  }, []);

  useLayoutEffect(() => {
    resetOfficePageScroll();
  }, [activeArea, officeViewHash, resetOfficePageScroll]);

  useEffect(() => {
    if (!isNavigationOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setIsNavigationOpen(false);
      requestAnimationFrame(() => menuButtonRef.current?.focus());
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isNavigationOpen]);

  function navigate(area: OfficeAreaId) {
    onAreaChange(area);
    setIsNavigationOpen(false);
  }

  function closeNavigation() {
    setIsNavigationOpen(false);
    requestAnimationFrame(() => menuButtonRef.current?.focus());
  }

  function containDrawerFocus(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;

    const focusableElements = mobileNavigationRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusableElements?.length) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  return (
    <div className="min-h-screen bg-atlas-background font-atlas text-atlas-text">
      {/* ui-exception: the fixed Office sidebar needs one stable shell width outside the content spacing scale. */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-atlas-border bg-atlas-background-muted lg:flex">
        <OfficeIdentity />
        <OfficeNavigation activeArea={activeArea} onNavigate={navigate} />
        <div className="mt-auto border-t border-atlas-border p-atlas-4">
          <LogoutButton v2 />
        </div>
      </aside>

      {/* ui-exception: padding matches the fixed Office sidebar width so the workspace uses the remaining viewport. */}
      <div className="min-h-screen lg:pl-64">
        <header className="sticky top-0 z-40 flex min-h-atlas-16 items-center justify-between gap-atlas-3 border-b border-atlas-border bg-atlas-background px-atlas-4 lg:hidden">
          <div className="min-w-0">
            <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Atlas Office</p>
            <p className="truncate text-atlas-base font-atlas-semibold text-atlas-text">{activeAreaLabel}</p>
          </div>
          <Button
            ref={menuButtonRef}
            type="button"
            variant="secondary"
            aria-controls="office-mobile-navigation"
            aria-expanded={isNavigationOpen}
            onClick={() => setIsNavigationOpen(true)}
          >
            Menu
          </Button>
        </header>

        {isNavigationOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            {/* ui-exception: the full-screen drawer backdrop is a dismissal target, not a styled action button. */}
            <button type="button" tabIndex={-1} aria-label="Close Office navigation" className="absolute inset-0 bg-atlas-text/20" onClick={closeNavigation} />
            <aside
              ref={mobileNavigationRef}
              id="office-mobile-navigation"
              role="dialog"
              aria-modal="true"
              aria-label="Office navigation"
              onKeyDown={containDrawerFocus}
              className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-atlas-border bg-atlas-background-muted shadow-atlas-medium"
            >
              <div className="flex items-start justify-between gap-atlas-3 border-b border-atlas-border p-atlas-4">
                <OfficeIdentity compact />
                <Button type="button" variant="ghost" autoFocus onClick={closeNavigation}>{ATLAS_UI_STRINGS.actions.close}</Button>
              </div>
              <OfficeNavigation activeArea={activeArea} onNavigate={navigate} />
              <div className="mt-auto border-t border-atlas-border p-atlas-4">
                <LogoutButton v2 />
              </div>
            </aside>
          </div>
        )}

        <main className="px-atlas-4 py-atlas-5 sm:px-atlas-6 lg:px-atlas-8 lg:py-atlas-8">
          <div className="mx-auto w-full max-w-screen-2xl">
            {activeArea !== "sales" && activeArea !== "workforce" && activeArea !== "production" && activeArea !== "purchases-expenses" && activeArea !== "cash-book" && (
              <header className="mb-atlas-6 hidden border-b border-atlas-border pb-atlas-5 lg:block">
                <p className="text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Office workspace</p>
                <h1 className="mt-atlas-1 text-atlas-3xl font-atlas-semibold text-atlas-text">{activeAreaLabel}</h1>
              </header>
            )}
            <OfficePageScrollResetContext.Provider value={resetOfficePageScroll}>
              {children}
            </OfficePageScrollResetContext.Provider>
          </div>
        </main>
      </div>
    </div>
  );
}

function OfficeIdentity({ compact = false }: Readonly<{ compact?: boolean }>) {
  return (
    <div className={compact ? undefined : "border-b border-atlas-border px-atlas-5 py-atlas-6"}>
      <p className="text-atlas-xl font-atlas-semibold text-atlas-text">Atlas</p>
      <p className="mt-atlas-1 text-atlas-xs font-atlas-semibold uppercase tracking-atlas-wide text-atlas-text-muted">Office</p>
    </div>
  );
}

function OfficeNavigation({
  activeArea,
  onNavigate,
}: Readonly<{
  activeArea: OfficeAreaId;
  onNavigate: (area: OfficeAreaId) => void;
}>) {
  return (
    <nav aria-label="Office areas" className="flex-1 overflow-y-auto p-atlas-3">
      <ul className="space-y-atlas-1">
        {OFFICE_AREAS.map((area) => {
          const isActive = area.id === activeArea;
          return (
            <li key={area.id}>
              <a
                href={`#${area.id}`}
                aria-current={isActive ? "page" : undefined}
                onClick={() => onNavigate(area.id)}
                className={`flex min-h-atlas-12 items-center rounded-atlas-control border px-atlas-3 py-atlas-2 text-atlas-sm font-atlas-medium focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus ${isActive ? "border-atlas-primary-border bg-atlas-primary-surface text-atlas-primary" : "border-transparent text-atlas-text-muted hover:bg-atlas-surface-hover hover:text-atlas-text"}`}
              >
                {area.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
