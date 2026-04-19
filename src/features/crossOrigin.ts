/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { CrossOriginAPI } from "../CrossOrigin";
import * as Types from "../Types";
import { getDeloser } from "./deloser";
import { getGroupper } from "./groupper";
import { getModalizer } from "./modalizer";
import { getMover } from "./mover";
import { getObservedElement } from "./observedElement";
import { getOutline } from "./outline";

/**
 * Returns the CrossOriginAPI for the given tabster instance, creating it if needed.
 * CrossOrigin requires all other features so this import pulls the full feature set.
 */
export function getCrossOrigin(tabster: Types.Tabster): Types.CrossOriginAPI {
    const tabsterCore = tabster.core;

    if (!tabsterCore.crossOrigin) {
        getDeloser(tabster);
        getModalizer(tabster);
        getMover(tabster);
        getGroupper(tabster);
        getOutline(tabster);
        getObservedElement(tabster);
        tabsterCore.crossOrigin = new CrossOriginAPI(tabsterCore);
    }

    return tabsterCore.crossOrigin;
}
