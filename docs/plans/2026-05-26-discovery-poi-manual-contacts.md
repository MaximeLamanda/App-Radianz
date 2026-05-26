# Discovery POI manual contacts — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow commercial users to add, edit, and delete decision-maker contacts per POI or at site level in Discovery, with Apollo in a separate tab, persisting to Firestore only when the prospect is in the pipeline.

**Architecture:** Extend flat `prospect.contacts[]` with optional `poiKey` and `source: "manual" | "apollo"`. Refactor the existing contacts dialog into tabbed UI (Mes contacts / Apollo). Add centralized grouped list and site-level entry in the POI section header.

**Tech Stack:** Next.js App Router, React, Firestore (`updateProspect`), Zod (client validation), existing `mergeProspectContacts`, Sonner toasts, shadcn Tabs/Dialog/AlertDialog.

**Design doc:** `docs/plans/2026-05-26-discovery-poi-manual-contacts-design.md`

---

### Task 1: Extend `ProspectContact` type

**Files:**
- Modify: `types/index.ts` (interface `ProspectContact`)
- Modify: `lib/apollo-people-search.ts` (types usages if needed)

**Step 1: Update interface**

Add to `ProspectContact`:
- `poiKey?: string`
- `source: "apollo" | "manual"` (was only `"apollo"`)
- `createdAt?: Date`
- `updatedAt?: Date`

**Step 2: Fix compile errors**

Run: `npx tsc --noEmit 2>&1 | head -40`  
Fix any places that assume `source` is only `"apollo"`.

**Step 3: Commit** (if user requested commits)

---

### Task 2: Contact helpers (filter, create, update, delete)

**Files:**
- Create: `lib/prospect-contacts.ts`
- Create: `lib/prospect-contacts.test.ts`
- Modify: `lib/apollo-people-search.ts` (optional: re-export merge only)

**Step 1: Write failing tests**

```ts
// lib/prospect-contacts.test.ts
import { describe, it, expect } from "vitest";
import {
  filterProspectContactsByScope,
  createManualProspectContact,
  updateManualProspectContact,
  removeProspectContactById,
  groupProspectContactsForDisplay,
} from "./prospect-contacts";

describe("filterProspectContactsByScope", () => {
  it("returns site contacts when poiKey is undefined", () => {
    const contacts = [
      { fullName: "A", source: "manual" as const, poiKey: "p1" },
      { fullName: "B", source: "manual" as const },
    ];
    expect(filterProspectContactsByScope(contacts, undefined).map((c) => c.fullName)).toEqual(["B"]);
  });
  it("returns POI contacts when poiKey is set", () => {
    const contacts = [
      { fullName: "A", source: "manual" as const, poiKey: "p1" },
      { fullName: "B", source: "manual" as const },
    ];
    expect(filterProspectContactsByScope(contacts, "p1")).toHaveLength(1);
  });
});
```

**Step 2: Run test — expect FAIL**

Run: `npm test -- lib/prospect-contacts.test.ts`

**Step 3: Implement**

- `createManualProspectContact(input)` → assigns `id`, `source: "manual"`, timestamps
- `updateManualProspectContact(contacts, id, patch)` → only if `source === "manual"`
- `removeProspectContactById(contacts, id)`
- `filterProspectContactsByScope(contacts, poiKey?: string)`
- `groupProspectContactsForDisplay(contacts, poiNameByKey: Map<string, string>)` → `{ site, byPoi: { key, label, contacts }[] }`
- Extend `prospectContactDedupeKey` in `apollo-people-search.ts` OR duplicate-safe merge in new helper `upsertManualContact(contacts, newContact)`

**Step 4: Run tests — expect PASS**

Run: `npm test -- lib/prospect-contacts.test.ts`

---

### Task 3: Tag Apollo contacts with `poiKey` on persist

**Files:**
- Modify: `components/discovery/DiscoveryDrawerPoiContactsSheet.tsx` (`handlePersist`)

**Step 1: When persisting Apollo results**

Map contacts before merge:

```ts
const withPoi = contacts.map((c) => ({ ...c, poiKey: poi?.key }));
```

Pass `withPoi` to `mergeProspectContacts`.

**Step 2: Manual smoke**

Open Discovery drawer → POI with website → Apollo tab → save (with `prospectId` in dev).

---

### Task 4: Tabbed dialog — shell + Mes contacts form

**Files:**
- Modify: `components/discovery/DiscoveryDrawerPoiContactsSheet.tsx`
- Create: `components/discovery/DiscoveryDrawerManualContactForm.tsx` (optional extract)

