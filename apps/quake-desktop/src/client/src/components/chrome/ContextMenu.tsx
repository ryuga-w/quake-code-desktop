// CLASSIC JSX runtime: React must be imported at the very top. A missing React
// import here would blank the entire app, so do not remove this line.
import React from "react";
import { createPortal } from "react-dom";
import styles from "./ContextMenu.module.css";

/**
 * ContextMenu — reusable, native-style, fully accessible right-click menu.
 *
 * Render via React portal to document.body so it escapes overflow:hidden and
 * stacking contexts. Themed entirely through design tokens (auto dark/light).
 *
 * See the JSDoc usage example at the bottom of this file for integration.
 */

/** A single actionable row in the menu. */
export interface MenuAction {
  /** Stable identifier (used as React key + highlight tracking). */
  id: string;
  /** Visible text label. */
  label: string;
  /** Optional leading icon (e.g. a lucide-react <Icon size={14} />). */
  icon?: React.ReactNode;
  /** Render in the error/danger color (e.g. destructive actions). */
  danger?: boolean;
  /** Greyed-out, non-interactive, skipped by keyboard navigation. */
  disabled?: boolean;
  /** Invoked when the item is chosen (click or Enter/Space). Menu closes after. */
  onSelect: () => void;
}

/** A non-interactive divider between groups of actions. */
export interface MenuSeparator {
  type: "separator";
}

/** Union of everything that can appear in the items array. */
export type MenuItem = MenuAction | MenuSeparator;

/** A screen-space point. Accepts a MouseEvent or raw coordinates. */
export interface MenuPosition {
  x: number;
  y: number;
}

/** Accepted argument to open(): a mouse/pointer event or explicit coordinates. */
type OpenArg =
  | MenuPosition
  | React.MouseEvent
  | MouseEvent
  | { clientX: number; clientY: number };

/** What useContextMenu() returns. */
export interface UseContextMenuResult {
  /**
   * Open the menu at the given position with the given items.
   * Pass a MouseEvent (it reads clientX/clientY) or an explicit {x,y}.
   * NOTE: call event.preventDefault() in your onContextMenu handler to
   * suppress the browser's native menu.
   */
  open: (arg: OpenArg, items: MenuItem[]) => void;
  /** Programmatically close the menu. */
  close: () => void;
  /** Whether the menu is currently open. */
  isOpen: boolean;
  /** The rendered menu element (or null when closed). Render this in your JSX. */
  menu: React.ReactNode;
}

function isSeparator(item: MenuItem): item is MenuSeparator {
  return (item as MenuSeparator).type === "separator";
}

function resolvePosition(arg: OpenArg): MenuPosition {
  if ("clientX" in arg && "clientY" in arg) {
    return { x: arg.clientX, y: arg.clientY };
  }
  return { x: (arg as MenuPosition).x, y: (arg as MenuPosition).y };
}

/** Padding kept between the menu and the viewport edges when flipping. */
const VIEWPORT_MARGIN = 8;

interface MenuState {
  position: MenuPosition;
  items: MenuItem[];
}

/**
 * useContextMenu — owns open/position/highlight state and renders the menu.
 *
 * Returns { open, close, isOpen, menu }. Wire `onContextMenu` (or any handler)
 * to call open(event, items), and render {menu} somewhere in your component.
 */
