# Tabster Tree-Shakable Refactor: Feasibility Analysis

## TL;DR

Converting tabster core into a tree-shakable format is **feasible and desirable**, but it is not a simple reformatting of the existing code. It requires breaking several architectural circular dependencies and replacing a shared global WeakMap with per-feature closures. The result would look like a well-structured `tabster/lite`, but with the full feature set and cross-feature coordination preserved.

---

## Current Architecture: The Problem

### Full Tabster (monolith)

The core is a single `TabsterCore` class on the window that lazy-loads all features:

```
window.__tabsterInstance
  └── TabsterCore
        ├── FocusedElementState    ← always present
        ├── FocusableAPI           ← always present
        ├── Root / DummyInputs     ← always present
        ├── Mover?                 ← lazy-loaded when getMover() called
        ├── Groupper?              ← lazy-loaded when getGroupper() called
        ├── Modalizer?             ← lazy-loaded when getModalizer() called
        ├── Deloser?               ← ...
        └── Restorer?              ← ...
```

**Why it defeats tree-shaking:**

- Even "lazy-loaded" features import at module scope. The bundler cannot eliminate them because `getMover()`, `getGroupper()`, etc. are side-effect functions that mutate `tabster.core`.
- `Types.ts` (1,375 LOC) is a unified namespace; importing any type pulls the entire module.
- `Utils.ts` (1,999 LOC) is a monolithic utility barrel used by everything.
- `CrossOriginAPI` calls `getDeloser(tabster); getModalizer(tabster); getMover(tabster);...` at init time, making every feature unconditionally reachable.
- Attribute parsing in `Instance.ts` is a giant switch over all feature names — a bundler cannot eliminate branches.

**The circular dependency problem (root cause of brittleness):**

```
FocusedElementState
  → calls Groupper.findNextTabbable()
  → calls Root.getTabsterContext()
  → respects Modalizer boundaries

Groupper
  → calls FocusedElementState.findNextTabbable() to exit
  → uses Root for dummy input wiring

Modalizer
  → fires on MutationEvent (every DOM change triggers hiddenUpdate)
  → sets aria-hidden on all non-modal elements

Root
  → creates dummy inputs wired to Mover/Groupper/Modalizer priority order
```

This is why fixing one feature breaks another: they share mutable state through `TabsterCore` and call back and forth through `FocusedElementState`. There is no stable seam to cut.

---

### Tabster/Lite (current)

Lite solves tree-shaking by making each module a standalone factory:

```typescript
// Only mover code lands in bundle
import { createMover } from "tabster/lite/mover";
const mover = createMover(element, { direction: "vertical" });
```

**What lite gets right:**

- Per-element factories with closure-based state — no global WeakMap
- No cross-feature calling at initialization
- Real tree-shaking: unused modules are dead code

**Why lite is brittle (root causes):**

| Issue                                                     | Location                  | Impact                                                     |
| --------------------------------------------------------- | ------------------------- | ---------------------------------------------------------- |
| `_targetHistory` is module-level global                   | `restorer.ts:52`          | All restorers share one history; breaks nested dialogs     |
| `_lastFocusRelatedTarget` is module-level                 | `modalizer.ts:98`         | Concurrent modals overwrite each other's trigger reference |
| `_pointerActive` is module-level                          | `restorer.ts:113`         | Cross-frame pointer state pollution                        |
| Dummy inputs inserted via `setTimeout(0)` per-Mover       | `mover.ts:1142`           | No coordination; nested movers create duplicate sentinels  |
| `MutationObserver.disconnect()` not called on dispose     | `deloser.ts:189`          | Memory leak on remount                                     |
| Observer remounts ALL modules on any attribute change     | `observer.ts:256-302`     | Focus resets on unrelated prop updates                     |
| Groupper + Mover fight over `tabindex` on shared elements | `groupper.ts`, `mover.ts` | Nesting breaks in unpredictable ways                       |

**The pattern:** Each lite module reimplemented the same feature _independently_ without a shared coordination layer. The brittleness comes from modules needing coordination (e.g., modalizer needs to know when pointer is active, restorer needs per-container scope) but having no contract for sharing that state safely.

---

## The Proposed Approach: Tree-Shakable Core

The idea is to preserve full tabster logic but restructure it as composable, independently importable functions — similar to how Radix or floating-ui export primitives.

### Core Insight

The full tabster features are not independent — they have legitimate cross-feature contracts:

- Mover and Groupper both need to know about dummy input priorities relative to Root
- Modalizer needs to gate focus moves from FocusedElement
- Deloser needs to observe the same focus history as FocusedElement

But these contracts can be expressed as **explicit dependency injection** rather than implicit shared global state.

### Proposed Structure

