**Final Atlas UI/UX principles**

## A. Flow

1. **One primary task per screen.** One visually dominant action; secondary and rare actions stay quieter.

2. **Progressive disclosure.** Show only what is needed now. Details, history, admin actions, archive/reversal, etc. appear deeper.

3. **Use sensible defaults.** Never ask the user for information Atlas already knows or can safely infer.

4. **Optimize frequent data entry.** Numeric keyboards, sensible focus/tab order, Enter where useful, preserved form state, and minimal taps.

5. **Prevent duplicate actions.** Disable submission immediately and show progress. Critical writes such as Challans, payments and wage settlements must also become **server-side idempotent using a dedicated client-generated idempotency key**. Never use Challan number for idempotency. Server-side idempotency implementation is a separate backend milestone, not part of UI redesign work.

## B. Design system

6. **One visual language across Atlas.** Same typography, spacing, buttons, inputs, cards, tables, badges, drawers and interaction behavior everywhere.

7. **Atlas must be centrally skinnable.** Colors, typography, spacing, radii, shadows, borders, etc. come from **CSS-variable design tokens mapped into Tailwind**. Changing the core design should update Atlas centrally, not require editing every screen.

8. **No arbitrary styling.** Raw colors or arbitrary spacing should be blocked for new V2 work. Legitimate exceptions require:
   `// ui-exception: <reason>`

9. **Primitives are shared immediately.** Things such as Button, Input, Card, Badge and Table belong to the shared system from day one.

10. **Composite patterns must earn reuse.** A higher-level pattern such as a payment panel becomes shared only after at least **two real screens** prove that the abstraction is actually reusable.

11. **UI components contain presentation, not domain logic.** Wage calculations, balances, locking, financial rules, permissions, etc. stay in feature/service/backend layers.

12. **Formatting is centralized.** One shared formatter for Indian currency/numbers (`₹1,23,456`), dates (`DD/MM/YYYY`), Asia/Kolkata time and numbers. Financial columns use right alignment and tabular figures.

13. **User-facing labels are centralized.** Keep strings in one shared location so Hindi/Bengali or wording changes can be added later without hunting through every component. This does **not** mean building localization now.

## C. States & safety

14. **Every screen designs real states.** Loading, empty, error, disabled, read-only, locked, archived, not-recorded and not-calculated states are first-class designs—not afterthoughts.

15. **Statuses are defined per entity.** Challan, Payment, Wage Period, etc. each have their own fixed statuses in one central status definition. One status = one meaning, label and color token. Screens never invent status wording.

16. **Financial history is preserved.** Correct financial records using the appropriate void/reverse/correction flow, not destructive deletion. Confirmations explain the actual consequence in plain language.

17. **UI hiding is not security.** The interface may hide unavailable actions, but RLS/RPC/backend rules remain responsible for authorization, factory isolation and financial protection.

## D. Real devices

18. **Design for the actual user.** Site workflows must work on low-end Android phones, outdoors and on unreliable networks: ~44px minimum targets, readable text, strong contrast and no hover-only controls.

19. **Desktop and mobile are intentional experiences.** Office screens can be desktop-first; site screens can be mobile-first. Never just shrink a desktop page until it fits.

20. **Build for extensibility, not imaginary scale.** Keep boundaries clean and components replaceable, but don't build infrastructure for hypothetical problems before Atlas actually needs it.

### Where shared things live

The exact paths should follow the existing repo structure, but conceptually:

* **Tokens** → central token stylesheet
* **Primitives** → shared UI components
* **Formatters** → one shared formatting module
* **Statuses** → one central status module
* **Strings** → one shared labels/strings module
* **Feature-specific UI** → stays inside that feature
Codex must inspect the existing repo first and follow existing folder conventions rather than creating parallel structures.

### Definition of done for every redesigned screen

**Real data works → loading/empty/error/locked states work → mobile width checked → shared formatting used → token-based styling only → duplicate submission protected → existing backend/accounting invariants still pass.**

And the core philosophy underneath all of it:

> **Atlas should be powerful underneath, simple on the surface, and cheap to redesign later.**

## Reusable Codex UI constraint block

> Read and follow `ATLAS_UI_RULES.md`. Use existing Atlas design tokens and `src/components/ui/*`. Do not introduce raw colours, arbitrary styling or duplicate primitives. Use the centralized formatting, status and shared-string contracts. If a genuinely new reusable pattern is required, flag it instead of silently inventing it.
