/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

// sideEffects: true — this module installs a MutationObserver on first call.

import { createGroupper } from "./groupper";
import { createMover } from "./mover";
import { createDeloser } from "./deloser";
import { createModalizer } from "./modalizer";
import { createRestorer, rememberRestorerTargetInteraction } from "./restorer";
import type { GroupperInstance } from "./groupper";
import type { MoverInstance } from "./mover";
import type { DeloserInstance } from "./deloser";
import type { ModalizerInstance } from "./modalizer";
import type { RestorerInstance } from "./restorer";

/** Supported lite module keys handled by the attribute observer. */
export type ModuleKey =
    | "groupper"
    | "mover"
    | "deloser"
    | "modalizer"
    | "restorer";

/** Configuration for the lite attribute observer bootstrap. */
export interface LiteObserverOptions {
    /** Root subtree observed for `data-tabster` changes. Defaults to `document.body`. */
    root?: HTMLElement;
    /** Subset of modules to wire automatically from parsed attributes. */
    modules?: ModuleKey[];
}

/** Controller returned by `createLiteObserver`. */
export interface LiteObserver {
    /** Disposes all wired instances and disconnects the MutationObserver. */
    dispose(): void;
    /** Returns the live instance for the given element and module, or null if none exists. */
    getInstance(element: HTMLElement, module: ModuleKey): AnyInstance | null;
}

type AnyInstance =
    | GroupperInstance
    | MoverInstance
    | DeloserInstance
    | ModalizerInstance
    | RestorerInstance;

const TABSTER_ATTR = "data-tabster";

function _parseJSON(value: string): Record<string, unknown> {
    try {
        return JSON.parse(value) as Record<string, unknown>;
    } catch {
        return {};
    }
}

function _parseTabsterAttr(el: HTMLElement): Record<string, unknown> {
    const value = el.getAttribute(TABSTER_ATTR);
    if (!value) {
        return {};
    }
    return _parseJSON(value);
}

function _createInstance(
    module: ModuleKey,
    element: HTMLElement,
    opts: Record<string, unknown>
): AnyInstance | null {
    switch (module) {
        case "groupper":
            return createGroupper(
                element,
                opts as Parameters<typeof createGroupper>[1]
            );
        case "mover":
            return createMover(
                element,
                opts as Parameters<typeof createMover>[1]
            );
        case "deloser":
            return createDeloser(
                element,
                opts as Parameters<typeof createDeloser>[1]
            );
        case "modalizer":
            return createModalizer(
                element,
                opts as Parameters<typeof createModalizer>[1]
            );
        case "restorer":
            return createRestorer(
                element,
                opts as unknown as Parameters<typeof createRestorer>[1]
            );
        default:
            return null;
    }
}

