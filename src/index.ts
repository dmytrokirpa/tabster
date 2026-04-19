/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

export {
    createTabster,
    createIsolatedTabster,
    disposeTabster,
    forceCleanup,
    getDummyInputContainer,
    getInternal,
    getShadowDOMAPI,
    getTabster,
    isNoOp,
    makeNoOp,
} from "./Tabster";

// Feature get* functions live in separate modules so bundlers can tree-shake
// unused features when importing from the individual tabster/features/* paths.
// Re-exported here for full-bundle backward compatibility.
export { getCrossOrigin } from "./features/crossOrigin";
export { getDeloser } from "./features/deloser";
export { getGroupper } from "./features/groupper";
export { getModalizer } from "./features/modalizer";
export { getMover } from "./features/mover";
export { getObservedElement } from "./features/observedElement";
export { getOutline } from "./features/outline";
export { getRestorer } from "./features/restorer";

export { createContext } from "./core/createContext";

export * from "./AttributeHelpers";

export * as Types from "./Types";

export * from "./Events";

export * as EventsTypes from "./EventsTypes";

export * from "./Consts";

export * from "./Deprecated";
