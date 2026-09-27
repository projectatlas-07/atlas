---
name: Calm Atlas Industrial
colors:
  surface: '#f9f9f7'
  surface-dim: '#dadad8'
  surface-bright: '#f9f9f7'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f4f2'
  surface-container: '#eeeeec'
  surface-container-high: '#e8e8e6'
  surface-container-highest: '#e2e3e1'
  on-surface: '#1a1c1b'
  on-surface-variant: '#404943'
  inverse-surface: '#2f3130'
  inverse-on-surface: '#f1f1ef'
  outline: '#707972'
  outline-variant: '#c0c9c1'
  surface-tint: '#2d694d'
  primary: '#125238'
  on-primary: '#ffffff'
  primary-container: '#2f6b4f'
  on-primary-container: '#aae9c6'
  inverse-primary: '#96d4b2'
  secondary: '#57605d'
  on-secondary: '#ffffff'
  secondary-container: '#dce5e0'
  on-secondary-container: '#5d6663'
  tertiary: '#723739'
  on-tertiary: '#ffffff'
  tertiary-container: '#8e4e50'
  on-tertiary-container: '#ffd1d1'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#b1f0cd'
  primary-fixed-dim: '#96d4b2'
  on-primary-fixed: '#002113'
  on-primary-fixed-variant: '#105137'
  secondary-fixed: '#dce5e0'
  secondary-fixed-dim: '#bfc9c4'
  on-secondary-fixed: '#151d1a'
  on-secondary-fixed-variant: '#404945'
  tertiary-fixed: '#ffdad9'
  tertiary-fixed-dim: '#ffb3b4'
  on-tertiary-fixed: '#390b0f'
  on-tertiary-fixed-variant: '#6f3538'
  background: '#f9f9f7'
  on-background: '#1a1c1b'
  surface-variant: '#e2e3e1'
  sidebar-surface: '#F2F3F1'
  card-surface: '#FFFFFF'
  border-subtle: '#E5E5E2'
  border-strong: '#D5D5D1'
  text-primary: '#1F1F1D'
  text-secondary: '#686864'
  text-tertiary: '#989894'
  row-hover: '#F1F1EF'
  state-success: '#047857'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.015em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.005em
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
  caption:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-sm: 1rem
  gutter-lg: 2rem
  margin: 2rem
  margin-mobile: 1rem
  margin-desktop: 3rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.875rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system expresses quiet competence, architectural precision, and organic warmth. Tailored for high-focus operational workflows, industrial data oversight, and minimalist productivity tooling, it eliminates aggressive saturation and decorative clutter in favor of deliberate spatial cadence, crisp hairline borders, and warm neutral planes.

The core visual language draws from:
- **Warm Architectural Minimalism**: Paper-toned surfaces layered with restrained contrast shifts rather than stark monochrome or heavy shadows.
- **Natural Stability**: A grounding botanical primary tone brings authority, measured calmness, and high visibility to primary interactive states.
- **Compact Operational Precision**: Dense, deliberate information presentation paired with expansive breathing margins, accommodating compact slide-over inspection drawers and inline interactive editing without visual fatigue.

## Colors

The color system is organized around grounded organic greens, mineral-tinted greys, and warm off-white canvas surfaces. Contrast is deliberate and readable without creating visual vibration.

### Palette Roles
- **Primary (`#2F6B4F`)**: Used for primary action buttons, focused input strokes, active tab underlines, and key progress indicators.
- **Secondary (`#EAF3EE`)**: A soft sage wash that marks selection highlights, active navigation rows, tag backdrops, and focus rings.
- **Neutral Canvas (`#F7F7F5`)**: The baseline backdrop across the operational workspace, softening contrast compared to pure white.
- **Sidebar Surface (`#F2F3F1`)**: Structural left navigation, rail panels, and auxiliary split frames.
- **Card & Drawer Surface (`#FFFFFF`)**: Pure white elevated modules, table canvases, and slide-over inspector containers.
- **Dividers & Structural Hairlines (`#E5E5E2`, `#D5D5D1`)**: Subtle structural delimiters that frame cards and table columns without creating visual fences.
- **Text Tiers**: Warm black (`#1F1F1D`) for primary data values and headings; muted grey (`#686864`) for labels, table headers, and metadata; tertiary grey (`#989894`) for placeholders and inactive glyphs.

## Typography

Plus Jakarta Sans governs the typography, providing geometric clarity paired with humanist warmth. The type scale emphasizes restraint: distinction between hierarchical tiers relies on subtle weight shifts (400 to 500/600) and muted text color steps rather than dramatic scale variance.

- **Headlines**: Use subtle negative tracking (`-0.01em` to `-0.02em`) to maintain tightness in industrial headers and modal titles.
- **Body & Data Rows**: Line heights are calibrated generously relative to font sizes to support rapid scanning of multi-column tables, technical parameters, and log entries.
- **Labels & Badges**: Small-scale labels and metadata leverage a higher relative weight (500) and slight positive letter-spacing (`0.01em` to `0.02em`) to ensure instant legibility at compact dimensions.

## Layout & Spacing

The structural layout combines a persistent navigation rail or sidebar with a fluid operational work canvas.

### Layout Model
- **Application Shell**: An architectural sidebar (`256px` default width, collapsible to an `64px` icon bar) fixed to the left edge on `#F2F3F1`, bordering the primary content canvas on `#F7F7F5`.
- **Fluid Multi-Column Data Grids**: The central canvas spans a 12-column fluid grid system across desktop viewports, transitioning to 8 columns on tablet and 4 columns on mobile.
- **Slide-Over Inspection Drawers**: Right-anchored overlay or push panels measuring `420px` to `480px` wide. When active, drawers dock flush to the viewport boundary to inspect row details without losing the table's context.

