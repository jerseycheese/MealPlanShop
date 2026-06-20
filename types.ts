export interface SaleItem {
  item: string;
  price: number;
  unit: string;
  category: string;
  priceNote?: string;
  requiresLoyaltyCard?: boolean;
}

export interface ExtractionResult {
  items: SaleItem[];
  storeName: string | null;
  validThrough: string | null;
}

export interface Ingredient {
  name: string;
  quantity: string;
  onSale: boolean;
}

// A per-member alternative dish for a "split" meal — e.g. salmon for the house,
// a chicken swap for the member who won't eat fish. v1 only generates these from
// per-member dietary exclusions; it reuses the base meal's time/calorie/cost.
export interface MealVariant {
  forMembers: string[]; // member names this alternative is for
  name: string;
  ingredients: Ingredient[];
  instructions: string[];
}

export interface Meal {
  name: string;
  ingredients: Ingredient[];
  activeTime: number;
  totalTime: number;
  instructions: string[];
  estimatedCalories: number;
  estimatedCost: number;
  // Present only when the meal is split for one or more members' exclusions.
  variants?: MealVariant[];
}

export interface DayPlan {
  day: string;
  breakfast?: Meal;
  lunch?: Meal;
  dinner?: Meal;
}

export interface ShoppingListItem {
  name: string;
  quantity: string;
  category: string;
  onSale: boolean;
  salePrice: number | null;
  // Per-unit label for the sale price ("lb", "each", "bunch"), re-joined from the
  // circular's SaleItem so a row can show "$1.29/lb" vs "$0.69 ea". Optional: old
  // stored plans and non-sale rows simply omit it. Issue #121.
  unit?: string;
  requiresLoyaltyCard?: boolean;
}

export interface MealPlanResult {
  planId?: string;
  prefsFingerprint?: string;
  weekPlan: DayPlan[];
  shoppingList: ShoppingListItem[];
}

// A user-added shopping-list entry that isn't from the meal plan (milk, paper
// towels). Plan-independent — survives a regenerate. `price` is a rough Gemini
// estimate (null when not estimated or no key), folded into the list total.
// `category` is one of CATEGORY_ENUM so the item slots into the right aisle
// section alongside meal-plan items; defaults to "other" until estimated.
export interface ExtraItem {
  name: string;
  price: number | null;
  category: string;
}

// One person in the household, with their own dietary needs. These are *softer*
// than the household-wide excluded list: rather than banning an ingredient for
// everyone, an item a member excludes makes the planner offer them a variant
// dish. Absent `members` = a single shared profile (the pre-#74 behavior).
export interface HouseholdMember {
  name: string;
  excludedIngredients: string[];
  dietaryRestrictions: string[];
  // Optional soft lean for this member's variant dish (issue #74 phase 2a).
  // Absent = fall back to the household-wide cuisinePreferences for this member.
  cuisinePreferences?: string[];
  // Optional soft sizing hints for this member's variant dish (issue #74 phase 2b).
  // Absent = the member's variant is sized like the main meal (no per-member sizing).
  caloriesPerMeal?: number; // rough per-serving calorie target
  portionMultiplier?: number; // relative portion size, e.g. 1.5 = 50% larger
}

export interface UserPreferences {
  householdSize: number;
  // Per-member dietary profiles. When present, householdSize is the member count.
  members?: HouseholdMember[];
  // Household-wide cap on a meal's hands-on (active) minutes. Unset or 0 = no cap.
  maxActiveTime?: number;
  dietaryRestrictions: string[];
  cuisinePreferences: string[];
  excludedIngredients: string[];
  pantryStaples: string[];
  useUpIngredients: string[];
  // Per-day meal selection. A day present with a non-empty list is planned; the
  // list says which meals. Days absent (or empty) are not planned. Canonical
  // stored form: keys in DAYS_OF_WEEK order, each list in MEAL_TYPES order.
  mealsByDay: Partial<Record<DayOfWeek, MealType[]>>;
  // Free-text special instructions appended verbatim to the generation and swap
  // prompts — covers what the structured fields can't ("cook dinners double for
  // leftovers", "keep lunches mild"). Empty/absent = no change to behavior.
  notes?: string;
}

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const DAYS_OF_WEEK = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

export type ScanProgress =
  | { stage: 'idle' }
  | { stage: 'preparing' }
  | { stage: 'scanning'; page: number; pages: number; storeName: string | null }
  | { stage: 'fetching'; merchant: string }
  | { stage: 'planning' };
