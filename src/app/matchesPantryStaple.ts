// Does a shopping-list item name refer to a pantry staple the user already has
// on hand? A naive "staple appears anywhere as a whole word" check false-
// positives on compound product names where the staple word is a modifier for
// a different food, not the food itself — "butter" (staple) wrongly hides
// "organic butter lettuce" (produce), the same way "sugar" would hide "sugar
// snap peas" or "flour" would hide "flour tortillas".
//
// Grocery item names in this app follow the usual English noun-phrase order —
// descriptors first, core ingredient last ("Organic Butter Lettuce", "Private
// Selection Angus Ground Sirloin") — so requiring the staple's words to be the
// item name's *trailing* words (not merely present anywhere) matches "this
// item IS the staple" while rejecting "this item is modified BY the staple's
// word". Staples are matched as a whole phrase, so multi-word staples like
// "vegetable oil" require both words at the end, in order.
export function matchesPantryStaple(itemName: string, staple: string): boolean {
  const itemWords = itemName.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const stapleWords = staple.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (stapleWords.length === 0 || stapleWords.length > itemWords.length) {
    return false;
  }
  const tail = itemWords.slice(itemWords.length - stapleWords.length);
  return tail.every((word, i) => word === stapleWords[i]);
}
