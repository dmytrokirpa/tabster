/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { OutlineAPI } from "../Outline";
import * as Types from "../Types";

/**
 * Returns the OutlineAPI for the given tabster instance, creating it if needed.
 * Importing this function only pulls Outline code into the bundle.
 */
export function getOutline(tabster: Types.Tabster): Types.OutlineAPI {
    const tabsterCore = tabster.core;

    if (!tabsterCore.outline) {
        tabsterCore.outline = new OutlineAPI(tabsterCore);
    }

    return tabsterCore.outline;
}
