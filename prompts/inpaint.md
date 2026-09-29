---
id: inpaint
version: 1.0.0
images: ["image 1 = 要編輯的效果圖（遮罩套用於此）", "image 2.. = 參考圖(可選)"]
---
Edit only the masked (transparent) region of image 1. Replace its content with: {{instruction}}.
Keep the perspective, scale, lighting direction, and shadows consistent with the rest of the image. Blend edges naturally.
Do not change anything outside the masked region. No text, no watermark.
