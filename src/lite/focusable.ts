/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { FOCUSABLE_SELECTOR } from "../Consts";
import {
    isDisplayNone,
    matchesSelector,
    createElementTreeWalker,
} from "../Utils";
import type { DOMAPI } from "../Types";

/** Shared selector used by lite focus-search helpers to discover focusable candidates. */
export { FOCUSABLE_SELECTOR };

/** Options used by lite focus discovery helpers. */
export interface FindOptions {
    /** Root container where traversal starts. Defaults to `document.body`. */
    container?: HTMLElement | ShadowRoot;
    /** Optional predicate used to keep/discard matching elements. */
    filter?: (el: HTMLElement) => boolean;
    /** When true, allows elements inside inert/aria-hidden subtrees. */
    includeInert?: boolean;
    /** When true, includes elements with `tabIndex=-1` in results. */
    includeProgrammaticallyFocusable?: boolean;
    /** Reserved for API parity with full Tabster. */
    acceptShadowRoots?: boolean;
    /**
     * Walk in document-reverse order. Mirrors full Tabster's `isBackward`
     * option on findAll/findFirst/findNext/findPrev so the same test suite
     * can drive both implementations.
     */
    isBackward?: boolean;
    /**
     * Start the walk after this element (in the requested direction).
     * The element itself is excluded from the result.
     */
    currentElement?: HTMLElement;
    /**
     * Called for each focusable element discovered in walk order. Returning
     * `false` stops the walk (the element on which `false` is returned is
     * still included in the result).
     */
    onElement?: (el: HTMLElement) => boolean;
    /** Reserved for API parity with full Tabster. */
    domAPI?: DOMAPI;
}

/** Returns whether the element is rendered with non-zero layout and not display:none. */
export function isVisible(element: HTMLElement): boolean {
    if (!element.ownerDocument || element.nodeType !== Node.ELEMENT_NODE) {
        return false;
    }

    if (isDisplayNone(element)) {
        return false;
    }

    const rect = element.ownerDocument.body.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
        return false;
    }

    return true;
}

/** Returns whether the element can currently receive focus under lite rules. */
export function isFocusable(
    element: HTMLElement,
    includeProgrammaticallyFocusable = false
): boolean {
    return (
        matchesSelector(element, FOCUSABLE_SELECTOR) &&
        (includeProgrammaticallyFocusable || element.tabIndex !== -1) &&
        isVisible(element) &&
        isAccessible(element)
    );
}

/** Returns whether the element is accessible (not inert/aria-hidden through its ancestor chain). */
export function isAccessible(element: HTMLElement): boolean {
    const d = element.ownerDocument?.defaultView;
    if (!d) {
        return false;
    }

    for (let e: HTMLElement | null = element; e; e = e.parentElement) {
        if ((e as HTMLElement & { inert?: boolean }).inert) {
            return false;
        }

        const ariaHidden = e.getAttribute("aria-hidden");
        if (ariaHidden && ariaHidden.toLowerCase() === "true") {
            return false;
        }
    }

    return true;
}

function _getContainer(options?: FindOptions): HTMLElement | ShadowRoot {
    return options?.container ?? document.body;
}

function _getDoc(container: HTMLElement | ShadowRoot): Document {
    if (container instanceof ShadowRoot) {
        return container.ownerDocument;
    }
    return container.ownerDocument ?? document;
}

function _accept(
    el: HTMLElement,
    includeInert: boolean,
    includeProgrammaticallyFocusable: boolean,
    filter?: (el: HTMLElement) => boolean
): boolean {
    if (!matchesSelector(el, FOCUSABLE_SELECTOR)) {
        return false;
    }
    if (!includeProgrammaticallyFocusable && el.tabIndex === -1) {
        return false;
    }
    if (!includeInert && !isAccessible(el)) {
        return false;
    }
    if (!isVisible(el)) {
        return false;
    }
    if (filter && !filter(el)) {
        return false;
    }
    return true;
}

