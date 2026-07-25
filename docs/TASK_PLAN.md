# Application Shell Redesign Plan

## Strategy
Based on the UI/UX audit (score: 46/100), the current app needs:
1. **Design tokens** - Typographic scale, color tokens, spacing, shadows, border radius
2. **Sidebar** - Section grouping, active state with left border indicator, proper proportions
3. **Header** - Global search bar, breadcrumbs, notification badge count, proper user menu
4. **Global layout** - Consistent spacing, proper page padding, elevation system

## Implementation Order
1. Update `tailwind.config.js` - Extended design tokens
2. Update `index.css` - Premium base styles, scrollbars, animations
3. Rewrite `Shell.tsx` - Enterprise sidebar + header with all features
4. Run TypeScript checks to verify nothing is broken

## Design Decisions (Enterprise-Grade)
- **Sidebar**: 260px wide, dark background variant, section headers, left border active indicator
- **Header**: 56px height, backdrop-blur, global Cmd+K search, notification badge with count
- **Cards**: Subtle shadow, border, rounded-xl, hover elevation
- **Typography**: Inter (headings/body), JetBrains Mono (data/monospace)
- **Colors**: Brand blue (#3366f5), semantic colors, surface hierarchy
- **Spacing**: 4px base unit, consistent 8-12-16-20-24 scale
- **Shadows**: 4-level elevation system (sm/md/lg/xl)