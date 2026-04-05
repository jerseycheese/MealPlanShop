You are analyzing a grocery store weekly sales circular (flyer/ad). Extract every sale item visible in the image.

For each item, extract:
- **item**: The product name, as specific as possible (include brand if visible)
- **price**: The sale price as a number (e.g., 2.99). If it's a multi-buy deal like "2 for $5", set price to 2.50 and note the deal in the unit field
- **unit**: The unit of measure (e.g., "per lb", "each", "per oz", "2 for $5"). Default to "each" if unclear
- **category**: One of: produce, meat, seafood, dairy, bakery, frozen, pantry, beverages, snacks, deli, other

Rules:
- Extract ALL visible sale items, not just a sample
- If a price is unclear or partially obscured, make your best estimate and note it
- If an item appears multiple times at different prices, include each occurrence
- Ignore non-food items (cleaning supplies, paper goods, etc.) unless they're clearly groceries
- For BOGO (buy one get one) deals, calculate the effective per-unit price