export function useContextMenu(): UseContextMenuResult {
  const [state, setState] = React.useState<MenuState | null>(null);
  // Index into items of the highlighted row; -1 = nothing highlighted.
  const [highlighted, setHighlighted] = React.useState(-1);
  // Final on-screen position after edge-flip measurement.
  const [coords, setCoords] = React.useState<MenuPosition | null>(null);

  const menuRef = React.useRef<HTMLUListElement | null>(null);
  // Element focused before opening, so we can restore focus on close.
  const restoreFocusRef = React.useRef<Element | null>(null);

  const close = React.useCallback(() => {
    setState(null);
    setHighlighted(-1);
    setCoords(null);
    // Restore focus to wherever it was before we opened.
    const prev = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (prev instanceof HTMLElement) {
      // Defer so the portal has fully unmounted first.
      requestAnimationFrame(() => prev.focus?.());
    }
  }, []);

  const open = React.useCallback((arg: OpenArg, items: MenuItem[]) => {
    if (!items || items.length === 0) return;
    restoreFocusRef.current = document.activeElement;
    setState({ position: resolvePosition(arg), items });
    setHighlighted(-1);
    // Start at the raw cursor position; layout effect measures + flips.
    setCoords(resolvePosition(arg));
  }, []);

  const items = state?.items ?? [];

  // Indices that can actually receive the highlight (skip separators/disabled).
  const selectableIndices = React.useMemo(() => {
    const out: number[] = [];
    items.forEach((item, i) => {
      if (!isSeparator(item) && !item.disabled) out.push(i);
    });
    return out;
  }, [items]);

  const moveHighlight = React.useCallback(
    (direction: 1 | -1) => {
      if (selectableIndices.length === 0) return;
      setHighlighted((current) => {
        const pos = selectableIndices.indexOf(current);
        if (pos === -1) {
          // Nothing highlighted yet: enter from the appropriate end.
          return direction === 1
            ? selectableIndices[0]
            : selectableIndices[selectableIndices.length - 1];
        }
        const nextPos =
          (pos + direction + selectableIndices.length) % selectableIndices.length;
        return selectableIndices[nextPos];
      });
    },
    [selectableIndices],
  );

  const selectIndex = React.useCallback(
    (index: number) => {
      const item = items[index];
      if (!item || isSeparator(item) || item.disabled) return;
      // Close first (restores focus), then fire the handler.
      close();
      item.onSelect();
    },
    [items, close],
  );

  // --- Measure on open and flip if the menu would overflow the viewport. ---
  React.useLayoutEffect(() => {
    if (!state) return;
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let { x, y } = state.position;

    if (x + rect.width > vw - VIEWPORT_MARGIN) {
      // Flip to the left of the cursor; clamp so it never goes off-screen.
      x = Math.max(VIEWPORT_MARGIN, x - rect.width);
    }
    if (y + rect.height > vh - VIEWPORT_MARGIN) {
      y = Math.max(VIEWPORT_MARGIN, y - rect.height);
    }
    x = Math.min(x, vw - rect.width - VIEWPORT_MARGIN);
    y = Math.min(y, vh - rect.height - VIEWPORT_MARGIN);
    x = Math.max(VIEWPORT_MARGIN, x);
    y = Math.max(VIEWPORT_MARGIN, y);

    setCoords({ x, y });
    // Focus the menu container so keyboard nav works immediately.
    el.focus({ preventScroll: true });
    // Only re-measure when the menu instance (position/items) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // --- Global dismissal: scroll, resize, blur, and outside mousedown. ---
  React.useEffect(() => {
    if (!state) return;

    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return; // Click inside the menu: handled by item handlers.
      }
      close();
    };
    const onScroll = () => close();
    const onResize = () => close();
    const onBlur = () => close();

    // Capture phase so we beat any stopPropagation from app handlers.
    window.addEventListener("mousedown", onMouseDown, true);
    // Scroll on any scrollable ancestor: listen in capture.
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", onBlur);
    };
  }, [state, close]);

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          moveHighlight(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          moveHighlight(-1);
          break;
        case "Home":
          e.preventDefault();
          if (selectableIndices.length) setHighlighted(selectableIndices[0]);
          break;
        case "End":
          e.preventDefault();
          if (selectableIndices.length)
            setHighlighted(selectableIndices[selectableIndices.length - 1]);
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (highlighted >= 0) selectIndex(highlighted);
          break;
        case "Escape":
          e.preventDefault();
          close();
          break;
        case "Tab":
          // Tab dismisses (native menus don't trap Tab into a focus cycle).
          e.preventDefault();
          close();
          break;
        default:
          break;
      }
    },
    [moveHighlight, selectableIndices, highlighted, selectIndex, close],
  );

  const menu =
    state && coords
      ? createPortal(
          <ul
            ref={menuRef}
            className={styles.menu}
            role="menu"
            tabIndex={-1}
            aria-orientation="vertical"
            style={{ left: coords.x, top: coords.y }}
            onKeyDown={onKeyDown}
            // Prevent native menu if someone right-clicks the menu itself.
            onContextMenu={(e) => e.preventDefault()}
          >
            {items.map((item, index) => {
              if (isSeparator(item)) {
                // eslint-disable-next-line react/no-array-index-key
                return <li key={`sep-${index}`} className={styles.separator} role="separator" />;
              }
              const isHighlighted = index === highlighted;
              const itemClass = [
                styles.item,
                isHighlighted ? styles.highlighted : "",
                item.danger ? styles.danger : "",
                item.disabled ? styles.disabled : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <li
                  key={item.id}
                  className={itemClass}
                  role="menuitem"
                  aria-disabled={item.disabled || undefined}
                  // Use mouseDown (not click) so the outside-mousedown listener
                  // doesn't fire first and close before selection.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (!item.disabled) selectIndex(index);
                  }}
                  onMouseEnter={() => {
                    if (!item.disabled) setHighlighted(index);
                  }}
                >
                  {item.icon !== undefined && (
                    <span className={styles.icon} aria-hidden="true">
                      {item.icon}
                    </span>
                  )}
                  <span className={styles.label}>{item.label}</span>
                </li>
              );
            })}
          </ul>,
          document.body,
        )
      : null;

  return { open, close, isOpen: state !== null, menu };
}

/**
 * USAGE EXAMPLE
 * -------------
 * import { useContextMenu, type MenuItem } from "./components/chrome/ContextMenu";
 * import { Copy, Trash2 } from "lucide-react";
 *
 * function SessionRow({ session }: { session: Session }) {
 *   const { open, menu } = useContextMenu();
 *
 *   const items: MenuItem[] = [
 *     { id: "rename", label: "Yeniden adlandır", icon: <Pencil size={14} />, onSelect: () => rename(session) },
 *     { id: "copy", label: "Kimliği kopyala", icon: <Copy size={14} />, onSelect: () => copyId(session.id) },
 *     { type: "separator" },
 *     { id: "delete", label: "Sil", icon: <Trash2 size={14} />, danger: true, onSelect: () => remove(session) },
 *   ];
 *
 *   return (
 *     <>
 *       <div
 *         onContextMenu={(e) => {
 *           e.preventDefault();      // suppress the native browser menu
 *           open(e, items);          // open at the cursor with these items
 *         }}
 *       >
 *         {session.title}
 *       </div>
 *       {menu}                       {/* portal target; renders null when closed *\/}
 *     </>
 *   );
 * }
 *
 * Notes:
 *  - `menu` is a portal to document.body, so place {menu} anywhere in the tree.
 *  - The hook owns open/close/position/highlight state; multiple instances are
 *    independent. Use one hook per surface, or share one and pass different
 *    `items` to open() per target.
 *  - Always call e.preventDefault() in onContextMenu to hide the native menu.
 */
