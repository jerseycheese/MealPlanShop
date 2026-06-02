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

export interface Meal {
  name: string;
  ingredients: Ingredient[];
  activeTime: number;
  totalTime: number;
  instructions: string[];
  estimatedCalories: number;
  estimatedCost: number;
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
  requiresLoyaltyCard?: boolean;
}

export interface MealPlanResult {
  planId?: string;
  prefsFingerprint?: string;
  weekPlan: DayPlan[];
  shoppingList: ShoppingListItem[];
}

export interface UserPreferences {
  householdSize: number;
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
}

export const MEAL_TYPES = ["breakfast", "lunch", "dinner"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const DAYS_OF_WEEK = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

export type ScanProgress =
  | { stage: "idle" }
  | { stage: "preparing" }
  | { stage: "scanning"; page: number; pages: number; storeName: string | null }
  | { stage: "fetching"; merchant: string }
  | { stage: "planning" };
