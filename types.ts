export interface Ingredient {
  name: string;
  quantity: string;
  onSale: boolean;
}

export interface Meal {
  name: string;
  ingredients: Ingredient[];
  prepTime: number;
  cookTime: number;
  instructions: string[];
  estimatedCalories: number;
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
  weekPlan: DayPlan[];
  shoppingList: ShoppingListItem[];
}

export interface UserPreferences {
  householdSize: number;
  dietaryRestrictions: string[];
  cuisinePreferences: string[];
  mealsPerDay: string[];
}
