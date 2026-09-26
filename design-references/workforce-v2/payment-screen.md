---
name: Calm Atlas
colors:
  surface: '#fcf9f5'
  surface-dim: '#dcdad6'
  surface-bright: '#fcf9f5'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3ef'
  surface-container: '#f0edea'
  surface-container-high: '#ebe8e4'
  surface-container-highest: '#e5e2de'
  on-surface: '#1c1c1a'
  on-surface-variant: '#404943'
  inverse-surface: '#31302e'
  inverse-on-surface: '#f3f0ed'
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
  tertiary: '#00533b'
  on-tertiary: '#ffffff'
  tertiary-container: '#006e4f'
  on-tertiary-container: '#90eec5'
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
  tertiary-fixed: '#97f5cc'
  tertiary-fixed-dim: '#7bd8b1'
  on-tertiary-fixed: '#002115'
  on-tertiary-fixed-variant: '#00513a'
  background: '#fcf9f5'
  on-background: '#1c1c1a'
  surface-variant: '#e5e2de'
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

This design system expresses quiet competence, architectural precision, and organic warmth. Built for high-focus operational workflows, productivity software, and thoughtful content hubs, it replaces visual noise with deliberate spatial breathing room and warm, grounded neutrality.

The core visual language relies on:
- **Warm Architectural Minimalism**: Flat, layered paper-like surfaces with subtle tonal shifts over harsh contrast or heavy dropped shadows.
- **Natural Tactility**: The signature Atlas Green grounds interactive focus states with stability, natural authority, and calm momentum.
- **Deliberate Air**: Extensive whitespace, unhurried row heights, and light structural framing that respects the user's attention.

## Colors

The palette is tuned around balanced warm neutrals, muted mineral surfaces, and deliberate botanical green anchors. No neon accents or aggressive saturated tones are permitted.

### Palette Architecture
- **Primary Anchor**: `#2F6B4F` (Atlas Green) serves as the primary actionable anchor for main buttons, primary highlights, and prominent selection states. Hover shifts gently to `#285D45`.
- **Soft Accent / Selection Tint**: `#EAF3EE` handles active sidebar rows, badge backgrounds, input focus rings, and soft interactive selections.
- **Canvas & Surface Tiering**:
  - App Canvas (Background): `#F7F7F5`
  - Structural Panels / Sidebar: `#F2F3F1`
  - Elevated Workspaces & Cards: `#FFFFFF`
  - Muted Surfaces (Code blocks, soft insets): `#F6F6F4`
  - Hover Fill: `#F1F1EF`
- **Text & Content Hierarchy**:
  - Primary Text: `#1F1F1D` (warm off-black)
  - Secondary Text: `#686864` (structural descriptions, metadata)
  - Subtle / Tertiary Text: `#989894` (placeholders, inactive icons, breadcrumb dividers)
- **Dividers & Structure**:
  - Default Border: `#E5E5E2`
  - Strong Border: `#D5D5D1`
- **Feedback**:
  - Success State: `#047857`

## Typography

Plus Jakarta Sans drives the typographic system across all interfaces, balancing functional legibility with geometric humanist softness.

- **Scale Restraint**: Typography avoids excessive jumps. Content hierarchy is achieved through subtle weight shifts (Regular 400 to Medium 500 and Semi-bold 600) and color tiers (`#1F1F1D` vs `#686864`), rather than exaggerated sizing.
- **Reading Rhythm**: Generous line-heights on body copy ensure effortless scanning across long documents, lists, and dense tables.
- **Display Text**: Headings use slight negative letter tracking (`-0.01em` to `-0.02em`) to retain cohesion without appearing aggressive.

## Layout & Spacing

The layout philosophy centers on a relaxed fluid-responsive grid system, using spacious structural padding to minimize visual tension.

