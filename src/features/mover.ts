/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { MoverAPI } from "../Mover";
import * as Types from "../Types";

/**
 * Returns the MoverAPI for the given tabster instance, creating it if needed.
 * Importing this function only pulls Mover code into the bundle — Groupper,
 * Modalizer, and other features are not included unless separately imported.
 */
export function getMover(tabster: Types.Tabster): Types.MoverAPI {
    const tabsterCore = tabster.core;

    if (!tabsterCore.mover) {
        tabsterCore.mover = new MoverAPI(tabsterCore, tabsterCore.getWindow);
    }

    return tabsterCore.mover;
}
