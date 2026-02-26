---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use when building or redesigning web components, pages, dashboards, marketing sites, or frontend applications, especially when the request requires polished visuals, strong art direction, meaningful motion, and non-generic UI implementation.
---

# Frontend Design

Build real, production-grade frontend code with a clear visual point of view. Prioritize originality and polish over boilerplate patterns.

## Workflow

1. Clarify purpose, audience, and constraints (framework, accessibility, performance, and design-system requirements).
2. Commit to one bold aesthetic direction before coding.
3. Define typography, color system, layout strategy, motion system, and one memorable differentiator.
4. Implement complete, working code in the target stack.
5. Refine spacing, hierarchy, interaction states, and responsive behavior.
6. Verify accessibility and performance basics before handoff.

## Design Direction

- Choose a strong tone and execute it consistently: brutally minimal, editorial, art deco, industrial, maximalist, organic, retro-futuristic, luxury, or playful.
- Define the "one thing to remember" for the interface and reinforce it through composition, typography, and motion.
- Match implementation complexity to direction:
  - Minimal directions: favor restraint, precision, and subtle detail.
  - Maximal directions: use layering, richer motion, and controlled intensity.

## Implementation Rules

- Use distinctive, intentional font pairings. Avoid generic defaults such as Arial, Roboto, Inter, and system stacks unless required by an existing design system.
- Define design tokens with CSS variables (`--color-*`, `--space-*`, `--radius-*`, `--shadow-*`) and use them consistently.
- Build atmosphere with gradients, layered shapes, textures, patterns, or overlays instead of defaulting to flat single-color backgrounds.
- Use meaningful motion for high-impact moments (load sequences, staggered reveals, scroll or hover transitions).
- Prefer composition-driven layouts, including asymmetry or overlap, when appropriate to the concept.
- Cover both desktop and mobile behavior.
- Preserve established visual patterns when working inside an existing product or design system.

## Anti-Patterns

- Do not produce generic, interchangeable "AI-looking" UI.
- Do not default to overused purple-on-white palettes.
- Do not reuse the same type and theme direction across unrelated builds.
- Do not deliver wireframes or pseudo-code when production-grade implementation is requested.

## Output Checklist

- Deliver functional code in the requested framework (HTML/CSS/JS, React, Vue, Astro, etc.).
- Provide a coherent visual system with reusable tokens/components.
- Cover essential UI states (default, hover, focus, active, disabled/loading) where relevant.
- Include accessibility fundamentals: semantic structure, visible keyboard focus, and acceptable contrast.
- Ensure the final result feels intentional and memorable rather than template-driven.
