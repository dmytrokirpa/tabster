/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import "./modalizer.css";
import {
    createLiteObserver,
    findFirst,
    getTabsterAttribute,
    ModalizerOptions,
    TABSTER_ATTRIBUTE_NAME,
} from "tabster/lite";

export type ModalDialogLiteProps = ModalizerOptions;

export const createModalDialogLite = (props: ModalDialogLiteProps) => {
    const modalizerProps: ModalDialogLiteProps = {
        ...props,
        id: props.id ?? "modalizer",
    };

    const observer = createLiteObserver({ modules: ["modalizer"] });
    const dialog = document.createElement("div");
    dialog.classList.add("lightbox");
    dialog.classList.add("hidden");
    dialog.innerHTML = `
      <div aria-label="Modal" role="region" class="modal">
        <h3>Modal dialog</h3>
        <div class="modal-body">
          This is a modal dialog powered by Tabster Lite

          <button>Focusable item</button>
          <button>Focusable item</button>
          <button>Focusable item</button>
        </div>
        <div class="button-group"></div>
      </div>
    `;

    const openDialog = () => {
        dialog.classList.remove("hidden");
        const firstFocusable = findFirst({
            container: dialog,
        });
        firstFocusable?.focus();
    };

    const closeDialog = () => {
        rootBtn.focus();
        dialog.classList.add("hidden");
    };

    const rootBtn = document.createElement("button");
    rootBtn.innerHTML = "Open modal dialog";
    rootBtn.addEventListener("click", () => {
        openDialog();
    });

    const closeButton = document.createElement("button");
    closeButton.innerHTML = "Close dialog";
    closeButton.addEventListener("click", () => {
        closeDialog();
    });

    const dismissButton = closeButton.cloneNode() as HTMLButtonElement;
    dismissButton.innerHTML = "Dismiss dialog";
    dismissButton.addEventListener("click", () => {
        closeDialog();
    });

    const isDialogOpen = () => !dialog.classList.contains("hidden");

    const _onDocClick = (e: MouseEvent) => {
        if (
            isDialogOpen() &&
            e.target &&
            !dialog.firstElementChild?.contains(e.target as HTMLElement) &&
            !rootBtn.contains(e.target as HTMLElement)
        ) {
            closeDialog();
        }
    };

    const _onDocKeydown = (e: KeyboardEvent) => {
        if (isDialogOpen() && e.key === "Escape") {
            closeDialog();
        }
    };

    document.addEventListener("click", _onDocClick);
    document.addEventListener("keydown", _onDocKeydown);

    const wrapper = document.createElement("div");
    wrapper.appendChild(rootBtn);
    wrapper.appendChild(dialog);
    dialog.querySelector(".button-group")?.appendChild(closeButton);
    dialog.querySelector(".button-group")?.appendChild(dismissButton);

    const attr = getTabsterAttribute(
        {
            modalizer: modalizerProps as any,
        } as any,
        true
    );

    dialog.setAttribute(TABSTER_ATTRIBUTE_NAME, attr);

    const _cleanupMO = new MutationObserver(() => {
        if (!wrapper.isConnected) {
            observer.dispose();
            document.removeEventListener("click", _onDocClick);
            document.removeEventListener("keydown", _onDocKeydown);
            _cleanupMO.disconnect();
        }
    });
    _cleanupMO.observe(document.body, { childList: true, subtree: true });

    return wrapper;
};
