/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { ObservedElementAPI } from "../State/ObservedElement";
import * as Types from "../Types";

/**
 * Returns the ObservedElementAPI for the given tabster instance, creating it if needed.
 * Importing this function only pulls ObservedElement code into the bundle.
 */
export function getObservedElement(
    tabster: Types.Tabster
): Types.ObservedElementAPI {
    const tabsterCore = tabster.core;

    if (!tabsterCore.observedElement) {
        tabsterCore.observedElement = new ObservedElementAPI(tabsterCore);
    }

    return tabsterCore.observedElement;
}
