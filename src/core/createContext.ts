/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { createIsolatedTabster } from "../Tabster";
import * as Types from "../Types";

export type { TabsterCoreProps } from "../Types";

/**
 * Creates a fresh, isolated Tabster context for the given window without
 * registering it on `window.__tabsterInstance`.
 *
 * Unlike `createTabster()`, each call produces an independent instance.
 * Useful for testing, SSR, or cross-iframe isolation where a shared
 * singleton is undesirable.
 *
 * Features (Mover, Groupper, Modalizer, etc.) are still opt-in:
 * import and call `getMover(ctx)`, `getGroupper(ctx)`, etc. as needed.
 */
export function createContext(
    win: Window,
    props?: Types.TabsterCoreProps
): Types.Tabster {
    return createIsolatedTabster(win, props);
}
