/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { ModalizerAPI } from "../Modalizer";
import * as Types from "../Types";

/**
 * Returns the ModalizerAPI for the given tabster instance, creating it if needed.
 * Importing this function only pulls Modalizer code into the bundle.
 *
 * Registers the _onMutationEnd hook so MutationEvent.ts can notify Modalizer
 * of DOM changes without a direct import dependency.
 */
export function getModalizer(
    tabster: Types.Tabster,
    // @deprecated use accessibleCheck.
    alwaysAccessibleSelector?: string,
    accessibleCheck?: Types.ModalizerElementAccessibleCheck
): Types.ModalizerAPI {
    const tabsterCore = tabster.core;

    if (!tabsterCore.modalizer) {
        tabsterCore.modalizer = new ModalizerAPI(
            tabsterCore,
            alwaysAccessibleSelector,
            accessibleCheck
        );
        // Wire the mutation hook so MutationEvent.ts can call hiddenUpdate()
        // without importing Modalizer directly, breaking the coupling.
        tabsterCore._onMutationEnd = () =>
            tabsterCore.modalizer!.hiddenUpdate();
    }

    return tabsterCore.modalizer;
}
