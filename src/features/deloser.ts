/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { DeloserAPI } from "../Deloser";
import * as Types from "../Types";

/**
 * Returns the DeloserAPI for the given tabster instance, creating it if needed.
 * Importing this function only pulls Deloser code into the bundle.
 */
export function getDeloser(
    tabster: Types.Tabster,
    props?: { autoDeloser: Types.DeloserProps }
): Types.DeloserAPI {
    const tabsterCore = tabster.core;

    if (!tabsterCore.deloser) {
        tabsterCore.deloser = new DeloserAPI(tabsterCore, props);
    }

    return tabsterCore.deloser;
}
