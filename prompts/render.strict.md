---
id: render.strict
version: 1.0.0
route: depth-control
inputs: [roomType, styleTemplate, materialList, lighting, userExtra]
control: depth + canny edge (由 provider 適配)
---
Photorealistic interior photograph of a {{roomType}}, {{styleTemplate}} style.
Materials: {{materialList}}.
Lighting: {{lighting}}.
Composition is fully controlled by the depth/edge map; do not deviate from it.
Additional notes (do not alter layout): {{userExtra}}
Natural shadows, high detail, no text, no watermark.
NEGATIVE: distorted walls, extra windows, extra doors, floating furniture, warped perspective, text, watermark, people.
