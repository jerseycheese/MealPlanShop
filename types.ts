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
}

export interface MealPlanResult {
  planId?: string;
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
}
