/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import type { DOMAPI, RestorerType } from "../Types";
import { RestorerTypes } from "../Consts";
export { RestorerTypes } from "../Consts";
export type { RestorerType } from "../Types";

const _WeakRef: WeakRefConstructor =
    typeof WeakRef !== "undefined"
        ? WeakRef
        : (class<T extends object> {
              private _t: T;
              constructor(t: T) {
                  this._t = t;
              }
              deref(): T {
                  return this._t;
              }
          } as unknown as WeakRefConstructor);

/** Configuration used to create a lite restorer instance. */
export interface RestorerOptions {
    /** Restorer role for the element (`Source` or `Target`). */
    type: RestorerType;
    /** Optional id used to pair sources with matching targets. */
    id?: string;
    /** Reserved for API parity with full Tabster. */
    domAPI?: DOMAPI;
}

/** Runtime API exposed by a lite restorer bound to a source/target element. */
export interface RestorerInstance {
    /** Element that owns this restorer instance. */
    readonly element: HTMLElement;
    /** Role configured for this instance. */
    readonly type: RestorerType;
    /** Disposes listeners and detaches the restorer behavior. */
    dispose(): void;
}

// ---- Per-document history state ----
// All mutable state is scoped to the owning Document so that multiple
// documents / iframes do not share history or pointer-active flags.

interface TargetEntry {
    ref: WeakRef<HTMLElement>;
    id: string | undefined;
}

interface _DocState {
    targetHistory: TargetEntry[];
    lastInteractedTarget: TargetEntry | null;
    pointerActive: boolean;
}

const _MAX_HISTORY = 10;
const _docState = new WeakMap<Document, _DocState>();

function _getDocState(doc: Document): _DocState {
    let state = _docState.get(doc);
    if (!state) {
        state = {
            targetHistory: [],
            lastInteractedTarget: null,
            pointerActive: false,
        };
        _docState.set(doc, state);
        doc.addEventListener("pointerdown", () => {
            state!.pointerActive = true;
        });
        doc.addEventListener("pointerup", () => {
            Promise.resolve().then(() => {
                state!.pointerActive = false;
            });
        });
    }
    return state;
}

function _pushTarget(
    doc: Document,
    el: HTMLElement,
    id: string | undefined
): void {
    const state = _getDocState(doc);
    const existing = state.targetHistory.findIndex(
        (entry) => entry.ref.deref() === el
    );
    if (existing !== -1) {
        state.targetHistory.splice(existing, 1);
    }
    state.targetHistory.push({ ref: new _WeakRef(el), id });
    if (state.targetHistory.length > _MAX_HISTORY) {
        state.targetHistory.shift();
    }
}

function _popTarget(
    doc: Document,
    id: string | undefined
): HTMLElement | null {
    const { targetHistory } = _getDocState(doc);
    for (let i = targetHistory.length - 1; i >= 0; i--) {
        const entry = targetHistory[i];
        if (entry.id === id) {
            const el = entry.ref.deref();
            targetHistory.splice(i, 1);
            if (el) {
                return el;
            }
        }
    }
    return null;
}

function _rememberInteractedTarget(
    doc: Document,
    el: HTMLElement,
    id: string | undefined
): void {
    _getDocState(doc).lastInteractedTarget = { ref: new _WeakRef(el), id };
}

export function rememberRestorerTargetInteraction(
    el: HTMLElement,
    id: string | undefined
): void {
    _rememberInteractedTarget(el.ownerDocument, el, id);
}

function _takeInteractedTarget(
    doc: Document,
    id: string | undefined
): HTMLElement | null {
    const state = _getDocState(doc);
    const entry = state.lastInteractedTarget;
    if (!entry || entry.id !== id) {
        return null;
    }
    const el = entry.ref.deref() ?? null;
    state.lastInteractedTarget = null;
    return el;
}

// Returns the deepest focused element, drilling into open shadow roots.
// document.activeElement is retargeted to the shadow host when focus is
// inside a shadow root; the actual focused element lives deeper.
function _getDeepActiveElement(doc: Document): HTMLElement | null {
    let el: Element | null = doc.activeElement;
    while (el?.shadowRoot) {
        const shadowActive = el.shadowRoot.activeElement;
        if (!shadowActive) {
            // Focus is on the shadow host itself with no shadow-root child focused.
            // Treat this as focus lost (host received focus because its focused
            // descendant was removed).
            return null;
        }
        el = shadowActive;
    }
    return el as HTMLElement | null;
}

function _restoreTargetFocus(
    doc: Document,
    id: string | undefined
): void {
    setTimeout(() => {
        if (_getDocState(doc).pointerActive) {
            return;
        }

        const active = _getDeepActiveElement(doc);
        const interactedTarget = _takeInteractedTarget(doc, id);

        if (interactedTarget?.isConnected && active !== interactedTarget) {
            interactedTarget.focus();
            return;
        }

        const isFocusLost =
            !active ||
            active === doc.body ||
            active === doc.documentElement ||
            !active.isConnected;

        if (!isFocusLost) {
            return;
        }

        _popTarget(doc, id)?.focus();
    }, 0);
}

/** Creates a lite restorer source/target instance for focus handoff. */
export function createRestorer(
    element: HTMLElement,
    options: RestorerOptions
): RestorerInstance {
    const type = options.type;
    const id = options.id;
    const doc = element.ownerDocument;

    let _disposed = false;
    let _hasFocus = element.contains(doc.activeElement);

    if (type === RestorerTypes.Target) {
        function _onFocusIn(): void {
            if (!_disposed) {
                _pushTarget(doc, element, id);
            }
        }

        function _onPointerDown(): void {
            if (!_disposed) {
                _rememberInteractedTarget(doc, element, id);
            }
        }

        element.addEventListener("focusin", _onFocusIn);
        element.addEventListener("pointerdown", _onPointerDown);

        function dispose(): void {
            _disposed = true;
            element.removeEventListener("focusin", _onFocusIn);
            element.removeEventListener("pointerdown", _onPointerDown);
        }

        return {
            get element() {
                return element;
            },
            get type() {
                return type;
            },
            dispose,
        };
    }

    function _onFocusIn(): void {
        if (!_disposed) {
            _hasFocus = true;
        }
    }

    function _onFocusOut(e: FocusEvent): void {
        if (_disposed) {
            return;
        }

        const related = e.relatedTarget as HTMLElement | null;
        if (!related || !element.contains(related)) {
            _hasFocus = false;
        }

        if (_getDocState(doc).pointerActive) {
            return;
        }

        if (!related) {
            _restoreTargetFocus(doc, id);
        }
    }

    element.addEventListener("focusin", _onFocusIn);
    element.addEventListener("focusout", _onFocusOut);

    function dispose(): void {
        _disposed = true;
        element.removeEventListener("focusin", _onFocusIn);
        element.removeEventListener("focusout", _onFocusOut);

        if (_hasFocus) {
            _restoreTargetFocus(doc, id);
        }
    }

    return {
        get element() {
            return element;
        },
        get type() {
            return type;
        },
        dispose,
    };
}
