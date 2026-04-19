/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import type { DOMAPI } from "../Types";
import {
    ModalizerActiveEventName,
    ModalizerInactiveEventName,
} from "../Events";
import { findAll, findDefault, findFirst } from "./focusable";

const TABSTER_ATTR = "data-tabster";

/**
 * Returns a CSS selector that matches elements whose data-tabster JSON
 * envelope contains the given key (e.g. `_tabsterAttrSelector("modalizer")`
 * → `[data-tabster*='"modalizer":']`).
 */
function _tabsterAttrSelector(key: string): string {
    return `[${TABSTER_ATTR}*='"${key}":']`;
}

/** Cheap check: does the element's data-tabster JSON envelope contain this key? */
function _hasTabsterKey(el: Element, key: string): boolean {
    const value = el.getAttribute(TABSTER_ATTR);
    if (!value) {
        return false;
    }
    return value.indexOf(`"${key}":`) !== -1;
}

/** Configuration used to create a lite modalizer instance. */
export interface ModalizerOptions {
    /** Optional modalizer id used for correlation with other modules/components. */
    id?: string;
    /** When true and the element is a dialog, uses native dialog modal behavior. */
    useDialog?: boolean;
    /** Optional initial target (selector/callback) to focus on activation. */
    initialFocus?: string | ((container: HTMLElement) => HTMLElement | null);
    /** Optional target used when restoring focus on deactivation/dispose. */
    restoreFocusTo?: HTMLElement | (() => HTMLElement | null);
    /** Escape-key callback fired before optional auto-close handling. */
    onEscape?: (event: KeyboardEvent) => void;
    /** When true, Escape closes the modalizer unless prevented by callback logic. */
    closeOnEscape?: boolean;
    /** Reserved for API parity with full Tabster. */
    allowNested?: boolean;
    /** When true, outside content remains accessible while modalizer is active. */
    isOthersAccessible?: boolean;
    /**
     * When true, a keydown Tab-trap listener is added so focus cannot leave via
     * Tab even to browser chrome (legacy "force trap" behaviour).
     */
    isTrapped?: boolean;
    /**
     * When true, this modalizer container is always accessible even when other
     * modals are active. In lite this is handled by skipping sibling subtrees
     * whose data-tabster JSON contains a modalizer key during inert application.
     */
    isAlwaysAccessible?: boolean;
    /**
     * Called for each sibling that would otherwise be made inert.
     * Return true to keep the element accessible (e.g. elements with a "never-hidden" attribute).
     */
    accessibleCheck?: (element: HTMLElement) => boolean;
    /** When true, activation does not force initial focus movement. */
    isNoFocusFirst?: boolean;
    /** When true, skips preferred-default focus lookup during activation. */
    isNoFocusDefault?: boolean;
    /** Reserved for API parity with full Tabster. */
    domAPI?: DOMAPI;
}

/** Runtime API exposed by a lite modalizer bound to a container element. */
export interface ModalizerInstance {
    /** Container element that owns this modalizer instance. */
    readonly element: HTMLElement;
    /** Optional modalizer id configured on creation. */
    readonly id: string | undefined;
    /** Whether the modalizer is currently active. */
    readonly isActive: boolean;
    /**
     * Activate the modal trap.
     * @param restoreTarget - Element to return focus to on deactivate/dispose.
     *   If omitted, document.activeElement is captured at the time of the call.
     */
    activate(restoreTarget?: HTMLElement | null): void;
    /** Deactivates the modalizer and performs optional focus restoration. */
    deactivate(): void;
    /** Disposes listeners and deactivates if currently active. */
    dispose(): void;
}

// Track elements whose `inert` was set by this instance (not pre-existing)
type InertRecord = WeakMap<HTMLElement, boolean>; // value: was inert before we touched it

let _lastFocusRelatedTarget: HTMLElement | null = null;
let _globalFocusTrackerInitialized = false;

function _ensureGlobalFocusTracker(doc: Document): void {
    if (_globalFocusTrackerInitialized) {
        return;
    }

    doc.addEventListener(
        "focusin",
        (e) => {
            const related = (e as FocusEvent)
                .relatedTarget as HTMLElement | null;
            if (related) {
                _lastFocusRelatedTarget = related;
            }
        },
        true
    );

    _globalFocusTrackerInitialized = true;
}