```
tabster/
  core/                      ← infrastructure only (no features)
    createContext.ts          ← replaces TabsterCore: returns typed context object
    focusable.ts              ← FOCUSABLE_SELECTOR + isFocusable (pure)
    focusedElement.ts         ← focus tracking + async intent queue (injectable)
    dummyInputs.ts            ← DummyInputManager base (injectable)
    mutationEvent.ts          ← DOM mutation listener (injectable)
  features/
    mover.ts                  ← createMover(element, options, context?)
    groupper.ts               ← createGroupper(element, options, context?)
    modalizer.ts              ← createModalizer(element, options, context?)
    deloser.ts                ← createDeloser(element, options, context?)
    restorer.ts               ← createRestorer(element, options, context?)
    observedElement.ts        ← createObservedElement(element, options, context?)
    outline.ts                ← createOutline(element, options, context?)
  observer/
    attributeObserver.ts      ← DOM attribute watcher (auto-wiring)
  index.ts                    ← full bundle (creates context + wires everything)
```

### The `context` Object: Coordination Without Globals

Replace the window-global `TabsterCore` with an explicit, tree-shakable context:

```typescript
// tabster/core/createContext.ts
export interface TabsterContext {
  focusedElement: FocusedElementState   // injectable focus tracker
  focusable: FocusableHelpers            // pure helpers
  dummyInputs: DummyInputCoordinator    // priority-based sentinel manager
  asyncFocusQueue: AsyncFocusQueue      // priority-sorted focus intents
  // No features — those are separate imports
}

export function createContext(win: Window): TabsterContext { ... }
```

Each feature accepts an optional context:

```typescript
// Without context: fully standalone (like current lite)
const mover = createMover(element, { direction: "vertical" });

// With context: full coordination (like current full tabster)
const ctx = createContext(window);
const mover = createMover(element, { direction: "vertical" }, ctx);
const groupper = createGroupper(container, { tabbability: "Limited" }, ctx);
```

This gives you **two valid usage modes from the same code**:

1. **Standalone** — import only what you need, zero coordination cost
2. **Coordinated** — share context for full cross-feature behavior

---

## Breaking the Circular Dependencies

The circular calls between features must be replaced with explicit contracts:

### 1. FocusedElement ↔ Groupper

**Current (circular):**
`FocusedElementState.findNextTabbable()` calls `groupper.findNextTabbable()`

**Proposed:**
FocusedElement accepts a `findNextTabbable` hook at construction:

```typescript
createFocusedElementState(win, {
    findNextTabbable: (el, direction) =>
        groupperFindNext(el, direction) ?? moverFindNext(el, direction),
});
```

Features register themselves into context; FocusedElement calls the hook, not the feature directly.

### 2. Modalizer ↔ MutationEvent

**Current:** Every DOM mutation calls `modalizer.hiddenUpdate()`

**Proposed:** MutationEvent emits a typed event; Modalizer subscribes:

```typescript
// mutationEvent.ts
onMutation.subscribe((changes) => { ... })

// modalizer.ts
ctx.onMutation.subscribe((changes) => hiddenUpdate(changes))
```

If modalizer is not imported, the subscription never exists → zero cost.

### 3. DummyInput Priority System

**Current:** Priority hard-coded across Root/Mover/Groupper/Modalizer

**Proposed:** Each feature declares its priority on registration:

```typescript
ctx.dummyInputs.register(moverInstance, { priority: 1 });
ctx.dummyInputs.register(groupperInstance, { priority: 2 });
ctx.dummyInputs.register(modalizerInstance, { priority: 3 });
```

The coordinator handles conflict resolution centrally. Features don't need to know about each other.

---

## What Changes vs. What Stays the Same

| Concern               | Current                                 | Proposed                                            |
| --------------------- | --------------------------------------- | --------------------------------------------------- |
| Global window state   | `window.__tabsterInstance`              | Optional; context is explicit                       |
| Feature registration  | Implicit via lazy-load getter           | Explicit import + optional context                  |
| Cross-feature focus   | `FocusedElement` calls into features    | Features register hooks into context                |
| Dummy input priority  | Hard-coded in class hierarchy           | Registration-based coordinator                      |
| Mutation observation  | Single MutationEvent broadcast          | Event emitter; features subscribe optionally        |
| Attribute-driven init | `Instance.ts` switch statement          | Per-feature attribute parser, composed              |
| Bundle size           | ~13.5K src LOC regardless               | Pay only for imported features                      |
| Public API            | `createTabster` + `getFeature(tabster)` | `createContext()` + `createFeature(el, opts, ctx?)` |

---

## Risks & Tradeoffs

### What this approach preserves

- All existing focus behavior for coordinated use cases (nested Groupper+Mover, Modalizer gating, Deloser history)
- Cross-origin support (CrossOriginAPI can import only what it needs)
- Attribute-driven initialization (observer can compose feature parsers)
- Async focus priority queue (owned by context, shared across features that need it)

### What needs careful design