/** Creates a MutationObserver that wires lite modules from `data-tabster` attributes. */
export function createLiteObserver(
    options?: LiteObserverOptions
): LiteObserver {
    const root = options?.root ?? document.body;
    const ownerDocument = root.ownerDocument;
    const modules: ModuleKey[] = options?.modules ?? [
        "groupper",
        "mover",
        "deloser",
        "modalizer",
        "restorer",
    ];

    // element → { module → instance }
    const _instances = new WeakMap<HTMLElement, Map<ModuleKey, AnyInstance>>();
    // Track shadow roots already observed to avoid duplicate observe() calls.
    const _observedShadowRoots = new WeakSet<ShadowRoot>();

    function _getOrCreateMap(el: HTMLElement): Map<ModuleKey, AnyInstance> {
        let map = _instances.get(el);
        if (!map) {
            map = new Map();
            _instances.set(el, map);
        }
        return map;
    }

    function _mountElement(el: HTMLElement): void {
        const parsed = _parseTabsterAttr(el);
        // `focusable.ignoreKeydown` is a top-level sibling of mover/groupper in
        // the data-tabster JSON envelope. Merge it into mover/groupper opts so
        // those primitives can honour caller-provided keydown overrides.
        const focusable = parsed["focusable"] as
            | { ignoreKeydown?: Record<string, boolean> }
            | undefined;
        for (const mod of modules) {
            if (parsed[mod] !== undefined) {
                const map = _getOrCreateMap(el);
                if (!map.has(mod)) {
                    const baseOpts = (parsed[mod] ?? {}) as Record<
                        string,
                        unknown
                    >;
                    const opts =
                        (mod === "groupper" || mod === "mover") &&
                        focusable?.ignoreKeydown &&
                        baseOpts.ignoreKeydown === undefined
                            ? {
                                  ...baseOpts,
                                  ignoreKeydown: focusable.ignoreKeydown,
                              }
                            : baseOpts;
                    const instance = _createInstance(mod, el, opts);
                    if (instance) {
                        map.set(mod, instance);
                    }
                }
            }
        }
    }

    function _unmountModule(el: HTMLElement, mod: ModuleKey): void {
        const map = _instances.get(el);
        if (!map) {
            return;
        }
        const instance = map.get(mod);
        if (instance) {
            instance.dispose();
            map.delete(mod);
        }
        if (map.size === 0) {
            _instances.delete(el);
        }
    }

    function _unmountElement(el: HTMLElement): void {
        for (const mod of modules) {
            _unmountModule(el, mod);
        }
    }

    // Walk up the DOM, crossing shadow-root boundaries, to check containment.
    function _isDescendantOfRoot(node: Node | null): boolean {
        let cur = node;
        while (cur) {
            if (cur === root) {
                return true;
            }
            const parent = (cur as HTMLElement).parentElement;
            if (parent) {
                cur = parent;
            } else {
                const rootNode = cur.getRootNode();
                if (rootNode instanceof ShadowRoot) {
                    cur = rootNode.host;
                } else {
                    break;
                }
            }
        }
        return false;
    }

    function _mountFocusedPath(target: EventTarget | null): void {
        let el = target instanceof HTMLElement ? target : null;

        while (el && _isDescendantOfRoot(el)) {
            if (el.hasAttribute(TABSTER_ATTR)) {
                _mountElement(el);
            }
            // Walk up, crossing shadow-root boundaries when needed.
            const parent = el.parentElement;
            if (parent) {
                el = parent;
            } else {
                const rootNode = el.getRootNode();
                el =
                    rootNode instanceof ShadowRoot
                        ? (rootNode.host as HTMLElement)
                        : null;
            }
        }
    }

    // _mo is declared before _observeShadowRoot so the latter can call _mo.observe().
    // The callback references other functions via closure; those need not be defined yet
    // at MutationObserver construction time (only at callback invocation time).
    const _mo = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === "childList") {
                for (const node of Array.from(mutation.addedNodes)) {
                    if (!(node instanceof HTMLElement)) {
                        continue;
                    }
                    _scanAndObserveNode(node);
                }
                for (const node of Array.from(mutation.removedNodes)) {
                    if (!(node instanceof HTMLElement)) {
                        continue;
                    }
                    if (node.hasAttribute(TABSTER_ATTR)) {
                        _unmountElement(node);
                    }
                    const children = Array.from(
                        node.querySelectorAll(`[${TABSTER_ATTR}]`)
                    ) as HTMLElement[];
                    for (const child of children) {
                        _unmountElement(child);
                    }
                }
            } else if (mutation.type === "attributes") {
                const el = mutation.target as HTMLElement;
                if (mutation.attributeName !== TABSTER_ATTR) {
                    continue;
                }

                if (el.hasAttribute(TABSTER_ATTR)) {
                    // Diff modules: dispose ones removed, mount ones added,
                    // remount ones whose JSON value changed.
                    const parsed = _parseTabsterAttr(el);
                    const focusable = parsed["focusable"] as
                        | { ignoreKeydown?: Record<string, boolean> }
                        | undefined;
                    const existing = _instances.get(el);
                    for (const mod of modules) {
                        const next = parsed[mod];
                        const had = existing?.has(mod) ?? false;
                        if (next === undefined && had) {
                            _unmountModule(el, mod);
                        } else if (next !== undefined) {
                            // Always remount when attribute mutates — we
                            // don't track previous opts, so re-create.
                            _unmountModule(el, mod);
                            const baseOpts = (next ?? {}) as Record<
                                string,
                                unknown
                            >;
                            const opts =
                                (mod === "groupper" || mod === "mover") &&
                                focusable?.ignoreKeydown &&
                                baseOpts.ignoreKeydown === undefined
                                    ? {
                                          ...baseOpts,
                                          ignoreKeydown:
                                              focusable.ignoreKeydown,
                                      }
                                    : baseOpts;
                            const instance = _createInstance(mod, el, opts);
                            if (instance) {
                                _getOrCreateMap(el).set(mod, instance);
                            }
                        }
                    }
                } else {
                    _unmountElement(el);
                }
            }
        }
    });

    // Begin observing a shadow root (if not already observed) and scan its content.
    function _observeShadowRoot(shadowRoot: ShadowRoot): void {
        if (_observedShadowRoots.has(shadowRoot)) {
            return;
        }
        _observedShadowRoots.add(shadowRoot);
        _mo.observe(shadowRoot, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [TABSTER_ATTR],
        });
        // Scan existing data-tabster elements inside the shadow root.
        const els = Array.from(
            shadowRoot.querySelectorAll(`[${TABSTER_ATTR}]`)
        ) as HTMLElement[];
        for (const el of els) {
            _mountElement(el);
        }
        // Recursively observe any nested shadow roots already present.
        const all = Array.from(shadowRoot.querySelectorAll("*"));
        for (const el of all) {
            const elShadow = (el as HTMLElement).shadowRoot;
            if (elShadow) {
                _observeShadowRoot(elShadow);
            }
        }
    }

    // Scan an element and its subtree, also observing any shadow roots found.
    function _scanAndObserveNode(node: HTMLElement): void {
        if (node.hasAttribute(TABSTER_ATTR)) {
            _mountElement(node);
        }
        const children = Array.from(
            node.querySelectorAll(`[${TABSTER_ATTR}]`)
        ) as HTMLElement[];
        for (const child of children) {
            _mountElement(child);
        }
        if (node.shadowRoot) {
            _observeShadowRoot(node.shadowRoot);
        }
        // Also look for shadow hosts nested in the subtree.
        const shadowHosts = Array.from(node.querySelectorAll("*"));
        for (const el of shadowHosts) {
            const elShadow = (el as HTMLElement).shadowRoot;
            if (elShadow) {
                _observeShadowRoot(elShadow);
            }
        }
    }

    _mo.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [TABSTER_ATTR],
    });

    // Initial scan of existing data-tabster elements and shadow roots.
    {
        const els = Array.from(
            root.querySelectorAll(`[${TABSTER_ATTR}]`)
        ) as HTMLElement[];
        for (const el of els) {
            _mountElement(el);
        }
        const shadowHosts = Array.from(root.querySelectorAll("*"));
        for (const el of shadowHosts) {
            const elShadow = (el as HTMLElement).shadowRoot;
            if (elShadow) {
                _observeShadowRoot(elShadow);
            }
        }
    }

    const _onFocusIn = (event: FocusEvent) => {
        // composedPath()[0] gives the actual focused element inside shadow roots;
        // document-level event.target is retargeted to the shadow host.
        const composed = event.composedPath?.();
        const target =
            composed && composed.length > 0 ? composed[0] : event.target;
        _mountFocusedPath(target);
    };

    const _rememberRestorerTargetFromEvent = (
        eventTarget: EventTarget | null
    ) => {
        let el = eventTarget instanceof HTMLElement ? eventTarget : null;
        while (el && _isDescendantOfRoot(el)) {
            const parsed = _parseTabsterAttr(el);
            const restorer = parsed["restorer"] as
                | { type?: number; id?: string }
                | undefined;

            if (restorer?.type === 1) {
                rememberRestorerTargetInteraction(el, restorer.id);
                break;
            }

            el = el.parentElement;
        }
    };

    const _getComposedTarget = (event: Event): HTMLElement | null => {
        const composed = event.composedPath?.();
        const target =
            composed && composed.length > 0 ? composed[0] : event.target;
        return target instanceof HTMLElement ? target : null;
    };

    const _onPointerDown = (event: PointerEvent) => {
        const target = _getComposedTarget(event);
        _mountFocusedPath(target);
        _rememberRestorerTargetFromEvent(target);
    };

    const _onMouseDown = (event: MouseEvent) => {
        const target = _getComposedTarget(event);
        _mountFocusedPath(target);
        _rememberRestorerTargetFromEvent(target);
    };

    ownerDocument.addEventListener("focusin", _onFocusIn);
    ownerDocument.addEventListener("pointerdown", _onPointerDown, true);
    ownerDocument.addEventListener("mousedown", _onMouseDown, true);

    function dispose(): void {
        _mo.disconnect();
        ownerDocument.removeEventListener("focusin", _onFocusIn);
        ownerDocument.removeEventListener("pointerdown", _onPointerDown, true);
        ownerDocument.removeEventListener("mousedown", _onMouseDown, true);
        const els = Array.from(
            root.querySelectorAll(`[${TABSTER_ATTR}]`)
        ) as HTMLElement[];
        for (const el of els) {
            _unmountElement(el);
        }
    }

    function getInstance(
        element: HTMLElement,
        module: ModuleKey
    ): AnyInstance | null {
        return _instances.get(element)?.get(module) ?? null;
    }

    return { dispose, getInstance };
}
