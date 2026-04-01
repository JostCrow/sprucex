# Plan: `sx-for` nested `sx-data`, keyed reordering, and teardown behavior

## Background

We need to improve three related areas in the `sx-for` rendering pipeline:

1. **Nested `sx-data` inside loop items should work** (currently blocked or partially initialized).
2. **Reordering should not redraw all rows** (we should retain/move existing DOM when possible).
3. **Removed rows should be fully dismantled** (effects/watchers/event handlers must be cleaned up).

These changes should be delivered together because they all depend on how loop instances are created, tracked, moved, and destroyed.

---

## Goal and acceptance criteria

### Goal A — Allow nested `sx-data` in loop templates

- `sx-data` works on descendants rendered inside an `sx-for` item.
- Each row receives its own component scope without leaking state across rows.
- Nested scopes can still read parent loop values (`item`, `index`) where expected.

**Acceptance checks**

- Adding `<div sx-data="{ open: false }">...</div>` inside a row works for every row.
- Updating one row's nested local state does not affect other rows.
- Row additions/removals do not break nested reactivity.

### Goal B — Minimize DOM churn during reorder

- `sx-for` should use stable identity (`sx-key` or equivalent key expression) to map old/new rows.
- Reorder operations should move existing nodes instead of re-creating all nodes.
- Only changed/inserted/removed rows should be patched.

**Acceptance checks**

- Reversing a keyed list keeps existing row DOM nodes (identity preserved).
- Event listeners, focused input state, and nested component state survive reorder.
- Performance test confirms fewer creates/destroys than naïve full redraw.

### Goal C — Correct teardown for removed rows

- When a row is removed, all reactive subscriptions/effects and directive bindings created for that row are disposed.
- No detached-node leaks.

**Acceptance checks**

- Removing rows triggers row-level cleanup hooks/disposers.
- Repeated add/remove cycles keep watcher/subscription counts stable.
- Memory/leak guard test passes in runtime test suite.

---

## Implementation plan

## 1) Audit current `sx-for` lifecycle and scope bootstrap

- Inspect loop creation/update path in core runtime (`component`, reactivity bindings, directive execution order).
- Identify where loop clones are initialized and whether descendant directives are fully walked.
- Verify if nested `sx-data` is skipped due to:
  - early return in directive walker,
  - hydration guard,
  - or row scope shadowing issue.

**Deliverable**: short internal note in PR body summarizing root causes and touched modules.

## 2) Introduce explicit row instance records

Create an internal per-row record structure similar to:

- `key`
- `start/end` anchors or root nodes
- `scope`
- `disposers[]`
- `mounted` flag

This record becomes the source of truth for reuse/move/dispose.

## 3) Fix nested `sx-data` initialization within rows

- Ensure row subtree is processed with normal directive traversal after clone insertion.
- Allow nested `sx-data` to create child component scopes under the row scope.
- Ensure evaluation context resolves in order:
  1. nested local `sx-data`
  2. row scope (`item`, `index`, aliases)
  3. parent scope/store

## 4) Implement keyed diff for reorder/update

- Require/encourage stable keys for reorder-sensitive lists.
- Build `oldKey -> rowRecord` map.
- Iterate new list and:
  - reuse & move existing record when key exists,
  - create only for new keys,
  - mark missing old keys for disposal.
- Perform minimal DOM moves using anchors/`insertBefore`.
- Fallback behavior for unkeyed lists: document as replace/positional patch with warning.

## 5) Guarantee teardown for removed records

- Add a centralized `disposeRow(record)` that:
  - runs row disposers,
  - tears down nested scopes/components,
  - detaches nodes,
  - clears references.
- Call `disposeRow` for every removed key and during parent component destroy.

## 6) Add instrumentation (test-only)

- Expose lightweight counters in test harness only (create/move/dispose counts) to validate minimal churn.
- Add assertions for watcher/subscription cleanup.

---

## Test plan

Add/extend tests in runtime/features suites:

1. **Nested `sx-data` in `sx-for` row**
   - row-local toggle/state independence
   - access to row item + parent scope
2. **Keyed reorder preserves nodes**
   - reorder `[a,b,c] -> [c,a,b]`
   - assert node identity reused (same references)
3. **Keyed insert/remove minimal patching**
   - insert one item in middle, remove one item
   - assert only one create/one dispose
4. **Teardown correctness**
   - repeated add/remove cycles
   - assert no net growth in disposers/watchers
5. **Regression for existing `sx-for` behavior**
   - existing tests stay green

Optional perf smoke test (CI-safe): compare operation counters between keyed reorder and full rerender baseline.

---

## Examples plan (docs and demo updates)

Add/update examples showing:

1. **Nested row-local state**
   - todo list where each row has local expanded/edit mode via nested `sx-data`.
2. **Keyed reorder with drag/sort simulation**
   - reorder button and proof of preserved input cursor/state.
3. **Removal cleanup example**
   - dynamic list with lifecycle logging (create/dispose) to show deterministic teardown.

If the docs site has live examples, include these in examples page and keep snippets mirrored in README/docs.

---

## Documentation updates

Update docs sections for `sx-for`, `sx-key`, and `sx-data` interactions:

- Clarify that nested `sx-data` inside loop items is supported.
- Strongly recommend stable keys when items can reorder.
- Explain behavior when keys are missing (positional updates may recreate DOM/state).
- Add troubleshooting notes for duplicated keys.

### Warnings to include

- **Warning:** Duplicate keys can cause incorrect row reuse and stale UI.
- **Warning:** Using index as key is unsafe for reorderable lists.
- **Warning:** Unkeyed reorder may recreate rows and reset local state.

---

## Changelog plan

For release entry, add under `Unreleased`:

- Added support for nested `sx-data` scopes inside `sx-for` rows.
- Changed `sx-for` to use keyed minimal-diff row reconciliation.
- Fixed teardown/disposal for removed loop rows to prevent lingering effects.
- Added regression/performance-oriented tests and updated examples/docs.

---

## Rollout strategy

1. Implement + tests behind normal behavior (no feature flag unless risk discovered).
2. Validate against existing suite and new targeted loop tests.
3. Update docs/examples/changelog in same PR.
4. In PR notes, call out migration guidance:
   - add stable `sx-key` to reorderable lists,
   - avoid index keys.

---

## Definition of done

- All new tests pass and prevent regressions.
- Existing tests remain green.
- Docs/examples/changelog updated.
- Manual verification confirms:
  - nested `sx-data` in rows works,
  - reorder preserves row identity,
  - removed rows are dismantled cleanly.
