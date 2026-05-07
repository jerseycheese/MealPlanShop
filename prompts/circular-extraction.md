You are analyzing a grocery store weekly sales circular (flyer/ad). Extract every sale item visible in the image that is **human food or drink**.

For each item, extract:
- **item**: The product name, as specific as possible (include brand if visible)
- **price**: The sale price as a number (e.g., 2.99). If it's a multi-buy deal like "2 for $5", set price to 2.50 and note the deal in `priceNote`
- **unit**: The unit of measure (e.g., "per lb", "each", "per oz", "2 for $5"). Default to "each" if unclear
- **category**: One of: produce, meat, seafood, dairy, bakery, frozen, pantry, beverages, snacks, deli, other
- **priceNote** (optional): Only include this field when the price required interpretation. Examples: "BOGO, effective per-unit price", "2 for $5", "price estimated from partially obscured text", "digital coupon price"

## What to extract (human food and drink only)

Include: fresh produce, meat, poultry, seafood, dairy, eggs, cheese, bread, bakery items, frozen meals, frozen vegetables, canned goods, dry pasta, rice, cereal, condiments, sauces, cooking oils, spices, coffee, tea, juice, soda, water, beer, wine, snack foods, chips, crackers, cookies, candy, ice cream, deli meats, prepared foods.

## What to skip (do NOT extract)

- Pet food and pet supplies (Purina, Friskies, Fancy Feast, Beneful, Meow Mix, Iams, Pedigree, Tidy Cats, cat litter, dog treats)
- Flowers, plants, bouquets
- Cleaning supplies, detergent, dish soap
- Paper goods (paper towels, toilet paper, napkins)
- Health and beauty (shampoo, toothpaste, vitamins, medicine)
- Baby care non-food items (diapers, wipes, formula)
- Baby food and toddler food (jarred baby food, pouches, infant cereal, snacks marketed for babies/toddlers — Gerber, Happy Tot, Happy Baby, Plum Organics, Beech-Nut, Earth's Best, Sprout Organic, Stage 1/2/3/4 pouches)
- Household items (batteries, light bulbs, trash bags)
- Gift cards, coupons with no associated product

## Rules

1. Extract ALL visible sale items that are human food/drink, not just a sample.
2. If a price is unclear or partially obscured, make your best estimate and explain in `priceNote`.
3. **No zero prices.** If an item has no visible price, no parseable price, or is only available as a free-with-purchase promo with no standalone price shown, OMIT the item entirely. Never set price to 0.
4. **Duplicates.** If the same product appears more than once (e.g., "Whole Golden Pineapple" and "Pineapple" are the same item), keep ONLY the entry that has a real, visible price. If both have prices, keep the more specific name.
5. For BOGO (buy one get one) deals, calculate the effective per-unit price and note it in `priceNote`.
6. For multi-buy deals (e.g., "3 for $9"), divide to get the per-unit price, put that in `price`, and note the deal in both `unit` and `priceNote`.

## Examples

Include (meal-planning grocery items):
- "Bananas $0.59/lb" -> {"item": "Bananas", "price": 0.59, "unit": "per lb", "category": "produce"}
- "Buy 1 Get 1 Free Tropicana OJ $4.99" -> {"item": "Tropicana OJ", "price": 2.50, "unit": "each", "category": "beverages", "priceNote": "BOGO, effective per-unit price"}
- "3 for $9 Yoplait Yogurt" -> {"item": "Yoplait Yogurt", "price": 3.00, "unit": "3 for $9", "category": "dairy", "priceNote": "3 for $9"}
- "Boneless Chicken Breast $2.99/lb with digital coupon" -> {"item": "Boneless Chicken Breast", "price": 2.99, "unit": "per lb", "category": "meat", "priceNote": "digital coupon price"}

Exclude (do NOT extract):
- "Gerber Baby Food Pouches 2/$3" — baby food
- "Happy Tot Stage 4 Pouches $1.99" — toddler food
- "Purina Cat Chow $12.99" — pet food
- "Tide Detergent $9.99" — cleaning supply
- "Mixed Bouquet $9.99" — flowers
- "Free reusable bag with $25 purchase" — promo with no standalone price