/** Returns all focusable descendants in walk order (or reverse order when requested). */
export function findAll(options?: FindOptions): HTMLElement[] {
    const container = _getContainer(options);
    const includeInert = options?.includeInert ?? false;
    const filter = options?.filter;
    const includeProgrammaticallyFocusable =
        options?.includeProgrammaticallyFocusable ?? false;
    const isBackward = options?.isBackward ?? false;
    const currentElement = options?.currentElement;
    const onElement = options?.onElement;
    const doc = _getDoc(container);
    const result: HTMLElement[] = [];

    const walker = createElementTreeWalker(doc, container as Node, (node) => {
        const el = node as HTMLElement;
        if (
            _accept(el, includeInert, includeProgrammaticallyFocusable, filter)
        ) {
            return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
    });

    if (!walker) {
        return result;
    }

    // Collect all matches in document order first; reverse + slice afterwards
    // to keep the tree-walk simple. The post-processing cost is negligible
    // compared to the walk itself.
    const all: HTMLElement[] = [];
    let node = walker.nextNode();
    while (node) {
        all.push(node as HTMLElement);
        node = walker.nextNode();
    }

    let ordered = isBackward ? all.slice().reverse() : all;

    if (currentElement) {
        const idx = ordered.indexOf(currentElement);
        if (idx !== -1) {
            ordered = ordered.slice(idx + 1);
        }
    }

    if (!onElement) {
        return ordered;
    }

    for (const el of ordered) {
        result.push(el);
        if (onElement(el) === false) {
            break;
        }
    }

    return result;
}

/** Returns the first focusable descendant matching the provided options. */
export function findFirst(options?: FindOptions): HTMLElement | null {
    // Honour isBackward / currentElement by routing through findAll. The cost
    // of materialising the whole list is small for typical containers and
    // keeps a single source of truth for ordering semantics.
    if (options?.isBackward || options?.currentElement) {
        return findAll(options)[0] ?? null;
    }

    const container = _getContainer(options);
    const includeInert = options?.includeInert ?? false;
    const filter = options?.filter;
    const includeProgrammaticallyFocusable =
        options?.includeProgrammaticallyFocusable ?? false;
    const doc = _getDoc(container);

    const walker = createElementTreeWalker(doc, container as Node, (node) => {
        const el = node as HTMLElement;
        if (
            _accept(el, includeInert, includeProgrammaticallyFocusable, filter)
        ) {
            return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
    });

    if (!walker) {
        return null;
    }

    return (walker.nextNode() as HTMLElement | null) ?? null;
}

/** Returns the last focusable descendant matching the provided options. */
export function findLast(options?: FindOptions): HTMLElement | null {
    const all = findAll(options);
    return all[all.length - 1] ?? null;
}

/** Returns the focusable element that follows `from` within the same query scope. */
export function findNext(
    from: HTMLElement,
    options?: FindOptions
): HTMLElement | null {
    const all = findAll(options);
    const idx = all.indexOf(from);
    if (idx === -1) {
        return null;
    }
    return all[idx + 1] ?? null;
}

/** Returns the focusable element that precedes `from` within the same query scope. */
export function findPrev(
    from: HTMLElement,
    options?: FindOptions
): HTMLElement | null {
    const all = findAll(options);
    const idx = all.indexOf(from);
    if (idx === -1) {
        return null;
    }
    return all[idx - 1] ?? null;
}

/** Returns the container's preferred default focus target, if present and focusable. */
export function findDefault(options?: FindOptions): HTMLElement | null {
    const container = _getContainer(options);

    const byAttr = container.querySelector(
        "[data-tabster-lite-default]"
    ) as HTMLElement | null;

    if (byAttr && isFocusable(byAttr)) {
        return byAttr;
    }

    const byAutofocus = container.querySelector(
        "[autofocus]"
    ) as HTMLElement | null;

    if (byAutofocus && isFocusable(byAutofocus)) {
        return byAutofocus;
    }

    return null;
}