### Structure
- **Sidebar & Core Canvas**: The application shell pairs an architectural sidebar (`#F2F3F1`, default width 256px) with a primary work canvas (`#F7F7F5`).
- **Main Workspace**: Content cards, document panes, and work tables sit on `#FFFFFF` surfaces with ample room surrounding them.
- **Row Heights & Density**: Lists and data tables adhere to comfortable vertical heights (minimum 44px–48px for compact rows, 56px–64px for standard interactive list items) to prevent cramped data density.
- **Grid Adaptations**:
  - **Desktop (1024px+)**: 12-column grid with 24px/32px gutters and 48px outer margins.
  - **Tablet (768px - 1023px)**: 8-column layout, sidebar collapsible into a drawer, 20px gutters.
  - **Mobile (<768px)**: 4-column layout, 16px margins, vertical stack reflow for split panels.

## Elevation & Depth

This system avoids dark drop shadows, blurred neon glows, and heavy skeuomorphic bevels. Visual hierarchy is established strictly through tonal layering and low-contrast perimeter definitions.

### Hierarchy Tiers
- **Tier 0 (App Canvas)**: Ground layer rendered in `#F7F7F5`.
- **Tier 1 (Panels & Navigation)**: Structural sidebars and navigation ribbons at `#F2F3F1`, delineated with a single `#E5E5E2` 1px border.
- **Tier 2 (Cards & Inset Canvas)**: Primary workspace cards use pure `#FFFFFF` resting against `#F7F7F5`. Separation is achieved via a hairline 1px `#E5E5E2` border. No drop shadow is used during rest.
- **Tier 3 (Floating Menus & Popovers)**: Dropdowns, tooltips, and floating command dialogs use `#FFFFFF` framed with a hairline `#D5D5D1` border and an ultra-subtle, warm ambient shadow: `0 4px 16px -2px rgba(31, 31, 29, 0.04), 0 2px 6px -1px rgba(31, 31, 29, 0.02)`.

## Shapes

The geometric form language is friendly, approachable, and balanced:
- **Base Elements (Buttons, Inputs, Badges)**: Use `rounded` (0.5rem / 8px) to soften rectangular UI components while preserving clean lines.
- **Cards & Modal Containers**: Use `rounded-lg` (1rem / 16px) for spacious framing without feeling ballooned.
- **Pills / Status Dots**: Pill radii (`rounded-full`) are reserved specifically for micro tags, status indicators, and notification pips.

## Components

### Buttons
- **Primary**: Background `#2F6B4F`, text `#FFFFFF`, border none, 8px corner radius. Padding: 10px 18px (medium). Hover: `#285D45`. Active: `#214C38`.
- **Secondary / Ghost**: Background transparent, border 1px solid `#E5E5E2`, text `#1F1F1D`. Hover: `#F1F1EF`, border `#D5D5D1`.
- **Subtle / Text**: Background transparent, text `#686864`. Hover: `#F1F1EF`, text `#1F1F1D`.

### Form Fields & Inputs
- Height: 40px (default) or 48px (spacious).
- Surface: `#FFFFFF`, border 1px solid `#E5E5E2`. Corner radius: 8px.
- Text: `#1F1F1D`, placeholder: `#989894`.
- Focus: Border color shifts to `#2F6B4F` with a soft 3px halo in `#EAF3EE`.

### Chips & Status Tags
- **Default / Neutral**: Background `#F6F6F4`, text `#686864`, border 1px solid `#E5E5E2`.
- **Active / Selected**: Background `#EAF3EE`, text `#2F6B4F`, border 1px solid transparent.
- **Success Tag**: Background `#EAF3EE`, text `#047857`, hairline border in `#047857` at 15% opacity.

### Lists & Tables
- Dividers: Single 1px line in `#E5E5E2`. Omit top and outer edge borders to allow layouts to breathe.
- Row States: Rest background is `#FFFFFF` (or canvas transparent). Hover shifts to `#F1F1EF`. Selected row uses `#EAF3EE` with an optional 3px left border accent in `#2F6B4F`.
- Padding: 14px vertical, 16px horizontal for comfortable density.

### Cards
- Surface: `#FFFFFF`.
- Border: 1px solid `#E5E5E2`.
- Shadow: Flat (none).
- Padding: Generous internal padding (24px to 32px).

### Checkboxes & Radios
- Size: 18px by 18px.
- Unchecked: `#FFFFFF` fill with 1px border `#D5D5D1`.
- Checked: Fill `#2F6B4F` with white checkmark icon. Hover: `#285D45`.
- Focus Ring: 2px offset in `#EAF3EE`.