- **Context API surface** must be small and stable; adding to it is a breaking change
- **Backward compatibility** with existing `data-tabster` attribute format should be maintained
- **Standalone vs. coordinated behavior parity** — standalone mode loses some coordination (e.g., standalone Mover won't respect Modalizer boundaries); this should be explicit, not surprising
- **Testing surface doubles** — each feature needs standalone tests AND coordinated tests

### What lite's brittleness teaches us

The bugs in lite are not because "lite is wrong" — they are because **shared state was reimplemented as globals** instead of being injected. The fix is the same pattern proposed here: make shared state explicit and scoped per-context, not per-module.

---

## Validation Conclusion

The idea is **valid**. The approach maps directly onto how modern libraries solve this:

- `@floating-ui/core` + `@floating-ui/dom` (optional DOM bindings)
- Radix primitives (composable, context-optional)
- `focus-trap` (standalone) vs. `aria-modal` patterns (coordination)

The key realization: **full tabster and tabster/lite are currently two separate codebases that must be separately maintained**. The proposed approach unifies them: standalone mode = lite behavior, coordinated mode = full behavior. One implementation, two configurations.

**Estimated scope:** Large refactor (~3–4 weeks of focused work), but incremental — features can be migrated one at a time while keeping both old and new APIs functional. The biggest risk is the `FocusedElement ↔ Groupper ↔ Root` triangle, which requires the hook injection pattern to be solid before other features migrate.

## Recommended Execution Plan

### Phase 1: Stabilize Lite Before Refactoring

This phase should happen even if the tree-shakable core work is delayed. The goal is to reduce the current regression pressure and make later architectural work measurable.

**Scope:**

- Scope restorer and modalizer shared state per document. Replace module-level state such as `_targetHistory`, `_lastFocusRelatedTarget`, and `_pointerActive` with `WeakMap<Document, ...>` storage.
- Fix the deloser disposal leak by disconnecting its `MutationObserver` in `dispose()`.
- Stop observer-driven full remounts on unrelated attribute changes. Parse and diff per-feature options before recreating instances so focus state is not reset spuriously.
- Coordinate dummy input ownership in mover. Replace ad hoc `setTimeout(0)` insertion with a per-container coordinator so nested movers do not create duplicate sentinels.
- Define the lite contract explicitly and align tests to it. Separate standalone-lite expectations from coordinated-runtime expectations so the test suite stops validating a hybrid compatibility shim as if it were a product contract.

**Exit criteria:**

- Known lite module globals are scoped per document.
- Dispose and remount flows do not leak observers.
- Unrelated `data-tabster` changes do not recreate live instances.
- Nested mover scenarios do not create duplicate dummy inputs.
- A focused regression suite exists for supported lite behavior, and tests that still require coordinated semantics are identified as such.

### Phase 2: Build the Coordinated, Tree-Shakable Core

Once Phase 1 removes the current noise, migrate toward a single implementation that supports both standalone and coordinated modes.

**Recommended order:**

1. Create `createContext()` and move the `FocusedElement ↔ Groupper ↔ Root` coordination to explicit hook registration. This is the load-bearing change.
2. Introduce a shared dummy input coordinator in the context so mover and groupper can stop coordinating indirectly.
3. Migrate mover to the new feature-factory shape.
4. Migrate groupper on top of the new focus and dummy-input contracts.
5. Migrate modalizer to subscribe to context-managed mutation events instead of direct implicit coupling.
6. Integrate deloser and restorer with the coordinated context.
7. Collapse the two-codebase model so `src/lite/` becomes a thin compatibility layer or disappears entirely.

**Guardrails:**

- Do not treat standalone and coordinated modes as behaviorally identical. The supported contract for each mode must be documented.
- Do not use the hybrid test harness as the end-state validation model. Fluent integration tests should exercise the same contract that production code relies on.
- Migrate one coordination seam at a time and validate it with targeted behavioral tests before moving to the next feature.

---

## Appendix: Files That Must Change

| File                          | Change                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `src/Tabster.ts`              | Becomes `core/createContext.ts`; TabsterCore becomes the context shape                  |
| `src/State/FocusedElement.ts` | Accept `findNextTabbable` hook; remove direct feature imports                           |
| `src/MutationEvent.ts`        | Become event emitter; remove direct modalizer call                                      |
| `src/Mover.ts`                | Become `features/mover.ts`; register with dummyInputs coordinator                       |
| `src/Groupper.ts`             | Become `features/groupper.ts`; register findNextTabbable hook with context              |
| `src/Modalizer.ts`            | Become `features/modalizer.ts`; subscribe to mutation events                            |
| `src/Instance.ts`             | Break into per-feature attribute parsers                                                |
| `src/Types.ts`                | Split per-feature; no monolithic namespace import                                       |
| `src/Utils.ts`                | Split by concern; no barrel                                                             |
| `src/lite/*.ts`               | Fix known bugs (scoped globals, MutationObserver cleanup); align API with new features/ |
