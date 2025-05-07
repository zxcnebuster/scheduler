## A flexible, constraint-aware task scheduler for order fulfillment scenarios involving multiple resources/accounts, daily limits, and time-based dependencies.

## Features

- Multi-resource (account) task balancing
- Daily/periodic per-resource caps
- Minimum delay windows between sequential tasks (e.g., purchase → review)
- Automatic rescheduling for missed or delayed tasks
- Audit log for scheduling decisions and changes
- Simple API for integration with bots, web dashboards, and order management systems

## Example Use Case

**Amazon Review Fulfillment:**

- 5 Amazon accounts
- Max 3 purchases/account/day
- No more than 1 purchase of same book per account per day
- Each review published min. 4 days after purchase
- Rescheduling on missed events

## Core problem

- The fundamental goal is to schedule book purchases and reviews, respecting various constraints (account limits, book-per-day limits, review delays) while minimizing overall completion time

## Key Entities:

- Order: Contains multiple OrderLines.
- Order Line: Represents a request for a specific Book and a Review to be written for it. Could be multiple OrderLines for the same book in an order or across orders.
- Book: Identified by something unique (e.g., ASIN).
- Amazon Account: Has a daily purchase limit.
- Purchase Task: A specific book to be bought by a specific account on a specific day.
- Review Task: A review to be posted for a specific purchased book on a specific day.
- Schedule: The overall plan, containing all PurchaseTasks and ReviewTasks.

# Pseudocode for scheduler

