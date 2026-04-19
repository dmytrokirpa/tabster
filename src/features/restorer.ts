/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { RestorerAPI } from "../Restorer";
import * as Types from "../Types";

/**
 * Returns the RestorerAPI for the given tabster instance, creating it if needed.
 * Importing this function only pulls Restorer code into the bundle.
 */
export function getRestorer(tabster: Types.Tabster): Types.RestorerAPI {
    const tabsterCore = tabster.core;

    if (!tabsterCore.restorer) {
        tabsterCore.restorer = new RestorerAPI(tabsterCore);
    }

    return tabsterCore.restorer;
}
