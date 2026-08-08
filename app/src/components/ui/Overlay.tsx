import { useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icon";

/** Modal ve drawer için ortak focus trap + Escape davranışı (§18). */
function useDialogBehaviour(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !ref.current) return;

      const focusables = ref.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", handleKeyDown);
    // İlk odaklanabilir öğeye geç.
    const timer = window.setTimeout(() => {
      ref.current
        ?.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        ?.focus();
    }, 0);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.clearTimeout(timer);
      previous?.focus?.();
    };
  }, [handleKeyDown]);

  return ref;
}

export function Drawer({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useDialogBehaviour(onClose);

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="drawer__head">
          <div>
            <h2 className="drawer__title">{title}</h2>
            {subtitle ? (
              <div className="text-xs muted" style={{ marginTop: 2 }}>
                {subtitle}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="iconbtn"
            onClick={onClose}
            aria-label="Paneli kapat"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="drawer__body">{children}</div>
        {footer ? <div className="drawer__foot">{footer}</div> : null}
      </div>
    </>
  );
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useDialogBehaviour(onClose);

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        style={width ? { width } : undefined}
      >
        <div className="modal__head">
          <div>
            <h2 className="modal__title">{title}</h2>
            {subtitle ? (
              <div className="text-xs muted" style={{ marginTop: 2 }}>
                {subtitle}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="iconbtn"
            onClick={onClose}
            aria-label="Pencereyi kapat"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__foot">{footer}</div> : null}
      </div>
    </>
  );
}