**Step 1: Add shadcn `Tabs`**

- Props: `defaultTab?: "manual" | "apollo"`
- `poi: DiscoveryPoiContactsSheetPoi | null` (null = site-only dialog)
- Tab **Mes contacts**: list + inline form (fullName, title, email, phone, linkedinUrl)
- Tab **Apollo**: move existing loading/table/error UI
- Disable Apollo tab when `!poi || !canEnrichForApollo(poi)` with helper text

**Step 2: Local state for draft edits**

- On open: `draftContacts = filterProspectContactsByScope(existingContacts, poi?.key)`
- Add / edit / delete mutate `draftContacts` only until Save
- Save button: `updateProspect(prospectId, { contacts: merge full list })` — replace scope slice then merge back:

```ts
function replaceContactsForScope(
  all: ProspectContact[],
  scopePoiKey: string | undefined,
  scoped: ProspectContact[]
): ProspectContact[] {
  const rest = all.filter((c) =>
    scopePoiKey === undefined ? Boolean(c.poiKey) : c.poiKey !== scopePoiKey
  );
  return mergeProspectContacts(rest, scoped);
}
```

**Step 3: Edit/delete manual only**

- Apollo rows: no edit/delete buttons
- Delete: `AlertDialog` confirm

---

### Task 5: Always show Contacts button on POI rows

**Files:**
- Modify: `components/solar-scout/ProspectDrawer.tsx` (`DiscoveryDrawerMergedPoiBlock`)

**Step 1: Remove `canEnrich` gate on button**

Replace:

```tsx
{canEnrich ? <DiscoveryDrawerPoiContactsDialogCell ... /> : <span>—</span>}
```

With always-rendered cell; pass `apolloEnabled={canEnrich}` to dialog if needed for tab disable.

**Step 2: Update `enrichTitle` / `aria-label`**

Use neutral label: « Contacts décisionnaires ».

---

### Task 6: Site contact entry + centralized list

**Files:**
- Modify: `components/solar-scout/ProspectDrawer.tsx`
- Create: `components/discovery/DiscoveryDrawerContactsOverview.tsx` (recommended)

**Step 1: Header button**

In section `discovery-terrain-poi` header (next to Enrichir):

```tsx
<Button variant="outline" size="sm" onClick={() => setSiteContactsOpen(true)}>
  Ajouter un contact site
</Button>
```

Wire `DiscoveryDrawerPoiContactsDialogCell` or new export with `poi={null}`.

**Step 2: Overview block below table**

`DiscoveryDrawerContactsOverview`:
- Props: `contacts`, `pois` (for labels), `prospectId`, `onContactsPersisted`
- Uses `groupProspectContactsForDisplay`
- Empty state when no contacts
- Quick actions: edit/delete manual, open POI dialog link optional

**Step 3: Pass `onContactsPersisted` from parent**

Ensure `pipelineProspectForShareKpis?.contacts` refreshes after save (existing callback pattern).

---

### Task 7: Firestore serialization

**Files:**
- Modify: `lib/firestore-prospect.ts` (if exists) or `lib/firestore.ts` prospect serializers

**Step 1: Verify `createdAt` / `updatedAt` / `fetchedAt` round-trip**

Read how `contacts` are read/written; add Timestamp conversion for new fields if missing.

**Step 2: Test**

Unit test or manual: save manual contact → reload drawer → fields present.

---

### Task 8: Integration tests & QA checklist

**Files:**
- Extend: `lib/prospect-contacts.test.ts`
- Extend: `lib/apollo-people-search.test.ts` (merge with `poiKey`)

**Run:** `npm test -- lib/prospect-contacts.test.ts lib/apollo-people-search.test.ts`

**Manual QA:**

1. Combo **not** in pipeline → Contacts dialog opens, Save disabled, message visible.
2. Combo **in** pipeline → add site contact (header) → appears in overview.
3. Add POI contact on row without website → Mes contacts works, Apollo tab disabled.
4. Edit manual contact → `updatedAt` changes.
5. Delete manual → removed from Firestore after save.
6. Apollo save (if key configured) → contacts have `poiKey`, appear under POI group.
7. Dedupe: add same email twice on same POI → single entry after save.

---

## Execution handoff

Plan saved to `docs/plans/2026-05-26-discovery-poi-manual-contacts.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** — one task at a time with review between tasks.
2. **Parallel Session** — new session with executing-plans in a worktree.

Which approach do you prefer?
