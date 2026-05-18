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
  dietaryRestrictions: string[];
  cuisinePreferences: string[];
  excludedIngredients: string[];
  pantryStaples: string[];
  mealsPerDay: string[];
  daysOfWeek: string[];
}