````
const MAX_PURCHASES_PER_ACCOUNT_PER_DAY = 3;
const MIN_REVIEW_DELAY_DAYS = 4;
const MAX_SCHEDULING_ATTEMPT_DAYS = 365;
FUNCTION generateSchedule(newOrdersToSchedule: Order[], existingSchedule: ScheduledPurchase[], allAccounts: Account[], accountAvailability: Map<accountId, { unavailableDates: Date[] }>, today: Date): ScheduledPurchase[]

    // Internal state for the current scheduling run
    // Key: accountId -> dateString (YYYY-MM-DD) -> AccountDailyStatus
    LET currentSchedulingRunState = new Map<string, Map<string, AccountDailyStatus>>();

    // 1. Initialize currentSchedulingRunState based on existingSchedule and accountAvailability
    FOR EACH purchase IN existingSchedule:
        IF purchase.status IS NOT 'missed': // Only consider active commitments
            LET dateStr = toDateString(purchase.purchaseDate)
            IF NOT currentSchedulingRunState.has(purchase.accountId):
                currentSchedulingRunState.set(purchase.accountId, new Map())
            IF NOT currentSchedulingRunState.get(purchase.accountId).has(dateStr):
                currentSchedulingRunState.get(purchase.accountId).set(dateStr, { purchaseCount: 0, booksPurchasedToday: new Set() })

            LET dailyStatus = currentSchedulingRunState.get(purchase.accountId).get(dateStr)
            dailyStatus.purchaseCount++
            dailyStatus.booksPurchasedToday.add(purchase.bookId)

    FOR EACH accountId IN accountAvailability.keys():
        FOR EACH unavailableDate IN accountAvailability.get(accountId).unavailableDates:
            LET dateStr = toDateString(unavailableDate)
            IF NOT currentSchedulingRunState.has(accountId):
                currentSchedulingRunState.set(accountId, new Map())
            IF NOT currentSchedulingRunState.get(accountId).has(dateStr):
                 currentSchedulingRunState.get(accountId).set(dateStr, { purchaseCount: 0, booksPurchasedToday: new Set() })
            currentSchedulingRunState.get(accountId).get(dateStr).unavailable = true


    // 2. Collect all individual review items from newOrders that need scheduling
    LET tasksToSchedule = []
    FOR EACH order IN newOrdersToSchedule:
        FOR EACH item IN order.items:
            // Ensure we don't try to re-schedule an item already in existingSchedule (unless it was marked 'missed' and handled upstream)
            IF NOT existingSchedule.some(p => p.reviewId === item.reviewId AND p.status !== 'missed'):
                tasksToSchedule.push({
                    reviewId: item.reviewId,
                    bookId: item.bookId,
                    orderId: order.id,
                    clientId: order.clientId,
                    // We might add priority here later, e.g., based on order.createdAt
                })

    // Optional: Sort tasksToSchedule. For now, process in given order.
    // Sorting could be by order creation date, or by book "demand" if a book appears in many tasks.

    LET newlyScheduledPurchases = []

    // 3. For each task, find the earliest possible slot
    FOR EACH task IN tasksToSchedule:
        LET earliestSlotFound = null // { accountId, purchaseDate, reviewDate }
        LET attemptedDays = 0

        // Start searching from 'today'
        LET currentAttemptDate = new Date(today)

        WHILE earliestSlotFound IS NULL AND attemptedDays < MAX_SCHEDULING_ATTEMPT_DAYS:
            LET dateStr = toDateString(currentAttemptDate)
            LET potentialSlotsThisDay = [] // Store {accountId, currentLoad}

            FOR EACH account IN allAccounts:
                // Get or initialize daily status for this account on currentAttemptDate
                IF NOT currentSchedulingRunState.has(account.id):
                    currentSchedulingRunState.set(account.id, new Map())
                IF NOT currentSchedulingRunState.get(account.id).has(dateStr):
                    currentSchedulingRunState.get(account.id).set(dateStr, { purchaseCount: 0, booksPurchasedToday: new Set() })

                LET dailyStatus = currentSchedulingRunState.get(account.id).get(dateStr)

                // CHECK CONSTRAINTS:
                // 1.1 Account availability
                IF dailyStatus.unavailable IS TRUE:
                    CONTINUE FOR_LOOP_ACCOUNTS

                // 1.2 Max 3 purchases per account per day
                IF dailyStatus.purchaseCount >= MAX_PURCHASES_PER_ACCOUNT_PER_DAY:
                    CONTINUE FOR_LOOP_ACCOUNTS

                // 1.3 Only one copy of the same book per account per day
                IF dailyStatus.booksPurchasedToday.has(task.bookId):
                    CONTINUE FOR_LOOP_ACCOUNTS

                // If all checks pass, this account is a candidate for this task on currentAttemptDate
                potentialSlotsThisDay.push({ accountId: account.id, currentLoad: dailyStatus.purchaseCount })

            // END FOR_LOOP_ACCOUNTS for currentAttemptDate

            IF potentialSlotsThisDay.length > 0:
                // 1.4 Minimize daily load (pick account with fewest purchases today from candidates)
                potentialSlotsThisDay.sort((a, b) => a.currentLoad - b.currentLoad)
                LET chosenAccountSlot = potentialSlotsThisDay[0]

                LET purchaseDate = new Date(currentAttemptDate)
                LET reviewDate = new Date(purchaseDate)
                reviewDate.setDate(purchaseDate.getDate() + MIN_REVIEW_DELAY_DAYS) // 1.5 Review timing

                earliestSlotFound = {
                    accountId: chosenAccountSlot.accountId,
                    purchaseDate: purchaseDate,
                    reviewDate: reviewDate
                }
            ELSE:
                // No slot found today, try next day
                currentAttemptDate.setDate(currentAttemptDate.getDate() + 1)
                attemptedDays++

        // END WHILE_LOOP for finding slot for current task

        IF earliestSlotFound IS NOT NULL:
            LET scheduledItem: ScheduledPurchase = {
                purchaseId: task.reviewId, // Using reviewId as purchaseId for simplicity
                reviewId: task.reviewId,
                orderId: task.orderId,
                bookId: task.bookId,
                accountId: earliestSlotFound.accountId,
                purchaseDate: earliestSlotFound.purchaseDate,
                reviewDate: earliestSlotFound.reviewDate,
                status: 'pending',
                client: task.clientId
            }
            newlyScheduledPurchases.push(scheduledItem)

            // CRITICAL: Update currentSchedulingRunState for the chosen slot
            // This ensures subsequent tasks in THIS scheduling run respect this new commitment.
            LET chosenDateStr = toDateString(earliestSlotFound.purchaseDate)
            LET chosenAccountDailyStatus = currentSchedulingRunState.get(earliestSlotFound.accountId).get(chosenDateStr)
            chosenAccountDailyStatus.purchaseCount++
            chosenAccountDailyStatus.booksPurchasedToday.add(task.bookId)
        ELSE:
            // Could not schedule this task within MAX_SCHEDULING_ATTEMPT_DAYS
            // Log this event: "Failed to schedule task for reviewId: ${task.reviewId}, bookId: ${task.bookId}"
            // This task will remain unscheduled.
            // Consider adding it to a list of "unschedulable" tasks to return.
            ADD_TO_UNSCHEDULABLE_LOG(task) // Placeholder for error handling

    // END FOR_LOOP for tasksToSchedule

    RETURN newlyScheduledPurchases // These are only the items scheduled in THIS run
END FUNCTION

// Helper function (will be implemented in TS)
FUNCTION toDateString(date: Date): string
    RETURN date.toISOString().split('T')[0] // YYYY-MM-DD```
````
