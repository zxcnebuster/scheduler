interface Identifiable {
id: string;
}

interface Book extends Identifiable {
title: string;
asin: string; // unique book id
}

interface Account extends Identifiable {
name: string;
// status could be 'active', 'suspended', 'limited'
// availability: [{ unavailableFrom: Date, unavailableTo: Date }];
}

interface OrderItem { //a single review request within an order
reviewId: string; // uuid for this specific review task
bookId: string;
}

interface Order extends Identifiable {
clientId: string;
items: OrderItem[];
createdAt: Date; // for prioritization
}

interface ScheduledPurchase {//scheduled purchase action
purchaseId: string; //uuid
reviewId: string; / original orderitem's review request
orderId: string;
bookId: string;
accountId: string;
purchaseDate: Date;
reviewDate: Date; //purchaseDate + minReviewDays
status: 'pending' | 'completed' | 'missed' | 'delayed';
client?: string; //for daily task list
//notes?: string; //for special notes
}

interface ScheduledReview {//review task to be posted
reviewId: string; //orderitem and scheduledpurchase
orderId: string;
bookId: string;
accountId: string;
purchaseDate: Date;
scheduledPostDate: Date;
status: 'pending' | 'posted' | 'overdue';
client?: string;
}

interface AccountDailyStatus {//tracking account status on a given day
unavailable?: boolean; //is the account completely unavailable this day?
purchaseCount: number;
booksPurchasedToday: Set<string>;//at most 3
}