/** Creates modal focus-management behavior for a container using lite semantics. */
export function createModalizer(
    element: HTMLElement,
    options?: ModalizerOptions
): ModalizerInstance {
    const id = options?.id;
    const useDialog = options?.useDialog ?? false;
    const closeOnEscape = options?.closeOnEscape ?? true;
    const isOthersAccessible = options?.isOthersAccessible ?? false;
    const isTrapped = options?.isTrapped ?? false;
    const accessibleCheck = options?.accessibleCheck;
    const role = element.getAttribute("role");
    const isNonModalDialogLike =
        role === "dialog" && element.getAttribute("aria-modal") !== "true";

    let _active = false;
    let _restoreTarget: HTMLElement | null = null;
    // Set to true while activate() is being triggered by the auto-focusin listener.
    // Used to skip restoreTarget overwrite and focus-movement in that code path.
    let _activatingFromFocusIn = false;
    // Per-instance map of elements we marked inert and whether they had inert before
    let _inertMap: InertRecord = new WeakMap();
    // Keep strong refs to all elements we touched so we can iterate them
    let _inertElements: HTMLElement[] = [];

    // Tab-trap listener (for isTrapped mode)
    let _tabTrapListener: ((e: KeyboardEvent) => void) | null = null;

    // Tab-out dummy (for non-trap modalizers, isOthersAccessible=true).
    // A focusable sibling placed immediately AFTER the modalizer element so that
    // pressing Tab from the last inner focusable lands on a real DOM element
    // (instead of going to <body>). This guarantees the original element's
    // focusout fires with a non-null relatedTarget, allowing consumers
    // (e.g. PopoverSurface) to detect Tab-out via blur handlers and close.
    // The dummy itself, on focus, redirects to the next document focusable
    // outside the modalizer (or blurs to body if none exists).
    let _tabOutSentinel: HTMLElement | null = null;
    let _dialogCancelListener: ((e: Event) => void) | null = null;
    let _moverDummies: HTMLElement[] = [];

    function _createDummy(doc: Document): HTMLElement {
        const dummy = doc.createElement("i");
        dummy.tabIndex = 0;
        dummy.setAttribute("data-tabster-dummy", "");
        dummy.setAttribute("aria-hidden", "true");
        dummy.setAttribute("role", "none");
        dummy.style.cssText =
            "position: fixed; height: 1px; width: 1px; opacity: 0.001; z-index: -1; content-visibility: hidden; top: 0px; left: 0px;";
        return dummy;
    }

    function _ensureMoverDummies(): void {
        const moverContainers = Array.from(
            element.ownerDocument.body.querySelectorAll<HTMLElement>(
                _tabsterAttrSelector("mover")
            )
        );

        for (const container of moverContainers) {
            const first = _createDummy(element.ownerDocument);
            const last = _createDummy(element.ownerDocument);

            container.insertBefore(first, container.firstChild);
            container.appendChild(last);
            _moverDummies.push(first, last);
        }
    }

    function _removeMoverDummies(): void {
        for (const dummy of _moverDummies) {
            dummy.remove();
        }
        _moverDummies = [];
    }
    function _onTabOutSentinelFocus(): void {
        const sentinel = _tabOutSentinel;
        if (!sentinel) {
            return;
        }
        const all = findAll({
            container: element.ownerDocument.body as HTMLElement,
            includeProgrammaticallyFocusable: false,
        });
        const next = all.find((el) => {
            if (el === sentinel) {
                return false;
            }
            if (element.contains(el)) {
                return false;
            }
            return !!(
                sentinel.compareDocumentPosition(el) &
                Node.DOCUMENT_POSITION_FOLLOWING
            );
        });
        if (next) {
            next.focus();
        } else {
            sentinel.blur();
        }
    }
    function _ensureTabOutSentinel(): void {
        if (_tabOutSentinel) {
            return;
        }
        if (!isOthersAccessible || isNonModalDialogLike) {
            return;
        }
        const parent = element.parentElement;
        if (!parent) {
            return;
        }
        const sentinel = element.ownerDocument.createElement("i");
        sentinel.tabIndex = 0;
        sentinel.setAttribute("data-tabster-dummy", "");
        sentinel.setAttribute("aria-hidden", "true");
        sentinel.setAttribute("role", "none");
        sentinel.style.cssText =
            "position:fixed;height:1px;width:1px;opacity:0.001;z-index:-1;content-visibility:hidden;top:0;left:0;";
        sentinel.addEventListener("focus", _onTabOutSentinelFocus);
        parent.insertBefore(sentinel, element.nextSibling);
        _tabOutSentinel = sentinel;
    }
    function _removeTabOutSentinel(): void {
        const sentinel = _tabOutSentinel;
        if (!sentinel) {
            return;
        }
        _tabOutSentinel = null;
        sentinel.removeEventListener("focus", _onTabOutSentinelFocus);
        sentinel.remove();
    }

    function _resolveInitialFocus(): HTMLElement | null {
        const ini = options?.initialFocus;
        if (typeof ini === "function") {
            return ini(element);
        }
        if (typeof ini === "string") {
            return element.querySelector(ini) as HTMLElement | null;
        }
        return null;
    }

    function _applyInert(): void {
        // Walk ancestor chain from element up to document.body
        const path = new Set<HTMLElement>();
        let cur: HTMLElement | null = element;
        while (cur && cur !== document.body) {
            path.add(cur);
            cur = cur.parentElement;
        }
        path.add(document.body);

        // For each node in path (including element), set inert on siblings NOT in path
        for (const ancestor of path) {
            const parent = ancestor.parentElement;
            if (!parent) {
                continue;
            }

            for (let i = 0; i < parent.children.length; i++) {
                const sibling = parent.children[i] as HTMLElement;
                if (path.has(sibling)) {
                    continue;
                }
                // Keep other modalizer containers accessible for nested/sibling stacks.
                if (
                    _hasTabsterKey(sibling, "modalizer") ||
                    !!sibling.querySelector(_tabsterAttrSelector("modalizer"))
                ) {
                    continue;
                }
                // Skip elements explicitly marked as never-hidden (useDangerousNeverHidden_unstable).
                if (
                    sibling.hasAttribute("data-tabster-never-hide") ||
                    !!sibling.querySelector("[data-tabster-never-hide]")
                ) {
                    continue;
                }
                // Skip elements the caller wants to keep accessible (e.g. DangerousNeverHidden).
                if (accessibleCheck?.(sibling)) {
                    continue;
                }

                const wasAlreadyInert =
                    (sibling as HTMLElement & { inert?: boolean }).inert ===
                    true;
                if (!wasAlreadyInert) {
                    (sibling as HTMLElement & { inert: boolean }).inert = true;
                    _inertMap.set(sibling, false); // we set it; it wasn't inert before
                    _inertElements.push(sibling);
                }
                // If already inert, leave it alone (and don't record it)
            }
        }
    }

    function _removeInert(): void {
        for (const el of _inertElements) {
            const wasInertBefore = _inertMap.get(el);
            if (wasInertBefore === false) {
                // We set inert on it; remove it
                (el as HTMLElement & { inert: boolean }).inert = false;
            }
        }
        _inertElements = [];
        _inertMap = new WeakMap();
    }

    function _onKeyDown(e: KeyboardEvent): void {
        if (e.defaultPrevented) {
            return;
        }

        if (e.key === "Escape") {
            if (isNonModalDialogLike) {
                return;
            }

            if (options?.onEscape) {
                options.onEscape(e);
            }
            if (e.defaultPrevented) {
                return;
            }
            if (closeOnEscape) {
                deactivate();
            }
        }
    }

    function _resolveRestoreTarget(
        relatedTarget: HTMLElement | null,
        currentTargetInsideModal?: HTMLElement | null
    ): HTMLElement | null {
        if (relatedTarget && !element.contains(relatedTarget)) {
            return relatedTarget;
        }

        // For non-modal/modalizers that keep outside content accessible,
        // avoid global fallbacks that can interfere with nested components
        // (e.g. Popover/Menu restore focus behavior).
        if (isOthersAccessible && !isNonModalDialogLike) {
            if (
                _lastFocusRelatedTarget &&
                _lastFocusRelatedTarget.isConnected &&
                _hasTabsterKey(_lastFocusRelatedTarget, "restorer")
            ) {
                return _lastFocusRelatedTarget;
            }

            return null;
        }

        if (
            _lastFocusRelatedTarget &&
            !_lastFocusRelatedTarget.contains(element) &&
            !element.contains(_lastFocusRelatedTarget) &&
            _lastFocusRelatedTarget.isConnected
        ) {
            return _lastFocusRelatedTarget;
        }

        if (
            currentTargetInsideModal &&
            currentTargetInsideModal.ownerDocument.activeElement instanceof
                HTMLElement
        ) {
            const active = currentTargetInsideModal.ownerDocument
                .activeElement as HTMLElement;
            if (!element.contains(active)) {
                return active;
            }
        }

        return null;
    }

    function activate(restoreTarget?: HTMLElement | null): void {
        if (_active) {
            return;
        }

        // When auto-activated by focusin, _restoreTarget was pre-set to e.relatedTarget
        // (the element that had focus before entering the container — e.g. the trigger button).
        // For explicit activate() calls, use the provided restoreTarget, or fall back to
        // document.activeElement.
        if (!_activatingFromFocusIn) {
            _restoreTarget =
                restoreTarget !== undefined
                    ? restoreTarget
                    : (document.activeElement as HTMLElement | null);
        }
        _active = true;
        _ensureMoverDummies();

        if (useDialog && element instanceof HTMLDialogElement) {
            (element as HTMLDialogElement).showModal();

            if (closeOnEscape && !_dialogCancelListener) {
                _dialogCancelListener = (e: Event) => {
                    e.preventDefault();
                    if (options?.onEscape) {
                        options.onEscape(e as unknown as KeyboardEvent);
                    }
                    deactivate();
                };
                element.addEventListener("cancel", _dialogCancelListener);
            }
        } else {
            if (!isOthersAccessible) {
                _applyInert();
            }

            // Keyboard Tab-trap: intercept Tab so focus cannot leave even to browser chrome.
            if (isTrapped && !isOthersAccessible) {
                _tabTrapListener = (e: KeyboardEvent) => {
                    if (e.key !== "Tab") {
                        return;
                    }
                    const focusables = findAll({ container: element });
                    if (focusables.length === 0) {
                        return;
                    }
                    const first = focusables[0];
                    const last = focusables[focusables.length - 1];
                    const active = document.activeElement as HTMLElement | null;
                    if (e.shiftKey) {
                        if (active === first || !element.contains(active)) {
                            e.preventDefault();
                            last.focus();
                        }
                    } else {
                        if (active === last || !element.contains(active)) {
                            e.preventDefault();
                            first.focus();
                        }
                    }
                };
                document.addEventListener("keydown", _tabTrapListener, true);
            }

            _ensureTabOutSentinel();
        }

        element.addEventListener("keydown", _onKeyDown);

        element.dispatchEvent(
            new CustomEvent(ModalizerActiveEventName, {
                bubbles: true,
                composed: true,
                detail: { id: id ?? "", element },
            })
        );

        // Move focus into the modal unless opted out or unless we were triggered by a
        // focusin event (in which case focus has already arrived inside the container).
        if (!_activatingFromFocusIn && !options?.isNoFocusFirst) {
            let toFocus: HTMLElement | null = null;

            toFocus = _resolveInitialFocus();

            if (!toFocus && !options?.isNoFocusDefault) {
                toFocus = findDefault({ container: element });
            }

            if (!toFocus) {
                toFocus = findFirst({ container: element });
            }

            toFocus?.focus();
        }
    }

    function deactivate(): void {
        if (!_active) {
            return;
        }

        _active = false;

        element.removeEventListener("keydown", _onKeyDown);

        if (useDialog && element instanceof HTMLDialogElement) {
            if (_dialogCancelListener) {
                element.removeEventListener("cancel", _dialogCancelListener);
                _dialogCancelListener = null;
            }
            (element as HTMLDialogElement).close();
        } else {
            if (!isOthersAccessible) {
                _removeInert();
            }

            if (_tabTrapListener) {
                document.removeEventListener("keydown", _tabTrapListener, true);
                _tabTrapListener = null;
            }

            _removeTabOutSentinel();
            _removeMoverDummies();
        }

        element.dispatchEvent(
            new CustomEvent(ModalizerInactiveEventName, {
                bubbles: true,
                composed: true,
                detail: { id: id ?? "", element },
            })
        );

        // Restore focus.
        // Only restore if the user hasn't already explicitly moved focus
        // to another element outside the modalizer. We detect "user-moved
        // focus out" by checking document.activeElement at deactivate time:
        //   - null / body            → focus was implicitly lost (e.g. the
        //                              focused descendant was removed from
        //                              the DOM when the modal closed) →
        //                              safe to restore.
        //   - inside element         → focus is still within the
        //                              (now-detaching) modal → restore so
        //                              the user returns to the trigger
        //                              (common Escape/click-item flows).
        //   - other element outside  → user deliberately tabbed/clicked
        //                              away → respect that and skip
        //                              restoration.
        const rf = options?.restoreFocusTo;
        const restoreTo = rf
            ? typeof rf === "function"
                ? rf()
                : rf
            : _restoreTarget;

        const active = document.activeElement as HTMLElement | null;
        const userMovedFocusOutside =
            active !== null &&
            active !== document.body &&
            active !== document.documentElement &&
            !element.contains(active);

        if (!userMovedFocusOutside && restoreTo && restoreTo.isConnected) {
            restoreTo.focus();
        }

        _restoreTarget = null;
    }

    // Auto-activation: mirrors full tabster's behaviour where focus entering a modalizer
    // container automatically activates the trap.  This means components like Dialog do
    // not need to call useActivateModal explicitly — moving focus into the container is
    // sufficient (e.g. via useFocusFirstElement).
    //
    // We capture e.relatedTarget (the previously focused element) as the restore target so
    // that deactivation later returns focus to the trigger, not to an element inside the modal.
    //
    // The listener is kept alive across deactivate() calls so re-opening the same element
    // (unmountOnClose=false) re-activates correctly.  It is only removed on dispose().
    //
    // We attach to the ownerDocument rather than the element with capture:true so the listener
    // fires reliably in all environments (including Cypress / CDP-driven tests where element-level
    // capture listeners can be missed).
    function _onFocusInAutoActivate(e: FocusEvent): void {
        if (_active) {
            return;
        }
        // Use composedPath()[0] to get the actual focused element inside shadow roots;
        // document-level event.target is retargeted to the shadow host.
        const composed = e.composedPath?.();
        const target = (
            composed && composed.length > 0 ? composed[0] : e.target
        ) as HTMLElement;
        // Only react when focus arrives INSIDE the container from OUTSIDE.
        if (!element.contains(target)) {
            return;
        }
        const relatedTarget = e.relatedTarget as HTMLElement | null;
        if (relatedTarget && element.contains(relatedTarget)) {
            return;
        }

        _restoreTarget = _resolveRestoreTarget(relatedTarget, target);
        _activatingFromFocusIn = true;
        activate();
        _activatingFromFocusIn = false;
    }

    const _doc = element.ownerDocument;
    _ensureGlobalFocusTracker(_doc);
    _doc.addEventListener("focusin", _onFocusInAutoActivate, true);

    // If focus has already entered this modalizer before the instance was mounted
    // (possible due to async observer wiring), activate immediately. This ensures
    // non-modal modalizers (e.g. Popover with isOthersAccessible=true) still set
    // up _restoreTarget so focus is returned to the trigger on close.
    // Use deep active element to handle shadow DOM: document.activeElement is
    // retargeted to the shadow host when focus is inside a shadow root.
    let currentlyFocused: HTMLElement | null =
        _doc.activeElement as HTMLElement | null;
    while (currentlyFocused?.shadowRoot?.activeElement) {
        currentlyFocused =
            currentlyFocused.shadowRoot.activeElement as HTMLElement | null;
    }
    if (currentlyFocused && element.contains(currentlyFocused)) {
        _restoreTarget = _resolveRestoreTarget(null, currentlyFocused);
        _activatingFromFocusIn = true;
        activate();
        _activatingFromFocusIn = false;
    }

    function dispose(): void {
        if (_active) {
            deactivate();
        }
        _doc.removeEventListener("focusin", _onFocusInAutoActivate, true);
    }

    return {
        get element() {
            return element;
        },
        get id() {
            return id;
        },
        get isActive() {
            return _active;
        },
        activate,
        deactivate,
        dispose,
    };
}
