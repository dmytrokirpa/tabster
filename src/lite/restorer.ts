/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import type { DOMAPI, RestorerType } from "../Types";
import { RestorerTypes } from "../Consts";
export { RestorerTypes } from "../Consts";
export type { RestorerType } from "../Types";

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

// ---- Module-level history stack ----

interface TargetEntry {
    ref: WeakRef<HTMLElement>;
    id: string | undefined;
}

const _MAX_HISTORY = 10;
const _targetHistory: TargetEntry[] = [];
let _lastInteractedTarget: TargetEntry | null = null;

function _pushTarget(el: HTMLElement, id: string | undefined): void {
    const existing = _targetHistory.findIndex(
        (entry) => entry.ref.deref() === el
    );
    if (existing !== -1) {
        _targetHistory.splice(existing, 1);
    }

    _targetHistory.push({ ref: new WeakRef(el), id });

    if (_targetHistory.length > _MAX_HISTORY) {
        _targetHistory.shift();
    }
}

function _popTarget(id: string | undefined): HTMLElement | null {
    for (let i = _targetHistory.length - 1; i >= 0; i--) {
        const entry = _targetHistory[i];
        if (entry.id === id) {
            const el = entry.ref.deref();
            _targetHistory.splice(i, 1);
            if (el) {
                return el;
            }
        }
    }

    return null;
}

function _rememberInteractedTarget(
    el: HTMLElement,
    id: string | undefined
): void {
    _lastInteractedTarget = { ref: new WeakRef(el), id };
}

export function rememberRestorerTargetInteraction(
    el: HTMLElement,
    id: string | undefined
): void {
    _rememberInteractedTarget(el, id);
}

function _takeInteractedTarget(id: string | undefined): HTMLElement | null {
    const entry = _lastInteractedTarget;

    if (!entry || entry.id !== id) {
        return null;
    }

    const el = entry.ref.deref() ?? null;
    _lastInteractedTarget = null;

    return el;
}

// Track whether a pointer click is happening so we skip focus restoration.
let _pointerActive = false;

if (typeof document !== "undefined") {
    document.addEventListener("pointerdown", () => {
        _pointerActive = true;
    });
    document.addEventListener("pointerup", () => {
        Promise.resolve().then(() => {
            _pointerActive = false;
        });
    });
}

function _restoreTargetFocus(id: string | undefined): void {
    setTimeout(() => {
        if (_pointerActive) {
            return;
        }

        const active = document.activeElement as HTMLElement | null;
        const interactedTarget = _takeInteractedTarget(id);

        if (interactedTarget?.isConnected && active !== interactedTarget) {
            interactedTarget.focus();
            return;
        }

        const isFocusLost =
            !active ||
            active === document.body ||
            active === document.documentElement ||
            !active.isConnected;

        if (!isFocusLost) {
            return;
        }

        _popTarget(id)?.focus();
    }, 0);
}

/** Creates a lite restorer source/target instance for focus handoff. */
export function createRestorer(
    element: HTMLElement,
    options: RestorerOptions
): RestorerInstance {
    const type = options.type;
    const id = options.id;

    let _disposed = false;
    let _hasFocus = element.contains(document.activeElement);

    if (type === RestorerTypes.Target) {
        function _onFocusIn(): void {
            if (!_disposed) {
                _pushTarget(element, id);
            }
        }

        function _onPointerDown(): void {
            if (!_disposed) {
                _rememberInteractedTarget(element, id);
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

        if (_pointerActive) {
            return;
        }

        if (!related) {
            _restoreTargetFocus(id);
        }
    }

    element.addEventListener("focusin", _onFocusIn);
    element.addEventListener("focusout", _onFocusOut);

    function dispose(): void {
        _disposed = true;
        element.removeEventListener("focusin", _onFocusIn);
        element.removeEventListener("focusout", _onFocusOut);

        if (_hasFocus) {
            _restoreTargetFocus(id);
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
