export interface Identifiable {
  id: string;
}

export interface Book extends Identifiable {
  title: string;
  asin: string;
}

export interface Account extends Identifiable {
  name: string;
}

export interface OrderItem {
  reviewId: string;
  bookId: string;
}

export interface Order extends Identifiable {
  clientId: string;
  items: OrderItem[];
  createdAt: Date;
}

export type PurchaseStatus = "pending" | "completed" | "missed" | "delayed";

export interface ScheduledPurchase {
  purchaseId: string;
  reviewId: string;
  orderId: string;
  bookId: string;
  accountId: string;
  purchaseDate: Date;
  reviewDate: Date;
  status: PurchaseStatus;
  client?: string;
  notes?: string;
}

export type ReviewStatus = "pending_review" | "posted" | "overdue_review";

export interface ScheduledReview {
  reviewId: string;
  orderId: string;
  bookId: string;
  accountId: string;
  purchaseDate: Date;
  scheduledPostDate: Date;
  status: ReviewStatus;
  client?: string;
}

export interface AccountDailyRunStatus {
  unavailable?: boolean;
  purchaseCount: number;
  booksPurchasedToday: Set<string>;
}

export interface AccountAvailability {
  [accountId: string]: {
    unavailableDates?: Date[];
  };
}

export interface TaskToSchedule {
  reviewId: string;
  bookId: string;
  orderId: string;
  clientId?: string;
}
