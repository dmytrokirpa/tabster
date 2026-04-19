/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { GroupperAPI } from "../Groupper";
import * as Types from "../Types";

/**
 * Returns the GroupperAPI for the given tabster instance, creating it if needed.
 * Importing this function only pulls Groupper code into the bundle.
 */
export function getGroupper(tabster: Types.Tabster): Types.GroupperAPI {
    const tabsterCore = tabster.core;

    if (!tabsterCore.groupper) {
        tabsterCore.groupper = new GroupperAPI(
            tabsterCore,
            tabsterCore.getWindow
        );
    }

    return tabsterCore.groupper;
}
