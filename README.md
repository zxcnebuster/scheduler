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
- OrderLine: Represents a request for a specific Book and a Review to be written for it. Could be multiple OrderLines for the same book in an order or across orders.
- Book: Identified by something unique (e.g., ASIN).
- AmazonAccount: Has a daily purchase limit.
- PurchaseTask: A specific book to be bought by a specific account on a specific day.
- ReviewTask: A review to be posted for a specific purchased book on a specific day.
- Schedule: The overall plan, containing all PurchaseTasks and ReviewTasks.

## DSs:

- Order: order_id, list_of_order_lines.
- OrderLine: book_id (or book_asin), client_id, review_text_placeholder.
- AmazonAccount: account_id, daily_purchase_limit (initially 3).
- PurchaseTask: date, account_id, book_id, order_id, order_line_id, status (PENDING, COMPLETED, MISSED).
- ReviewTask: date, purchase_task_id, book_id, order_id, order_line_id, status.
- Schedule: Maybe a dictionary mapping dates to lists of tasks, or separate lists for purchase and review tasks. A list of PurchaseTask objects and ReviewTask objects seems most flexible.

# Pseudocode for scheduler

````function schedule_orders(order_lines_to_schedule, accounts, current_date, existing_schedule):
    new_purchase_tasks = []
    new_review_tasks = []
    unprocessed_order_lines = list(order_lines_to_schedule) # Make a copy

    day_offset = 0
    while unprocessed_order_lines:
        target_date = current_date + timedelta(days=day_offset)
        purchases_made_today_by_account = defaultdict(int)
        books_purchased_today_by_account = defaultdict(set) # account_id -> {book_id}

        # Consider existing tasks for this day
        for task in existing_schedule.purchase_tasks:
            if task.date == target_date and task.status != 'MISSED': # Only count active tasks
                purchases_made_today_by_account[task.account_id] += 1
                books_purchased_today_by_account[task.account_id].add(task.book_id)

        # Sort accounts to balance load? Or just iterate. Let's iterate for now.
        # For "minimizing purchases per account per day", we might want to sort accounts
        # by fewest purchases already scheduled for the day.

        temp_lines_to_remove = []
        for order_line in unprocessed_order_lines:
            scheduled_this_line = False
            # Try to find an account for this order_line on target_date
            for account in accounts: # Maybe shuffle accounts or sort by current load
                if not account.is_available(target_date): continue # FR 4.1

                # Constraint 1.1: Daily limit
                if purchases_made_today_by_account[account.id] >= account.daily_limit:
                    continue

                # Constraint 1.2: Same book per account per day
                if order_line.book_id in books_purchased_today_by_account[account.id]:
                    continue

                # If we can schedule:
                purchase_task = create_purchase_task(order_line, account, target_date)
                new_purchase_tasks.append(purchase_task)

                purchases_made_today_by_account[account.id] += 1
                books_purchased_today_by_account[account.id].add(order_line.book_id)

                review_date = target_date + timedelta(days=MIN_REVIEW_DELAY)
                review_task = create_review_task(purchase_task, review_date)
                new_review_tasks.append(review_task)

                temp_lines_to_remove.append(order_line)
                scheduled_this_line = True
                break # Move to next order_line

        for line in temp_lines_to_remove:
            unprocessed_order_lines.remove(line)

        if not temp_lines_to_remove and unprocessed_order_lines: # Made no progress this day for remaining lines
            day_offset += 1
        elif not unprocessed_order_lines: # All done
            break
        # If some progress was made, stay on same day_offset to try and fill more with remaining accounts/lines

    # Add new tasks to existing_schedule
    existing_schedule.add_tasks(new_purchase_tasks, new_review_tasks)
    return existing_schedule```
````