### Responsive Breakpoints
- **Desktop (1024px+)**: Full persistent sidebar, 24px–32px gutters, 32px–48px outer canvas padding, inline side-drawers preserve visible table columns.
- **Tablet (768px - 1023px)**: Sidebar shifts to an off-canvas drawer; 16px gutters, 24px margins; inspectors convert to full modal overlays.
- **Mobile (<768px)**: Single-column stack; 16px margins; slide-over drawers convert to bottom sheets or full-screen overlays.

## Elevation & Depth

Visual hierarchy is communicated through planar tonal layers and crisp 1px hairline borders rather than heavy drop shadows.

- **Layer 0 (Canvas Base)**: The ambient foundation rendered in `#F7F7F5`.
- **Layer 1 (Structural Rail & Sidebar)**: Sub-panels in `#F2F3F1`, separated from the canvas by a vertical 1px `#E5E5E2` hairline border.
- **Layer 2 (Work Cards & Tables)**: Main workspace content panels sit on `#FFFFFF` enclosed by a 1px `#E5E5E2` border. No resting drop shadows are applied.
- **Layer 3 (Compact Slide-Over Drawers)**: Drawers sit on `#FFFFFF` with a single left border in `#D5D5D1`. They carry a calm, diffused shadow that grounds the edge against the backdrop: `box-shadow: -8px 0 24px -4px rgba(31, 31, 29, 0.06), -2px 0 6px -1px rgba(31, 31, 29, 0.02)`.
- **Layer 4 (Popovers & Context Menus)**: `#FFFFFF` surface with a `#D5D5D1` border and a lightweight ambient shadow: `box-shadow: 0 4px 16px -2px rgba(31, 31, 29, 0.05), 0 2px 6px -1px rgba(31, 31, 29, 0.02)`.

## Shapes

The form language balances industrial precision with soft, approachable geometry:
- **Base Components (Inputs, Buttons, Cells)**: 8px (`rounded`) corner radius. This prevents technical tools from feeling sharp while preserving a compact, grid-aligned silhouette.
- **Containers & Drawers**: Primary cards, dialogs, and slide-over headers use 16px (`rounded-lg`) corner geometry on external edges; docked edges of slide-overs remain 0px where flush to the screen bezel.
- **Pills & Status Indicators**: Micro tags, counters, and status badges utilize fully rounded forms (9999px) to contrast with geometric data grids.

## Components

### Buttons
- **Primary**: Background `#2F6B4F`, text `#FFFFFF`, 8px corner radius, no border. Height 36px (compact) or 40px (default). Hover state: `#285D45`. Active state: `#214C38`.
- **Secondary**: Background `#FFFFFF`, 1px solid `#E5E5E2`, text `#1F1F1D`. Hover state: `#F1F1EF` fill with `#D5D5D1` border.
- **Ghost / Action**: Transparent background, text `#686864`. Hover state: `#F1F1EF` background, `#1F1F1D` text.

### Form Fields & Inputs
- **Base Surface**: `#FFFFFF`, 1px solid `#E5E5E2`, 8px radius. Height 38px.
- **Text**: `#1F1F1D`, placeholder text `#989894`.
- **Focus**: Border `#2F6B4F` accompanied by a 3px soft outer halo in `#EAF3EE`.
- **Inline Row Inputs**: Frameless at rest; hovering a table cell reveals a faint `#E5E5E2` outline; focus snaps to `#FFFFFF` fill with 1px `#2F6B4F` border.

### Interactive Data Rows & Tables
- **Row Styling**: Rest background `#FFFFFF`. Height: 44px (compact) or 52px (standard).
- **Dividers**: Bottom hairline border 1px solid `#E5E5E2`.
- **Hover State**: Entire row transitions to `#F1F1EF` with an immediate cursor change, revealing subtle inline edit actions (pencil, quick-status toggle) at the row's trailing edge.
- **Active / Selected State**: Background fills with `#EAF3EE`, anchored by a 3px solid left accent bar in `#2F6B4F`.

### Slide-Over Drawers (Compact Inspector)
- **Container**: Anchored to viewport right, width 440px, surface `#FFFFFF`, left border 1px solid `#D5D5D1`.
- **Header**: Height 64px, flex alignment with breadcrumb-style entity titles, close trigger, and direct inline action buttons.
- **Content**: Scrollable body partitioned into collapsible sections separated by hairline `#E5E5E2` dividers.
- **Footer**: Sticky pinned bar on `#F7F7F5` with 1px top border `#E5E5E2` containing contextual primary and dismissive triggers.

### Chips & Badges
- **Informational**: Background `#F1F1EF`, text `#686864`, hairline border `#E5E5E2`, 9999px radius.
- **Active / Filtered**: Background `#EAF3EE`, text `#2F6B4F`, border transparent.
- **Operational Status**: Dot indicator (6px circle) paired with text. Success: `#047857` dot with `#EAF3EE` backing chip.

### Checkboxes & Radios
- **Geometry**: 18px by 18px square (checkbox, 4px radius) or circle (radio).
- **Rest State**: `#FFFFFF` background, 1px solid `#D5D5D1`.
- **Checked State**: Background `#2F6B4F` with `#FFFFFF` checkmark or center pip.
- **Focus State**: 2px halo in `#EAF3EE`.

### Cards & Work Containers
- **Surface**: `#FFFFFF`, border 1px solid `#E5E5E2`, 16px corner radius.
- **Padding**: 24px internal padding for standard workspace panels; 16px padding for compact dashboard widgets.